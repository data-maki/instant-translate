import Foundation
import Testing
@testable import CottonohaCore

private final class StreamState: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var finished = false
    private var mode = "pcm"
    func reset(_ mode: String = "pcm") { lock.withLock { count = 0; finished = false; self.mode = mode } }
    func request() -> String { lock.withLock { count += 1; return mode } }
    func finish() { lock.withLock { finished = true } }
    var requests: Int { lock.withLock { count } }
    var ended: Bool { lock.withLock { finished } }
}

private final class SpeechProtocol: URLProtocol, @unchecked Sendable {
    static let state = StreamState()
    private let lock = NSLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() { lock.withLock { stopped = true } }
    override func startLoading() {
        let mode = Self.state.request()
        let legacy = request.url!.path == "/tts/speak"
        let status = mode == "fallback" && !legacy ? 404 : 200
        let headers = ["Content-Type": legacy ? "application/json" : "application/octet-stream", "X-Audio-Sample-Rate": "24000"]
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
        if status == 404 { client?.urlProtocolDidFinishLoading(self); return }
        if legacy {
            client?.urlProtocol(self, didLoad: Data(#"{"audio_base64":"AQID","mime_type":"audio/mpeg"}"#.utf8))
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        client?.urlProtocol(self, didLoad: Data(repeating: 1, count: 960))
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.15) { [self] in
            guard !lock.withLock({ stopped }) else { return }
            if mode == "fail" { client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost)); return }
            client?.urlProtocol(self, didLoad: Data(repeating: 2, count: 960))
            Self.state.finish()
            client?.urlProtocolDidFinishLoading(self)
        }
    }
}

@Suite(.serialized) struct SpeechStreamTests {
    private func client() -> CottonohaAPIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SpeechProtocol.self]
        return CottonohaAPIClient(configuration: AppConfiguration(apiBaseURL: URL(string: "http://speech.invalid")!), session: URLSession(configuration: config))
    }

    @Test func firstChunkArrivesBeforeEOFAndCompletedAudioIsCached() async throws {
        SpeechProtocol.state.reset()
        let api = client()
        let audio = try await api.streamSpeech(text: "Здравей", language: "bg", voice: nil)
        var data = Data()
        for try await chunk in audio.chunks {
            if data.isEmpty { #expect(!SpeechProtocol.state.ended) }
            data.append(chunk)
        }
        #expect(data.count == 1920)
        let cached = try await api.streamSpeech(text: "Здравей", language: "bg", voice: nil)
        var replay = Data()
        for try await chunk in cached.chunks { replay.append(chunk) }
        #expect(replay == data)
        #expect(SpeechProtocol.state.requests == 1)
    }

    @Test func cancelledOrFailedStreamsCannotPopulateCache() async throws {
        for mode in ["pcm", "fail"] {
            SpeechProtocol.state.reset(mode)
            let api = client()
            let audio = try await api.streamSpeech(text: "Hello", language: "en", voice: nil)
            var iterator = audio.chunks.makeAsyncIterator()
            _ = try await iterator.next()
            if mode == "pcm" { audio.cancel() }
            do {
                while let _ = try await iterator.next() {}
                Issue.record("Expected an interrupted stream")
            } catch {}
            let retry = try await api.streamSpeech(text: "Hello", language: "en", voice: nil)
            #expect(SpeechProtocol.state.requests == 2)
            retry.cancel()
        }
    }

    @Test func oldBackendFallsBackToMP3() async throws {
        SpeechProtocol.state.reset("fallback")
        let audio = try await client().streamSpeech(text: "Hello", language: "en", voice: nil)
        #expect(audio.format == .mp3)
        var data = Data()
        for try await chunk in audio.chunks { data.append(chunk) }
        #expect(data == Data([1, 2, 3]))
        #expect(SpeechProtocol.state.requests == 2)
    }
}
