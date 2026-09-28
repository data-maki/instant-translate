import Foundation
import Testing
@testable import CottonohaCore

private func phrase(_ id: String, source: String = "en", speaker: String = "1", time: String? = nil,
                    texts: [String: String] = ["en": "Where is the station?", "bg": "Къде е гарата?"]) -> Phrase {
    Phrase(id: id, speaker: FlexibleString(speaker), speakerLabel: "Person", sourceLanguage: source,
           texts: texts, romajiJa: nil, isFinal: true, time: time.map(FlexibleString.init))
}

@Suite struct TranscriptPresentationTests {
    @Test func bulgarianReadingsPreserveCasePunctuationAndSpecialWords() {
        #expect(TranscriptPresentation.romanizeBulgarian("Здравей, как си? София, България!") == "Zdravey, kak si? Sofia, Bulgaria!")
        #expect(TranscriptPresentation.romanizeBulgarian("Щастие, джаз, дзън, синьо, Йордан.") == "Shtastie, dzhaz, dzan, sinyo, Yordan.")
        #expect(TranscriptPresentation.romanizeBulgarian("БЪЛГАРИЯ: станция, станцията") == "BULGARIA: stantsia, stantsiyata")
        #expect(TranscriptPresentation.romanizeBulgarian("И\u{300} и и\u{306} 👋") == "I i y 👋")
    }

    @Test func groupsOnlyAdjacentSameSpeakerLanguageAndPause() {
        let phrases = [phrase("1", time: "1"), phrase("2", time: "3"), phrase("3", speaker: "2", time: "4"),
                       phrase("4", time: "5"), phrase("5", source: "bg", time: "6"), phrase("6", source: "bg", time: "20")]
        #expect(TranscriptPresentation.paragraphs(phrases).map { $0.phrases.map(\.id) } == [["1", "2"], ["3"], ["4"], ["5"], ["6"]])
    }

    @Test func existingTranslationWinsAndSavedFallbackWorksInBothModes() {
        let item = phrase("saved")
        let key = TranscriptPresentation.adaptationKey(item, language: "bg")
        #expect(key == "saved:bg:Where is the station?")
        let adaptations = [key: PhraseAdaptation(targetTranslation: "Saved fallback")]
        for enhanced in [true, false] {
            #expect(TranscriptPresentation.text(item, language: "bg", target: "bg", enhanced: enhanced, adaptations: adaptations) == "Къде е гарата?")
            var missing = item
            missing.texts["bg"] = nil
            #expect(TranscriptPresentation.text(missing, language: "bg", target: "bg", enhanced: enhanced, adaptations: adaptations) == "Saved fallback")
        }
    }

    @Test @MainActor func paragraphPlaybackKeepsCyrillicInLatinDisplayMode() {
        let model = TranslatorViewModel(configuration: AppConfiguration())
        model.showRomaji = true
        let items = [phrase("1"), phrase("2", texts: ["en": "Thanks", "bg": "Благодаря!"])]
        #expect(model.paragraphText(items, language: "bg") == "Къде е гарата? Благодаря!")
        #expect(model.paragraphText(items, language: "en") == "Where is the station? Thanks")
    }

    @Test func longTextIsPreservedWithinBackendScalarLimit() {
        let text = String(repeating: "Това е изречение. ", count: 220).trimmingCharacters(in: .whitespaces)
        let chunks = TranscriptPresentation.speechChunks(text)
        #expect(chunks.count > 1)
        #expect(chunks.allSatisfy { $0.unicodeScalars.count <= 1500 })
        #expect(chunks.joined(separator: " ") == text)
        let emoji = String(repeating: "👩‍👩‍👧‍👧", count: 400)
        let unicode = TranscriptPresentation.speechChunks(emoji)
        #expect(unicode.allSatisfy { $0.unicodeScalars.count <= 1500 })
        #expect(unicode.joined() == emoji)
    }

    @Test func cacheSeparatesVoicesLanguagesAndExpires() async throws {
        var cache = SpeechCache()
        let now = Date()
        let key = SpeechCache.Key(text: "Hello", language: "en", voice: "A")
        cache.insert(Data([1, 0]), sampleRate: 24_000, key: key, now: now)
        let cached = cache.get(key, now: now)
        let audio = try #require(cached)
        var decoded = Data()
        for try await data in audio.chunks { decoded.append(data) }
        #expect(decoded == Data([1, 0]))
        let otherLanguage = cache.get(.init(text: "Hello", language: "bg", voice: "A"), now: now)
        let otherVoice = cache.get(.init(text: "Hello", language: "en", voice: "B"), now: now)
        let expired = cache.get(key, now: now.addingTimeInterval(301))
        #expect(otherLanguage == nil)
        #expect(otherVoice == nil)
        #expect(expired == nil)
    }
}
