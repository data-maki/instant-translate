import Foundation

public enum TranscriptEventDecoder {
    public static func decode(_ data: Data) throws -> TranscriptEvent {
        let envelope = try JSONDecoder().decode(EventEnvelope.self, from: data)
        switch envelope.type {
        case "status":
            let event = try JSONDecoder().decode(StatusEvent.self, from: data)
            return .status(event.status)
        case "session":
            let event = try JSONDecoder().decode(SessionEvent.self, from: data)
            return .session(event.session)
        case "transcript":
            let event = try JSONDecoder().decode(TranscriptPayload.self, from: data)
            return .transcript(event.phrases, event.finalTokenCount)
        case "provider_update":
            return .providerUpdate(try JSONDecoder().decode(ProviderUpdate.self, from: data))
        case "openai_realtime_audio":
            return .realtimeAudio(try JSONDecoder().decode(RealtimeAudio.self, from: data))
        case "saved":
            return .saved(try JSONDecoder().decode(SavedSession.self, from: data))
        case "error":
            let event = try JSONDecoder().decode(ErrorEvent.self, from: data)
            return .error(event.message)
        default:
            return .error("Unsupported backend event: \(envelope.type)")
        }
    }
}

private struct EventEnvelope: Decodable {
    var type: String
}

private struct StatusEvent: Decodable {
    var status: String
}

private struct SessionEvent: Decodable {
    var session: TranscriptSession
}

private struct TranscriptPayload: Decodable {
    var phrases: [Phrase]
    var finalTokenCount: Int

    enum CodingKeys: String, CodingKey {
        case phrases
        case finalTokenCount = "final_token_count"
    }
}

private struct ErrorEvent: Decodable {
    var message: String
}
