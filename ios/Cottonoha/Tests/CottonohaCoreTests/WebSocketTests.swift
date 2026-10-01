import Foundation
import Testing
@testable import CottonohaCore

private actor Frames {
    var stopped = false
    var cancelled = false
    var receivedTitle: String?
    var errors: [String] = []
    var buffered: [URLSessionWebSocketTask.Message] = []
    var pending: CheckedContinuation<URLSessionWebSocketTask.Message, Error>?
    var stopWaiter: CheckedContinuation<Void, Never>?

    func markStopped() { stopped = true; stopWaiter?.resume(); stopWaiter = nil }
    func waitForStop() async {
        if !stopped { await withCheckedContinuation { stopWaiter = $0 } }
    }
    func next() async throws -> URLSessionWebSocketTask.Message {
        if cancelled { throw CancellationError() }
        if !buffered.isEmpty { return buffered.removeFirst() }
        return try await withCheckedThrowingContinuation { pending = $0 }
    }
    func emit(_ json: String) {
        let message = URLSessionWebSocketTask.Message.string(json)
        if let receiver = pending { pending = nil; receiver.resume(returning: message) }
        else { buffered.append(message) }
    }
    func cancel() {
        cancelled = true
        pending?.resume(throwing: CancellationError())
        pending = nil
    }
    func record(_ event: TranscriptEvent) {
        if case .saved(let saved) = event { receivedTitle = saved.title }
    }
    func recordError(_ message: String) { errors.append(message) }
}

private final class FakeSocket: TranscriptionSocket, Sendable {
    let frames = Frames()
    func resume() {}
    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        if case .string(let value) = message,
           let data = value.data(using: .utf8),
           let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
           object["type"] as? String == "stop" { await frames.markStopped() }
    }
    func receive() async throws -> URLSessionWebSocketTask.Message { try await frames.next() }
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        Task { await frames.cancel() }
    }
}

@Test func stopReceivesTheSavedTitleBeforeClosing() async throws {
    let socket = FakeSocket()
    let frames = socket.frames
    let client = WebSocketTranscriptionClient(url: URL(string: "ws://test.invalid")!, socket: socket)
    try await client.connect(
        startMessage: StartTranscriptionMessage(sourceLanguages: ["bg", "en"], targetLanguage: "en", enableOpenAIRealtime: false, context: ""),
        onEvent: { await frames.record($0) }, onError: { await frames.recordError($0) }
    )
    let stopping = Task { await client.stop() }
    await frames.waitForStop()
    #expect(await frames.stopped)
    #expect(await !frames.cancelled)
    await frames.emit(#"{"type":"saved","session":"meeting","path":"/saved","title":"Dinner plans","phrases":[],"token_count":3}"#)
    await frames.emit(#"{"type":"status","status":"stopped"}"#)
    await stopping.value
    #expect(await frames.receivedTitle == "Dinner plans")
    #expect(await frames.errors.isEmpty)
}
