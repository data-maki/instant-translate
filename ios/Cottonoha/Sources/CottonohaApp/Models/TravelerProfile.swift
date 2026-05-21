import Foundation

public struct JapaneseTtsVoice: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    /// Short kana sample so users can hear the persona in their head.
    public let kana: String
    /// One-line character/voice description shown in the picker.
    public let description: String

    public static let all: [JapaneseTtsVoice] = [
        JapaneseTtsVoice(
            id: "nHEVPT3LS1V37bXZNr82",
            name: "Hideki",
            kana: "ヒデキ",
            description: "Calm, measured narrator. Good for slower, polite phrasing."
        ),
        JapaneseTtsVoice(
            id: "NO5A3b3sSzDyJQF7MiNS",
            name: "Shohei",
            kana: "ショウヘイ",
            description: "Friendly, conversational. Everyday tone for casual exchanges."
        ),
        JapaneseTtsVoice(
            id: "lDdVGZb7WThyrgVORbh0",
            name: "Shin",
            kana: "シン",
            description: "Bright and youthful. Energetic for quick directions and asks."
        ),
        JapaneseTtsVoice(
            id: "8FuuqoKHuM48hIEwni5e",
            name: "Shohei (warm)",
            kana: "ショウヘイ",
            description: "Mellow, warm delivery. Softer alternative for restaurants & hotels."
        )
    ]

    public static let `default` = all[1]
}

private extension String {
    var nonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

public struct TravelerProfile: Codable, Equatable, Sendable {
    public var firstName = ""
    public var lastName = ""
    public var firstNameKatakana = ""
    public var lastNameKatakana = ""
    public var age = ""
    public var hotel = ""
    public var travelParty = ""
    public var allergies = ""
    public var spiceLevel = ""
    public var mobility = ""
    public var savedPlaces = ""
    /// ElevenLabs voice id for Japanese TTS playback (mirrors desktop).
    public var ttsVoiceId = JapaneseTtsVoice.default.id
    /// Display name for the chosen voice — kept alongside the id so the UI
    /// doesn't need to re-resolve it from the catalog every render.
    public var ttsVoiceName = JapaneseTtsVoice.default.name
    /// Two minutes after a chat stops, run a background re-diarize + re-translate
    /// to replace the live transcript with a higher-quality version. Mirrors the
    /// desktop `auto_improve` flag so the same TranslatorProfileStore JSON stays
    /// compatible across platforms.
    public var autoImprove = false

    public init() {}

    enum CodingKeys: String, CodingKey {
        case firstName = "first_name"
        case lastName = "last_name"
        case firstNameKatakana = "first_name_katakana"
        case lastNameKatakana = "last_name_katakana"
        case age
        case hotel
        case travelParty = "travel_party"
        case allergies
        case spiceLevel = "spice_level"
        case mobility
        case savedPlaces = "saved_places"
        case ttsVoiceId = "tts_voice_id"
        case ttsVoiceName = "tts_voice_name"
        case autoImprove = "auto_improve"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        firstName = (try? container.decode(String.self, forKey: .firstName)) ?? ""
        lastName = (try? container.decode(String.self, forKey: .lastName)) ?? ""
        firstNameKatakana = (try? container.decode(String.self, forKey: .firstNameKatakana)) ?? ""
        lastNameKatakana = (try? container.decode(String.self, forKey: .lastNameKatakana)) ?? ""
        age = (try? container.decode(String.self, forKey: .age)) ?? ""
        hotel = (try? container.decode(String.self, forKey: .hotel)) ?? ""
        travelParty = (try? container.decode(String.self, forKey: .travelParty)) ?? ""
        allergies = (try? container.decode(String.self, forKey: .allergies)) ?? ""
        spiceLevel = (try? container.decode(String.self, forKey: .spiceLevel)) ?? ""
        mobility = (try? container.decode(String.self, forKey: .mobility)) ?? ""
        savedPlaces = (try? container.decode(String.self, forKey: .savedPlaces)) ?? ""
        ttsVoiceId = (try? container.decode(String.self, forKey: .ttsVoiceId))?.nonEmpty
            ?? JapaneseTtsVoice.default.id
        ttsVoiceName = (try? container.decode(String.self, forKey: .ttsVoiceName))?.nonEmpty
            ?? JapaneseTtsVoice.default.name
        autoImprove = (try? container.decode(Bool.self, forKey: .autoImprove)) ?? false
    }

    public var fullName: String {
        [firstName, lastName]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    public var katakanaName: String {
        [firstNameKatakana, lastNameKatakana]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    public var sonioxContext: String {
        var lines: [String] = []
        if !fullName.isEmpty { lines.append("Traveler name: \(fullName)") }
        if !katakanaName.isEmpty { lines.append("Traveler name in katakana: \(katakanaName)") }
        if !age.isEmpty { lines.append("Traveler age: \(age)") }
        if !hotel.isEmpty { lines.append("Hotel or area: \(hotel)") }
        if !travelParty.isEmpty { lines.append("Travel party: \(travelParty)") }
        if !allergies.isEmpty { lines.append("Food restrictions: \(allergies)") }
        if !spiceLevel.isEmpty { lines.append("Spice preference: \(spiceLevel)") }
        if !mobility.isEmpty { lines.append("Mobility or luggage needs: \(mobility)") }
        if !savedPlaces.isEmpty { lines.append("Saved places: \(savedPlaces)") }
        guard !lines.isEmpty else { return "" }
        return "[Traveler profile]\n" + lines.joined(separator: "\n") + "\n[/Traveler profile]"
    }
}
