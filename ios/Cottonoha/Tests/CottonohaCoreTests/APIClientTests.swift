import Foundation
import Testing
@testable import CottonohaCore

private final class RequestState: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    private var response = "{}"
    private var delay = false

    func prepare(_ body: String, delayed: Bool = false) {
        lock.withLock { requests = []; response = body; delay = delayed }
    }
    func record(_ request: URLRequest) -> (String, Bool) {
        lock.withLock { requests.append(request); return (response, delay) }
    }
    var received: [URLRequest] { lock.withLock { requests } }
}

private final class StubProtocol: URLProtocol, @unchecked Sendable {
    static let state = RequestState()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (body, delayed) = Self.state.record(request)
        if delayed { Thread.sleep(forTimeInterval: 0.1) }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite(.serialized) @MainActor struct APIClientTests {
    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: config)
    }
    private let config = AppConfiguration(apiBaseURL: URL(string: "http://test.invalid:8001")!)

    @Test func paginationIsAQueryNotPartOfThePath() async throws {
        StubProtocol.state.prepare(#"{"sessions":[],"total":0}"#)
        let client = CottonohaAPIClient(configuration: config, session: session())
        _ = try await client.fetchSessions(limit: 24, offset: 48)
        let request = try #require(StubProtocol.state.received.first)
        #expect(request.url?.path == "/sessions")
        #expect(request.url?.query == "limit=24&offset=48")
        #expect(request.url?.port == 8001)
    }

    @Test func renameDecodesTheActualBackendShape() async throws {
        StubProtocol.state.prepare(#"{"name":"meeting","title":"Dinner plans"}"#)
        let client = CottonohaAPIClient(configuration: config, session: session())
        let response = try await client.renameSession("meeting", title: "Dinner plans")
        #expect(response.title == "Dinner plans")
        #expect(StubProtocol.state.received.first?.httpMethod == "PATCH")
    }

    @Test func cleanupReturnsCorrectedPhrases() async throws {
        StubProtocol.state.prepare(#"{"session":"meeting","token_count":3,"phrases":[],"speaker_count":2,"speaker_audit":{"status":"needs_review","summary":"Possible merged voices near 0:20."}}"#)
        let client = CottonohaAPIClient(configuration: config, session: session())
        let response = try await client.rediarizeSession("meeting")
        #expect(response.session == "meeting")
        #expect(response.tokenCount == 3)
        #expect(response.phrases == [])
        #expect(response.speakerAudit?.status == "needs_review")
        #expect(response.speakerAudit?.summary == "Possible merged voices near 0:20.")
    }

    @Test func typedTranslationDecodesItsResult() async throws {
        StubProtocol.state.prepare(#"{"target_translation":"Здравей"}"#)
        let client = CottonohaAPIClient(configuration: config, session: session())
        let response = try await client.translatePhrase(sourceLanguage: "en", targetLanguage: "bg", sourceText: "Hello", audience: "friends")
        #expect(response.targetTranslation == "Здравей")
        #expect(StubProtocol.state.received.first?.url?.path == "/context/translate")
    }

    @Test func newChatInvalidatesPendingHistoryLoad() async throws {
        StubProtocol.state.prepare(#"{"session":{"name":"old","title":"Old topic","source_languages":["bg"],"target_language":"en"},"phrases":[]}"#, delayed: true)
        let model = TranslatorViewModel(configuration: config, session: session())
        let summary = SessionSummary(name: "old", title: "Old topic", tokenCount: 0)
        let request = Task { await model.loadSession(summary) }
        for _ in 0..<100 {
            if !StubProtocol.state.received.isEmpty { break }
            try await Task.sleep(for: .milliseconds(1))
        }
        #expect(!StubProtocol.state.received.isEmpty)
        model.newChat()
        await request.value
        #expect(model.activeSessionName.isEmpty)
        #expect(model.activeSessionTitle == "New chat")
        #expect(model.status == .idle)
        #expect(!model.loadingSession)
    }

    @Test func loadingHistoryShowsItsTitleAndPreservesContext() async {
        StubProtocol.state.prepare(#"{"session":{"name":"old","title":"Old topic","source_languages":["bg"],"target_language":"en","context":"Dinner\n[Traveler profile]private[/Traveler profile]"},"phrases":[]}"#)
        let model = TranslatorViewModel(configuration: config, session: session())
        await model.loadSession(SessionSummary(name: "old", title: "Old topic", tokenCount: 0))
        #expect(model.activeSessionName == "old")
        #expect(model.context == "Dinner")
        #expect(model.status == .stopped)
    }
    @Test func existingTranslationsMakeNoExtraRequestsInEitherDisplayMode() async {
        StubProtocol.state.prepare("{}")
        let model = TranslatorViewModel(configuration: config, session: session())
        model.sourceLanguages = ["bg"]
        let phrase = Phrase(id: "one", speaker: nil, speakerLabel: "You", sourceLanguage: "en",
            texts: ["en": "Hello", "bg": "Здравей"], romajiJa: nil, isFinal: true, time: nil)
        for enhanced in [true, false] {
            model.showEnhancedText = enhanced
            model.applyTranscript([phrase], tokenCount: 1)
            for _ in 0..<20 { await Task.yield() }
            #expect(model.bestText(for: phrase, language: "bg") == "Здравей")
        }
        #expect(StubProtocol.state.received.isEmpty)
    }

    @Test func missingTranslationIsRequestedOnceAndCannotOverrideLiveText() async throws {
        StubProtocol.state.prepare(#"{"target_translation":"Fallback"}"#, delayed: true)
        let model = TranslatorViewModel(configuration: config, session: session())
        model.sourceLanguages = ["bg"]
        var phrase = Phrase(id: "one", speaker: nil, speakerLabel: "You", sourceLanguage: "en",
            texts: ["en": "Hello"], romajiJa: nil, isFinal: true, time: nil)
        for _ in 0..<3 { model.applyTranscript([phrase], tokenCount: 1) }
        for _ in 0..<100 {
            if !StubProtocol.state.received.isEmpty { break }
            try await Task.sleep(for: .milliseconds(1))
        }
        phrase.texts["bg"] = "Live translation"
        model.applyTranscript([phrase], tokenCount: 1)
        try await Task.sleep(for: .milliseconds(150))
        #expect(StubProtocol.state.received.count == 1)
        #expect(StubProtocol.state.received.first?.url?.path == "/context/translate")
        #expect(model.bestText(for: model.phrases[0], language: "bg") == "Live translation")
    }

    @Test func newChatDiscardsPendingFallbackTranslation() async throws {
        StubProtocol.state.prepare(#"{"target_translation":"Old fallback"}"#, delayed: true)
        let model = TranslatorViewModel(configuration: config, session: session())
        model.sourceLanguages = ["bg"]
        let phrase = Phrase(id: "old", speaker: nil, speakerLabel: "You", sourceLanguage: "en",
            texts: ["en": "Old"], romajiJa: nil, isFinal: true, time: nil)
        model.applyTranscript([phrase], tokenCount: 1)
        for _ in 0..<100 {
            if !StubProtocol.state.received.isEmpty { break }
            try await Task.sleep(for: .milliseconds(1))
        }
        model.newChat()
        try await Task.sleep(for: .milliseconds(150))
        #expect(model.phrases.isEmpty)
        #expect(model.adaptations.isEmpty)
        #expect(model.errorMessage.isEmpty)
    }

}
