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

public struct SessionDetailResponse: Codable, Sendable {
    public var session: SessionDetail?
    public var phrases: [Phrase]?
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
