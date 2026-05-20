import Foundation

public actor WebSocketTranscriptionClient {
    private let url: URL
    private var task: URLSessionWebSocketTask?
    private let session: URLSession
    private let encoder = JSONEncoder()

    public init(url: URL, session: URLSession = .shared) {
        self.url = url
        self.session = session
    }

    public func connect(
        startMessage: StartTranscriptionMessage,
        onEvent: @escaping @Sendable (TranscriptEvent) async -> Void,
        onError: @escaping @Sendable (String) async -> Void
    ) async throws {
        let socket = session.webSocketTask(with: url)
        task = socket
        socket.resume()
        AppLog.realtime.info("WebSocket connecting to \(self.url.absoluteString, privacy: .public)")
        try await sendJSON(startMessage)
        Task {
            await self.receiveLoop(onEvent: onEvent, onError: onError)
        }
    }

    public func sendAudio(_ data: Data) async {
        guard let task else { return }
        do {
            try await task.send(.data(data))
        } catch {
            AppLog.realtime.error("Failed to send audio chunk: \(error.localizedDescription, privacy: .public)")
        }
    }

    public func stop() async {
        AppLog.realtime.info("Stopping WebSocket transcription")
        try? await sendJSON(["type": "stop"])
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
    }

    private func receiveLoop(
        onEvent: @escaping @Sendable (TranscriptEvent) async -> Void,
        onError: @escaping @Sendable (String) async -> Void
    ) async {
        guard let task else { return }
        while true {
            do {
                let message = try await task.receive()
                let data: Data
                switch message {
                case .data(let payload):
                    data = payload
                case .string(let payload):
                    data = Data(payload.utf8)
                @unknown default:
                    continue
                }
                let event = try TranscriptEventDecoder.decode(data)
                AppLog.realtime.debug("Received transcript event")
                await onEvent(event)
            } catch {
                AppLog.realtime.error("WebSocket receive loop failed: \(error.localizedDescription, privacy: .public)")
                await onError(error.localizedDescription)
                break
            }
        }
    }

    private func sendJSON<T: Encodable>(_ value: T) async throws {
        guard let task else { return }
        let data = try encoder.encode(value)
        let string = String(decoding: data, as: UTF8.self)
        try await task.send(.string(string))
    }
}
