import Foundation
import Combine

@MainActor
public final class TranslatorViewModel: ObservableObject {
    public enum Status: String, Sendable {
        case idle = "Idle"
        case connecting = "Connecting"
        case listening = "Listening"
        case stopping = "Stopping"
        case stopped = "Stopped"
        case error = "Needs attention"
    }

    @Published public private(set) var languages: [Language] = []
    @Published public var sourceLanguages: [String] = ["ja"]
    @Published public var targetLanguage = "en"
    @Published public var expectedSpeakerCount = 2
    @Published public var context = ""
    @Published public var profile = TravelerProfile()
    @Published public private(set) var phrases: [Phrase] = []
    @Published public private(set) var sessions: [SessionSummary] = []
    @Published public private(set) var activeSessionTitle = "New chat"
    @Published public private(set) var tokenCount = 0
    @Published public private(set) var status: Status = .idle
    @Published public private(set) var errorMessage = ""
    @Published public var realtimeEnabled = true
    @Published public var microphoneEnabled = true
    @Published public var englishToTargetSpeakerEnabled = true
    @Published public var targetToEnglishSpeakerEnabled = true

    private let configuration: AppConfiguration
    private let api: CottonohaAPIClient
    private let profileStore = TravelerProfileStore()
    private let player = PCMPlayer()
    private var socket: WebSocketTranscriptionClient?
    private var recorder: AudioRecorder?
    private var shouldSendAudio = true

    public init(configuration: AppConfiguration) {
        self.configuration = configuration
        self.api = CottonohaAPIClient(configuration: configuration)
        self.profile = profileStore.load()
    }

    public var isLive: Bool {
        status == .connecting || status == .listening
    }

    public var targetShortName: String {
        targetLanguage.uppercased()
    }

    public func loadInitialData() async {
        do {
            let response = try await api.fetchLanguages()
            languages = response.languages
            sourceLanguages = response.defaultSourceLanguages
            targetLanguage = response.defaultTargetLanguage
            try await refreshSessions()
        } catch {
            errorMessage = friendlyError(error)
            status = .error
        }
    }

    public func refreshSessions() async throws {
        let response = try await api.fetchSessions(limit: 12)
        sessions = response.sessions
    }

    public func loadSession(_ session: SessionSummary) async {
        do {
            let detail = try await api.fetchSessionDetail(session.name)
            phrases = detail.phrases ?? []
            activeSessionTitle = detail.session?.title ?? session.title
            sourceLanguages = detail.session?.sourceLanguages ?? session.sourceLanguages ?? sourceLanguages
            targetLanguage = detail.session?.targetLanguage ?? session.targetLanguage ?? targetLanguage
            tokenCount = phrases.count
        } catch {
            errorMessage = friendlyError(error)
        }
    }

    public func toggleSourceLanguage(_ code: String) {
        guard !isLive, code != targetLanguage else { return }
        if sourceLanguages.contains(code) {
            let next = sourceLanguages.filter { $0 != code }
            if !next.isEmpty {
                sourceLanguages = next
            }
        } else {
            sourceLanguages.append(code)
        }
    }

    public func setTargetLanguage(_ code: String) {
        guard !isLive else { return }
        targetLanguage = code
        sourceLanguages.removeAll { $0 == code }
        if sourceLanguages.isEmpty {
            sourceLanguages = [code == "en" ? "ja" : "en"]
        }
    }

    public func saveProfile() {
        profileStore.save(profile)
    }

    public func start() async {
        errorMessage = ""
        phrases = []
        activeSessionTitle = realtimeEnabled ? "Realtime overdub" : "New chat"
        tokenCount = 0
        shouldSendAudio = microphoneEnabled
        status = .connecting

        do {
            let socket = WebSocketTranscriptionClient(url: configuration.websocketURL)
            self.socket = socket

            let startMessage = StartTranscriptionMessage(
                sourceLanguages: Array(dictUniquing(sourceLanguages + [targetLanguage])),
                targetLanguage: targetLanguage,
                expectedSpeakerCount: expectedSpeakerCount,
                enableOpenAIRealtime: realtimeEnabled,
                context: mergedContext
            )

            try await socket.connect(
                startMessage: startMessage,
                onEvent: { [weak self] event in
                    await self?.handle(event)
                },
                onError: { [weak self] message in
                    await self?.fail(message)
                }
            )

            let recorder = AudioRecorder()
            self.recorder = recorder
            try recorder.start { [weak self] data in
                Task {
                    guard let self else { return }
                    await self.sendAudioIfNeeded(data)
                }
            }
            status = .listening
        } catch {
            fail(friendlyError(error))
            await stop()
        }
    }

    public func stop() async {
        status = .stopping
        recorder?.stop()
        recorder = nil
        await socket?.stop()
        socket = nil
        player.stop()
        status = .stopped
        try? await refreshSessions()
    }

    public func toggleMicrophone() {
        microphoneEnabled.toggle()
        shouldSendAudio = microphoneEnabled
    }

    public func toggleEnglishToTargetSpeaker() {
        englishToTargetSpeakerEnabled.toggle()
    }

    public func toggleTargetToEnglishSpeaker() {
        targetToEnglishSpeakerEnabled.toggle()
    }

    private var mergedContext: String {
        [context, profile.sonioxContext]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    private func sendAudioIfNeeded(_ data: Data) async {
        guard shouldSendAudio else { return }
        await socket?.sendAudio(data)
    }

    private func handle(_ event: TranscriptEvent) async {
        switch event {
        case .status(let value):
            status = value == "listening" ? .listening : .stopped
        case .session(let session):
            activeSessionTitle = session.title ?? "New chat"
            tokenCount = session.tokenCount
        case .transcript(let nextPhrases, let finalTokenCount):
            phrases = nextPhrases
            tokenCount = finalTokenCount
        case .providerUpdate(let update):
            appendProviderBubble(update)
        case .realtimeAudio(let audio):
            guard realtimeEnabled else { return }
            player.playBase64PCM16(audio.audio, sampleRate: audio.sampleRate)
        case .saved(let saved):
            activeSessionTitle = saved.title ?? "New chat"
            phrases = saved.phrases
            tokenCount = saved.tokenCount
            status = .stopped
            try? await refreshSessions()
        case .error(let message):
            fail(message)
        }
    }

    private func appendProviderBubble(_ update: ProviderUpdate) {
        guard update.kind == "transcript" || update.kind == "translation" else {
            if update.kind == "error" { errorMessage = update.text }
            return
        }
        let language = update.kind == "translation" ? targetLanguage : sourceLanguages.first ?? "en"
        let phrase = Phrase(
            id: "provider-\(update.kind)-\(Date().timeIntervalSince1970)",
            speaker: FlexibleString(update.provider),
            speakerLabel: update.provider,
            sourceLanguage: language,
            texts: [language: update.text],
            romajiJa: nil,
            isFinal: update.isFinal,
            time: nil
        )
        phrases.append(phrase)
    }

    private func fail(_ message: String) {
        errorMessage = message
        status = .error
    }

    private func friendlyError(_ error: Error) -> String {
        if error.localizedDescription.lowercased().contains("permission") {
            return "Microphone permission was blocked. Enable microphone access in Settings and try again."
        }
        return error.localizedDescription
    }
}

private func dictUniquing(_ values: [String]) -> OrderedSetShim {
    OrderedSetShim(values)
}

private struct OrderedSetShim: Sequence {
    private let values: [String]

    init(_ input: [String]) {
        var seen = Set<String>()
        values = input.filter { seen.insert($0).inserted }
    }

    func makeIterator() -> IndexingIterator<[String]> {
        values.makeIterator()
    }
}

public final class TravelerProfileStore: Sendable {
    private let key = "cottonoha.traveler-profile.v1"

    public init() {}

    public func load() -> TravelerProfile {
        guard let data = UserDefaults.standard.data(forKey: key),
              let profile = try? JSONDecoder().decode(TravelerProfile.self, from: data) else {
            return TravelerProfile()
        }
        return profile
    }

    public func save(_ profile: TravelerProfile) {
        guard let data = try? JSONEncoder().encode(profile) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}
