import Foundation

public struct AppConfiguration: Sendable {
    public var apiBaseURL: URL
    public var authBaseURL: URL
    public var authScheme: String

    public init(
        apiBaseURL: URL = URL(string: "http://localhost:8000")!,
        authBaseURL: URL = URL(string: "http://localhost:3000")!,
        authScheme: String = "cottonoha"
    ) {
        self.apiBaseURL = apiBaseURL
        self.authBaseURL = authBaseURL
        self.authScheme = authScheme
    }

    var websocketURL: URL {
        var components = URLComponents(url: apiBaseURL, resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/ws/transcribe"
        return components.url!
    }
}

public struct Language: Codable, Identifiable, Hashable, Sendable {
    public var code: String
    public var name: String
    public var flag: String
    public var priority: String

    public var id: String { code }
    public var displayName: String { "\(flag) \(name)" }
}

public struct LanguagesResponse: Codable, Sendable {
    public var defaultSourceLanguages: [String]
    public var defaultTargetLanguage: String
    public var languages: [Language]

    enum CodingKeys: String, CodingKey {
        case defaultSourceLanguages = "default_source_languages"
        case defaultTargetLanguage = "default_target_language"
        case languages
    }
}

public struct Phrase: Codable, Identifiable, Hashable, Sendable {
    public var id: String
    public var speaker: FlexibleString?
    public var speakerLabel: String
    public var sourceLanguage: String?
    public var texts: [String: String]
    public var romajiJa: String?
    public var isFinal: Bool
    public var time: FlexibleString?

    enum CodingKeys: String, CodingKey {
        case id
        case speaker
        case speakerLabel = "speaker_label"
        case sourceLanguage = "source_lang"
        case texts
        case romajiJa = "romaji_ja"
        case isFinal = "is_final"
        case time
    }
}

public struct SessionSummary: Codable, Identifiable, Hashable, Sendable {
    public var name: String
    public var title: String
    public var updated: String?
    public var tokenCount: Int
    public var durationSeconds: Double?
    public var sourceLanguages: [String]?
    public var targetLanguage: String?

    public var id: String { name }

    enum CodingKeys: String, CodingKey {
        case name
        case title
        case updated
        case tokenCount = "token_count"
        case durationSeconds = "duration_seconds"
        case sourceLanguages = "source_languages"
        case targetLanguage = "target_language"
    }
}

public struct SessionsResponse: Codable, Sendable {
    public var sessions: [SessionSummary]
    public var total: Int
}

public struct AudiencePreset: Identifiable, Hashable, Sendable {
    public let id: String
    public let label: String
    public let tone: String

    public static let all: [AudiencePreset] = [
        AudiencePreset(id: "service-staff", label: "staff", tone: "Polite customer speech"),
        AudiencePreset(id: "polite-stranger", label: "strangers", tone: "Soft polite speech"),
        AudiencePreset(id: "close-people", label: "friends", tone: "Warm casual speech"),
        AudiencePreset(id: "work-school", label: "work", tone: "Professional spoken speech"),
        AudiencePreset(id: "official-care", label: "official", tone: "Precise polite speech")
    ]

    public static let `default` = "polite-stranger"

    public static func find(_ id: String) -> AudiencePreset {
        all.first { $0.id == id } ?? all.first { $0.id == `default` }!
    }
}

public struct SessionDetailResponse: Codable, Sendable {
    public var session: SessionDetail?
    public var phrases: [Phrase]?
    public var adaptations: [String: PhraseAdaptation]?
}

/// AI-polished rewrite of a phrase. The backend keys these on
/// "<phrase_id>:<target_lang>" (see `adaptation_key()` in the desktop code).
/// When present, prefer `source_rewrite` / `target_translation` over the raw
/// `phrase.texts[...]` for that target language.
public struct PhraseAdaptation: Codable, Hashable, Sendable {
    public var sourceRewrite: String
    public var targetTranslation: String
    public var status: String

    enum CodingKeys: String, CodingKey {
        case sourceRewrite = "source_rewrite"
        case targetTranslation = "target_translation"
        case status
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        sourceRewrite = (try? container.decode(String.self, forKey: .sourceRewrite)) ?? ""
        targetTranslation = (try? container.decode(String.self, forKey: .targetTranslation)) ?? ""
        status = (try? container.decode(String.self, forKey: .status)) ?? "ready"
    }

    public init(sourceRewrite: String = "", targetTranslation: String = "", status: String = "ready") {
        self.sourceRewrite = sourceRewrite
        self.targetTranslation = targetTranslation
        self.status = status
    }
}

public struct TtsResult: Decodable, Sendable {
    public var audioBase64: String
    public var mimeType: String

    enum CodingKeys: String, CodingKey {
        case audioBase64 = "audio_base64"
        case mimeType = "mime_type"
    }
}

public struct NameKatakanaOption: Decodable, Hashable, Sendable {
    public var firstKatakana: String
    public var lastKatakana: String
    public var firstReadingEn: String
    public var lastReadingEn: String

    enum CodingKeys: String, CodingKey {
        case firstKatakana = "first_katakana"
        case lastKatakana = "last_katakana"
        case firstReadingEn = "first_reading_en"
        case lastReadingEn = "last_reading_en"
    }
}

public struct NameKatakanaResult: Decodable, Sendable {
    public var options: [NameKatakanaOption]
}

public struct MapsListPlace: Decodable, Hashable, Sendable {
    public var name: String
    public var address: String?
}

public struct MapsListImportResult: Decodable, Sendable {
    public var title: String
    public var places: [MapsListPlace]

    enum CodingKeys: String, CodingKey {
        case title
        case places
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        title = (try? container.decode(String.self, forKey: .title)) ?? ""
        places = (try? container.decode([MapsListPlace].self, forKey: .places)) ?? []
    }
}

public struct SessionDetail: Codable, Sendable {
    public var name: String
    public var title: String?
    public var summary: String?
    public var updated: String?
    public var durationSeconds: Double?
    public var sourceLanguages: [String]?
    public var targetLanguage: String?
    public var context: String?
    public var expectedSpeakerCount: Int?

    enum CodingKeys: String, CodingKey {
        case name
        case title
        case summary
        case updated
        case durationSeconds = "duration_seconds"
        case sourceLanguages = "source_languages"
        case targetLanguage = "target_language"
        case context
        case expectedSpeakerCount = "expected_speaker_count"
    }
}

public enum TranscriptEvent: Sendable {
    case status(String)
    case session(TranscriptSession)
    case transcript([Phrase], Int)
    case providerUpdate(ProviderUpdate)
    case realtimeAudio(RealtimeAudio)
    case saved(SavedSession)
    case error(String)
}

public struct TranscriptSession: Codable, Sendable {
    public var name: String
    public var title: String?
    public var sourceLanguages: [String]
    public var targetLanguage: String
    public var tokenCount: Int

    enum CodingKeys: String, CodingKey {
        case name
        case title
        case sourceLanguages = "source_languages"
        case targetLanguage = "target_language"
        case tokenCount = "token_count"
    }
}

public struct ProviderUpdate: Codable, Sendable {
    public var provider: String
    public var kind: String
    public var text: String
    public var isFinal: Bool

    enum CodingKeys: String, CodingKey {
        case provider
        case kind
        case text
        case isFinal = "is_final"
    }
}

public struct RealtimeAudio: Codable, Sendable {
    public var audio: String
    public var format: String
    public var sampleRate: Double

    enum CodingKeys: String, CodingKey {
        case audio
        case format
        case sampleRate = "sample_rate"
    }
}

public struct SavedSession: Codable, Sendable {
    public var session: String
    public var path: String
    public var title: String?
    public var summary: String?
    public var phrases: [Phrase]
    public var tokenCount: Int

    enum CodingKeys: String, CodingKey {
        case session
        case path
        case title
        case summary
        case phrases
        case tokenCount = "token_count"
    }
}

public struct StartTranscriptionMessage: Encodable, Sendable {
    public var type = "start"
    public var sessionName = ""
    public var sourceLanguages: [String]
    public var targetLanguage: String
    public var expectedSpeakerCount: Int?
    public var expectedSpeakerNames: [String] = []
    public var enableOpenAIRealtime: Bool
    public var context: String

    enum CodingKeys: String, CodingKey {
        case type
        case sessionName = "session_name"
        case sourceLanguages = "source_languages"
        case targetLanguage = "target_language"
        case expectedSpeakerCount = "expected_speaker_count"
        case expectedSpeakerNames = "expected_speaker_names"
        case enableOpenAIRealtime = "enable_openai_realtime"
        case context
    }
}

public struct FlexibleString: Codable, Hashable, Sendable, CustomStringConvertible {
    public var value: String
    public var description: String { value }

    public init(_ value: String) {
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let string = try? container.decode(String.self) {
            value = string
        } else if let int = try? container.decode(Int.self) {
            value = String(int)
        } else if let double = try? container.decode(Double.self) {
            value = String(double)
        } else {
            value = ""
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}
