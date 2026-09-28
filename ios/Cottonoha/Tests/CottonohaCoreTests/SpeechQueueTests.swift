import Foundation
import Testing
@testable import CottonohaCore

@MainActor
private final class Playback {
    var items: [SpeechItem] = []
    var completions: [CheckedContinuation<Void, Never>] = []
    var stops = 0
    lazy var queue = SpeechQueue(play: { [weak self] item, _ in
        guard let self else { return }
        items.append(item)
        await withCheckedContinuation { completions.append($0) }
    }, stop: { [weak self] in self?.stops += 1 })

    func finish() { completions.removeFirst().resume() }
    func settle() async { for _ in 0..<20 { await Task.yield() } }
}

private func phrase(_ id: String, source: String? = "en", final: Bool = true, translated: Bool = true) -> Phrase {
    Phrase(id: id, speaker: nil, speakerLabel: "Speaker", sourceLanguage: source,
           texts: translated ? ["en": "Hello", "bg": "Здравей"] : ["en": "Hello"],
           romajiJa: nil, isFinal: final, time: nil)
}

@Suite @MainActor struct SpeechQueueTests {
    @Test func startsAtLatestAndWaitsForPlayback() async {
        let h = Playback()
        h.queue.setEnabled(true, phrases: [phrase("old"), phrase("latest")], language: "bg")
        await h.settle()
        h.queue.update([phrase("old"), phrase("latest"), phrase("new")])
        await h.settle()
        #expect(h.items.map(\.id) == ["latest"])
        #expect(h.items.first?.language == "bg")
        h.finish(); await h.settle()
        #expect(h.items.map(\.id) == ["latest", "new"])
        h.finish(); await h.settle()
    }

    @Test func localReplyNeverReadsAnOlderEnglishTurn() async {
        let h = Playback()
        h.queue.setEnabled(true, phrases: [phrase("old"), phrase("reply", source: "bg")], language: "bg")
        await h.settle()
        #expect(h.items.isEmpty)
        h.queue.update([phrase("old"), phrase("reply", source: "bg"), phrase("next")])
        await h.settle()
        #expect(h.items.map(\.id) == ["next"])
        h.finish(); await h.settle()
    }

    @Test func waitsForMissingTranslationWithoutOvertakingOrRepeating() async {
        let h = Playback()
        h.queue.setEnabled(true, phrases: [phrase("first", translated: false)], language: "bg")
        h.queue.update([phrase("first", translated: false), phrase("second")])
        await h.settle()
        #expect(h.items.isEmpty)
        h.queue.update([phrase("first"), phrase("second")])
        await h.settle()
        #expect(h.items.map(\.id) == ["first"])
        h.finish(); await h.settle()
        h.finish(); await h.settle()
        h.queue.update([phrase("first"), phrase("second")])
        await h.settle()
        #expect(h.items.map(\.id) == ["first", "second"])
    }

    @Test func ignoresPartialUnknownAndEnglishOutput() async {
        let h = Playback()
        h.queue.setEnabled(true, phrases: [phrase("partial", final: false)], language: "bg")
        await h.settle()
        #expect(h.items.isEmpty)
        h.queue.setEnabled(true, phrases: [phrase("unknown", source: nil)], language: "bg")
        h.queue.setEnabled(true, phrases: [phrase("english")], language: "en")
        await h.settle()
        #expect(h.items.isEmpty)
    }

    @Test func disablingDiscardsBacklogAndLateCompletion() async {
        let h = Playback()
        let phrases = [phrase("first"), phrase("second")]
        h.queue.setEnabled(true, phrases: [phrases[0]], language: "bg")
        await h.settle()
        h.queue.update(phrases)
        h.queue.setEnabled(false, phrases: phrases, language: "bg")
        h.finish(); await h.settle()
        #expect(h.items.map(\.id) == ["first"])
        #expect(h.stops == 2)
    }

    @Test func openingHistorySkipsItsTranscript() async {
        let h = Playback()
        let history = [phrase("old")]
        h.queue.reset(history, language: "bg", enabled: true)
        h.queue.update(history)
        await h.settle()
        #expect(h.items.isEmpty)
        h.queue.update(history + [phrase("new")])
        await h.settle()
        #expect(h.items.map(\.id) == ["new"])
        h.finish(); await h.settle()
    }

    @Test func manualSpeechReplacesBacklogButKeepsFutureTurns() async {
        let h = Playback()
        h.queue.reset([phrase("old")], language: "bg", enabled: true)
        let manual = Task { await h.queue.speakNow(SpeechItem(id: "manual", text: "Hi", language: "en")) }
        await h.settle()
        h.queue.update([phrase("old"), phrase("new")])
        #expect(h.items.map(\.id) == ["manual"])
        h.finish(); await h.settle()
        #expect(h.items.map(\.id) == ["manual", "new"])
        h.finish(); await manual.value
    }
    @Test func longManualParagraphFinishesBeforeFutureAutospeak() async {
        let h = Playback()
        h.queue.reset([], language: "bg", enabled: true)
        let text = String(repeating: "Цяло изречение. ", count: 220).trimmingCharacters(in: .whitespaces)
        let manual = Task { await h.queue.speakNow(SpeechItem(id: "paragraph", text: text, language: "bg")) }
        await h.settle()
        h.queue.update([phrase("next")])
        let chunks = TranscriptPresentation.speechChunks(text)
        for _ in chunks { h.finish(); await h.settle() }
        #expect(h.items.filter { $0.id == "paragraph" }.map(\.text).joined(separator: " ") == text)
        #expect(h.items.last?.id == "next")
        h.finish(); await manual.value
    }

    @Test func draftPreparationNeverPlaysBeforeFinalityAndCorrectionCancelsIt() async throws {
        var prepared: [SpeechItem] = [], played: [SpeechItem] = []
        let queue = SpeechQueue(play: { item, audio in
            #expect(audio != nil)
            played.append(item)
        }, stop: {}, prepare: { item in
            prepared.append(item)
            return .complete(Data([0, 0]), format: .pcm(sampleRate: 24_000))
        })
        queue.setEnabled(true, phrases: [phrase("draft", final: false)], language: "bg")
        try await Task.sleep(for: .milliseconds(200))
        #expect(prepared.count == 1)
        #expect(played.isEmpty)
        var corrected = phrase("draft", final: false)
        corrected.texts["bg"] = "Поправка"
        queue.update([corrected])
        corrected.isFinal = true
        queue.update([corrected])
        for _ in 0..<30 { await Task.yield() }
        #expect(played.map(\.text) == ["Поправка"])
        #expect(prepared.map(\.text) == ["Здравей", "Поправка"])
    }

    @Test func cancellingDraftDuringDebounceAvoidsSynthesis() async throws {
        var prepared = 0
        let queue = SpeechQueue(play: { _, _ in }, stop: {}, prepare: { _ in
            prepared += 1
            return .complete(Data([0, 0]), format: .pcm(sampleRate: 24_000))
        })
        queue.setEnabled(true, phrases: [phrase("draft", final: false)], language: "bg")
        queue.setEnabled(false, phrases: [], language: "bg")
        try await Task.sleep(for: .milliseconds(180))
        #expect(prepared == 0)
    }

}
