import Foundation

public actor CottonohaAPIClient {
    private let configuration: AppConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    private var speechCache = SpeechCache()

    public init(
        configuration: AppConfiguration,
        session: URLSession = .shared
    ) {
        self.configuration = configuration
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    public func fetchLanguages() async throws -> LanguagesResponse {
        try await get("/languages")
    }

    public func fetchSessions(limit: Int? = 8, offset: Int? = nil) async throws -> SessionsResponse {
        var items: [URLQueryItem] = []
        if let limit {
            items.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        if let offset {
            items.append(URLQueryItem(name: "offset", value: String(offset)))
        }
        var components = URLComponents()
        components.queryItems = items.isEmpty ? nil : items
        let query = components.percentEncodedQuery.map { "?\($0)" } ?? ""
        let path = "/sessions\(query)"
        return try await get(path)
    }

    public func fetchSessionDetail(_ name: String) async throws -> SessionDetailResponse {
        try await get("/sessions/\(name.urlPathEncoded)")
    }

    public func renameSession(_ name: String, title: String) async throws -> SessionRenameResponse {
        try await request(
            "/sessions/\(name.urlPathEncoded)",
            method: "PATCH",
            body: ["title": title]
        )
    }

    public func deleteSession(_ name: String) async throws {
        let _: DeleteSessionResponse = try await request(
            "/sessions/\(name.urlPathEncoded)",
            method: "DELETE",
            body: Optional<EmptyBody>.none
        )
    }

    public func rediarizeSession(_ name: String) async throws -> SessionImproveResponse {
        try await request(
            "/sessions/\(name.urlPathEncoded)/rediarize",
            method: "POST",
            body: Optional<EmptyBody>.none
        )
    }

    public func retranslateSession(_ name: String) async throws -> SessionImproveResponse {
        try await request(
            "/sessions/\(name.urlPathEncoded)/retranslate",
            method: "POST",
            body: Optional<EmptyBody>.none
        )
    }

    public func translatePhrase(
        sourceLanguage: String,
        targetLanguage: String,
        sourceText: String,
        audience: String
    ) async throws -> TranslatePhraseResult {
        struct Tone: Encodable {
            let audience: String
            let rule: String
        }
        struct RewriteContext: Encodable {
            let tone: Tone
        }
        struct Body: Encodable {
            let source_language: String
            let target_language: String
            let source_text: String
            let draft_translation: String
            let rewrite_context: RewriteContext
        }
        return try await request(
            "/context/translate",
            method: "POST",
            body: Body(
                source_language: sourceLanguage,
                target_language: targetLanguage,
                source_text: sourceText,
                draft_translation: "",
                rewrite_context: RewriteContext(
                    tone: Tone(
                        audience: audience,
                        rule: "Keep it concise, natural, and faithful to the typed phrase."
                    )
                )
            )
        )
    }

    public func generateTts(text: String, targetLanguage: String, voiceId: String?) async throws -> TtsResult {
        struct Body: Encodable {
            let text: String
            let target_language: String
            let voice_id: String?
        }
        return try await request(
            "/tts/speak",
            method: "POST",
            body: Body(text: text, target_language: targetLanguage, voice_id: voiceId)
        )
    }

    func saveAdaptation(_ sessionName: String, key: String, adaptation: PhraseAdaptation) async throws {
        struct Body: Encodable { let key: String; let adaptation: PhraseAdaptation }
        struct Result: Decodable { let key: String }
        let _: Result = try await request("/sessions/\(sessionName.urlPathEncoded)/adaptations", method: "POST",
                                         body: Body(key: key, adaptation: adaptation))
    }

    func streamSpeech(text: String, language: String, voice: String?) async throws -> SpeechAudio {
        try Task.checkCancellation()
        let key = SpeechCache.Key(text: text, language: language, voice: voice)
        if let cached = speechCache.get(key) { return cached }
        var request = URLRequest(url: configuration.apiBaseURL.appendingPath("/tts/stream"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Accept")
        request.setValue("OpenAI File Downloader, XaiImageApiFetch/1.0", forHTTPHeaderField: "User-Agent")
        var body = ["text": text, "target_language": language]
        if let voice { body["voice_id"] = voice }
        request.httpBody = try encoder.encode(body)
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse else { bytes.task.cancel(); throw APIError.invalidResponse }
        if http.statusCode == 404 || http.statusCode == 405 {
            bytes.task.cancel()
            let result = try await generateTts(text: text, targetLanguage: language, voiceId: voice)
            try Task.checkCancellation()
            guard let data = Data(base64Encoded: result.audioBase64) else { throw APIError.invalidResponse }
            return .complete(data, format: .mp3)
        }
        guard (200..<300).contains(http.statusCode),
              http.mimeType == "application/octet-stream" else {
            bytes.task.cancel()
            throw APIError.server("Speech request failed (\(http.statusCode)).")
        }
        let sampleRate = Double(http.value(forHTTPHeaderField: "X-Audio-Sample-Rate") ?? "24000") ?? 24_000
        let (stream, continuation) = AsyncThrowingStream<Data, Error>.makeStream()
        let producer = Task {
            do {
                var chunk = Data(), complete = Data()
                var cacheable = true
                for try await byte in bytes {
                    try Task.checkCancellation()
                    chunk.append(byte)
                    if chunk.count == 960 {
                        continuation.yield(chunk)
                        if cacheable {
                            complete.append(chunk)
                            if complete.count > 4 * 1024 * 1024 { cacheable = false; complete = Data() }
                        }
                        chunk = Data()
                    }
                }
                try Task.checkCancellation()
                guard chunk.count.isMultiple(of: 2) else { throw APIError.server("Incomplete speech audio.") }
                if !chunk.isEmpty { continuation.yield(chunk); if cacheable { complete.append(chunk) } }
                if cacheable { self.speechCache.insert(complete, sampleRate: sampleRate, key: key) }
                continuation.finish()
            } catch { continuation.finish(throwing: error) }
        }
        continuation.onTermination = { _ in producer.cancel(); bytes.task.cancel() }
        return SpeechAudio(format: .pcm(sampleRate: sampleRate), chunks: stream,
                           cancel: { producer.cancel(); bytes.task.cancel() })
    }

    public func fetchNameKatakanaOptions(firstName: String, lastName: String) async throws -> NameKatakanaResult {
        struct Body: Encodable {
            let first_name: String
            let last_name: String
        }
        return try await request(
            "/context/name-katakana",
            method: "POST",
            body: Body(first_name: firstName, last_name: lastName)
        )
    }

    public func importGoogleMapsList(url: String) async throws -> MapsListImportResult {
        struct Body: Encodable {
            let url: String
        }
        return try await request(
            "/context/maps-list",
            method: "POST",
            body: Body(url: url)
        )
    }

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(path, method: "GET", body: Optional<EmptyBody>.none)
    }

    private func request<T: Decodable, Body: Encodable>(
        _ path: String,
        method: String,
        body: Body?
    ) async throws -> T {
        var request = URLRequest(url: configuration.apiBaseURL.appendingPath(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("OpenAI File Downloader, XaiImageApiFetch/1.0", forHTTPHeaderField: "User-Agent")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try encoder.encode(body)
        }
        AppLog.network.info("API request \(method, privacy: .public) \(path, privacy: .public)")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            AppLog.network.error("API request returned invalid response for \(method, privacy: .public) \(path, privacy: .public)")
            throw APIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let serverError = try? decoder.decode(ServerError.self, from: data)
            AppLog.network.error("API request failed \(method, privacy: .public) \(path, privacy: .public) status=\(http.statusCode)")
            throw APIError.server(serverError?.detail ?? "Request failed with status \(http.statusCode).")
        }
        AppLog.network.info("API request completed \(method, privacy: .public) \(path, privacy: .public) status=\(http.statusCode)")
        return try decoder.decode(T.self, from: data)
    }
}

private struct EmptyBody: Encodable {}

private struct DeleteSessionResponse: Decodable {
    var name: String
    var deleted: Bool
}

private struct ServerError: Decodable {
    var detail: String?
}

public enum APIError: LocalizedError, Sendable {
    case invalidResponse
    case server(String)

    public var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The backend returned an invalid response."
        case .server(let message):
            return message
        }
    }
}

private extension URL {
    func appendingPath(_ path: String) -> URL {
        guard var components = URLComponents(url: self, resolvingAgainstBaseURL: false) else {
            return self
        }
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let cleanPath = String(parts.first ?? "")
        if cleanPath.hasPrefix("/") {
            components.path = cleanPath
        } else {
            components.path = "/" + cleanPath
        }
        if parts.count > 1 {
            components.percentEncodedQuery = String(parts[1])
        } else {
            components.percentEncodedQuery = nil
        }
        return components.url ?? self.appendingPathComponent(path)
    }
}

private extension String {
    var urlPathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? self
    }
}
