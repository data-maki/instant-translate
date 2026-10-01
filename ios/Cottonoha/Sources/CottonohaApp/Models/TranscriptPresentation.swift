import Foundation

struct TranscriptParagraph: Identifiable {
    var phrases: [Phrase]
    var id: String { phrases[0].id }
}

enum TranscriptPresentation {
    static func sourceLanguage(_ phrase: Phrase, preferred: String = "") -> String {
        let explicit = (phrase.sourceLanguage ?? "").lowercased()
        if !explicit.isEmpty, !(phrase.texts[explicit] ?? "").isEmpty { return explicit }
        if !(phrase.texts[preferred] ?? "").isEmpty { return preferred }
        return phrase.texts.keys.sorted().first { $0 != "en" && !(phrase.texts[$0] ?? "").isEmpty }
            ?? phrase.texts.keys.sorted().first ?? explicit
    }

    static func adaptationKey(_ phrase: Phrase, language: String) -> String {
        let source = sourceLanguage(phrase)
        return "\(phrase.id):\(language):\((phrase.texts[source] ?? "").trimmingCharacters(in: .whitespacesAndNewlines))"
    }

    static func adaptation(_ phrase: Phrase, language: String, adaptations: [String: PhraseAdaptation]) -> PhraseAdaptation? {
        adaptations[adaptationKey(phrase, language: language)] ?? adaptations["\(phrase.id):\(language)"]
    }

    static func text(_ phrase: Phrase, language: String, target: String, enhanced: Bool,
                     adaptations: [String: PhraseAdaptation]) -> String {
        if enhanced, language == sourceLanguage(phrase), language == "en",
           let rewrite = adaptation(phrase, language: target, adaptations: adaptations)?.sourceRewrite,
           !rewrite.isEmpty { return rewrite }
        let original = phrase.texts[language] ?? ""
        if !original.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return original }
        // Saved fallback translations are available in both display modes.
        return adaptation(phrase, language: language, adaptations: adaptations)?.targetTranslation ?? ""
    }

    static func paragraphs(_ phrases: [Phrase]) -> [TranscriptParagraph] {
        var groups: [TranscriptParagraph] = []
        for phrase in phrases {
            if let last = groups.last?.phrases.last,
               let speaker = last.speaker?.value, !speaker.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               speaker == phrase.speaker?.value,
               sourceLanguage(last) == sourceLanguage(phrase), closeInTime(last, phrase) {
                groups[groups.count - 1].phrases.append(phrase)
            } else { groups.append(TranscriptParagraph(phrases: [phrase])) }
        }
        return groups
    }

    private static func closeInTime(_ first: Phrase, _ second: Phrase) -> Bool {
        func seconds(_ phrase: Phrase) -> Double? {
            if let ms = phrase.timeMilliseconds { return ms / 1000 }
            guard let legacy = Double(phrase.time?.value ?? "") else { return nil }
            return legacy > 10_000 ? legacy / 1000 : legacy
        }
        guard let a = seconds(first), let b = seconds(second) else { return true }
        return b >= a && b - a <= 10
    }

    static func speechID(_ phrases: [Phrase], language: String) -> String {
        "paragraph:\(phrases.first?.id ?? ""):\(language)"
    }

    static func reading(_ phrase: Phrase, language: String, text: String) -> String {
        if language == "bg" { return romanizeBulgarian(text) }
        if language == "ja" { return phrase.romajiJa ?? "" }
        return ""
    }

    static func romanizeBulgarian(_ text: String) -> String {
        let alphabet = Array("абвгдежзийклмнопрстуфхцчшщъьюяѝ")
        let latin = ["a","b","v","g","d","e","zh","z","i","y","k","l","m","n","o","p","r","s","t","u","f","h","ts","ch","sh","sht","a","y","yu","ya","i"]
        let mapping = Dictionary(uniqueKeysWithValues: zip(alphabet, latin))
        let normalized = text.precomposedStringWithCanonicalMapping
        let regex = try! NSRegularExpression(pattern: "[А-Яа-яЍѝ]+")
        var result = normalized
        for match in regex.matches(in: normalized, range: NSRange(normalized.startIndex..., in: normalized)).reversed() {
            guard let range = Range(match.range, in: result) else { continue }
            let word = String(result[range]), letters = Array(word)
            let lower = word.lowercased(), allCaps = word == word.uppercased()
            let reading = letters.enumerated().map { index, letter -> String in
                var value = mapping[Character(String(letter).lowercased())] ?? String(letter)
                if lower.hasSuffix("ия"), index == letters.count - 1 { value = "a" }
                if lower == "българия", index == 1 { value = "u" }
                if String(letter) != String(letter).lowercased() {
                    value = allCaps ? value.uppercased() : value.prefix(1).uppercased() + value.dropFirst()
                }
                return value
            }.joined()
            result.replaceSubrange(range, with: reading)
        }
        return result
    }

    static func speechChunks(_ text: String) -> [String] {
        var remaining = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        var chunks: [String] = []
        while remaining.unicodeScalars.count > 1500 {
            let limit = remaining.unicodeScalars.index(remaining.startIndex, offsetBy: 1500)
            let end = remaining[..<limit].lastIndex(of: " ") ?? limit
            chunks.append(String(remaining[..<end]))
            remaining = String(remaining[end...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if !remaining.isEmpty { chunks.append(remaining) }
        return chunks
    }
}
