import Foundation

struct SpeechItem: Equatable {
    var id: String
    var text: String
    var language: String
}

/// Serial playback with an explicit history boundary and one translation direction.
@MainActor
final class SpeechQueue {
    private var phrases: [Phrase] = []
    private var cursor = 0
    private var language = ""
    private var enabled = false
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private let play: (SpeechItem) async -> Void
    private let stop: () -> Void
    private let text: (Phrase, String) -> String

    init(play: @escaping (SpeechItem) async -> Void, stop: @escaping () -> Void,
         text: @escaping (Phrase, String) -> String = { $0.texts[$1] ?? "" }) {
        self.play = play
        self.stop = stop
        self.text = text
    }

    func reset(_ phrases: [Phrase], language: String, enabled: Bool) {
        generation = UUID()
        task?.cancel()
        task = nil
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

    private func drain() {
        guard enabled, task == nil else { return }
        while cursor < phrases.count {
            let phrase = phrases[cursor]
            guard phrase.isFinal else { return }
            guard phrase.sourceLanguage?.lowercased() == "en", language != "en", !language.isEmpty else {
                cursor += 1
                continue
            }
            let value = text(phrase, language).trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty else { return }
            cursor += 1
            launch(SpeechItem(id: phrase.id, text: value, language: language))
            return
        }
    }

    private func launch(_ item: SpeechItem) {
        let request = UUID()
        generation = request
        task = Task { [weak self] in
            guard let self, !Task.isCancelled else { return }
            await play(item)
            guard generation == request else { return }
            task = nil
            drain()
        }
    }
}
