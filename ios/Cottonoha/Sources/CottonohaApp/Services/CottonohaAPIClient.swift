import Foundation

public actor CottonohaAPIClient {
    private let configuration: AppConfiguration
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(configuration: AppConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    public func fetchLanguages() async throws -> LanguagesResponse {
        try await get("/languages")
    }

    public func fetchSessions(limit: Int? = 8) async throws -> SessionsResponse {
        let path = limit.map { "/sessions?limit=\($0)" } ?? "/sessions"
        return try await get(path)
    }

    public func fetchSessionDetail(_ name: String) async throws -> SessionDetailResponse {
        try await get("/sessions/\(name.urlPathEncoded)")
    }

    public func renameSession(_ name: String, title: String) async throws -> SessionSummary {
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
        if path.hasPrefix("/") {
            components.path = path
        } else {
            components.path = "/" + path
        }
        return components.url ?? self.appendingPathComponent(path)
    }
}

private extension String {
    var urlPathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? self
    }
}
