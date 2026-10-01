import Foundation

struct SpeechItem: Equatable, Sendable {
    var id: String
    var text: String
    var language: String
}

/// Serial playback with a history boundary, one direction, and one prepared reply.
@MainActor
final class SpeechQueue {
    private var phrases: [Phrase] = []
    private var cursor = 0
    private var language = ""
    private var enabled = false
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private let play: (SpeechItem, SpeechAudio?) async throws -> Void
    private let stop: () -> Void
    private let text: (Phrase, String) -> String
    private let prepare: ((SpeechItem) async throws -> SpeechAudio)?
    private var prepared: Preparation?
    private var activePreparation: Task<SpeechAudio, Error>?
    private var activeAudio: SpeechAudio?

    private final class Preparation {
        let item: SpeechItem
        var started = false
        var task: Task<SpeechAudio, Error>!
        init(_ item: SpeechItem) { self.item = item }
        func cancel() {
            task.cancel()
            let pending = task!
            Task { if let audio = try? await pending.value { audio.cancel() } }
        }
    }

    init(play: @escaping (SpeechItem, SpeechAudio?) async throws -> Void, stop: @escaping () -> Void,
         text: @escaping (Phrase, String) -> String = { $0.texts[$1] ?? "" },
         prepare: ((SpeechItem) async throws -> SpeechAudio)? = nil) {
        self.play = play
        self.stop = stop
        self.text = text
        self.prepare = prepare
    }

    func reset(_ phrases: [Phrase], language: String, enabled: Bool) {
        generation = UUID()
        task?.cancel()
        task = nil
        activePreparation?.cancel()
        activePreparation = nil
        activeAudio?.cancel()
        activeAudio = nil
        prepared?.cancel()
        prepared = nil
        stop()
        self.phrases = phrases
        self.language = language
        self.enabled = enabled
        cursor = phrases.count
    }

    func setEnabled(_ enabled: Bool, phrases: [Phrase], language: String) {
        reset(phrases, language: language, enabled: enabled)
        if enabled {
            cursor = max(0, phrases.count - 1)
            drain()
        }
    }

    func update(_ phrases: [Phrase]) {
        self.phrases = phrases
        drain()
    }

    func speakNow(_ item: SpeechItem) async {
        reset(phrases, language: language, enabled: enabled)
        launch(item)
        await task?.value
    }

    private func eligible(_ phrase: Phrase) -> Bool {
        phrase.sourceLanguage?.lowercased() == "en" && language != "en" && !language.isEmpty
    }

    private func prepareNext() {
        if enabled, let prepare {
            for phrase in phrases.dropFirst(cursor) where eligible(phrase) {
                guard let first = TranscriptPresentation.speechChunks(text(phrase, language)).first else { break }
                let item = SpeechItem(id: phrase.id, text: first, language: language)
                if let current = prepared, current.item == item {
                    if !phrase.isFinal || current.started { return }
                    // Final text skips a draft's remaining debounce interval.
                }
                prepared?.cancel()
                let next = Preparation(item)
                next.task = Task {
                    if !phrase.isFinal { try await Task.sleep(for: .milliseconds(150)) }
                    try Task.checkCancellation()
                    next.started = true
                    return try await prepare(item)
                }
                prepared = next
                return
            }
        }
        prepared?.cancel()
        prepared = nil
    }

    private func drain() {
        prepareNext()
        guard enabled, task == nil else { return }
        while cursor < phrases.count {
            let phrase = phrases[cursor]
            guard phrase.isFinal else { return }
            guard eligible(phrase) else { cursor += 1; continue }
            let value = text(phrase, language).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { return }
            cursor += 1
            launch(SpeechItem(id: phrase.id, text: value, language: language))
            prepareNext()
            return
        }
    }

    private func launch(_ item: SpeechItem) {
        let request = UUID()
        generation = request
        let chunks = TranscriptPresentation.speechChunks(item.text)
        let first = SpeechItem(id: item.id, text: chunks.first ?? "", language: item.language)
        let preparation = prepared?.item == first ? prepared : nil
        if preparation != nil { prepared = nil }
        activePreparation = preparation?.task
        task = Task { [weak self] in
            guard let self else { return }
            do {
                for (index, chunk) in chunks.enumerated() {
                    try Task.checkCancellation()
                    // A failed speculative request may retry through normal playback,
                    // where the view model can surface a provider error to the user.
                    let audio = index == 0 ? try? await preparation?.task.value : nil
                    if Task.isCancelled { audio?.cancel(); throw CancellationError() }
                    activePreparation = nil
                    activeAudio = audio
                    try await play(SpeechItem(id: item.id, text: chunk, language: item.language), audio)
                    guard generation == request else { return }
                    activeAudio = nil
                }
            } catch {
                // The player publishes errors; cancellation never advances an old queue.
            }
            guard generation == request else { return }
            activeAudio?.cancel()
            activeAudio = nil
            activePreparation = nil
            task = nil
            drain()
        }
    }
}
