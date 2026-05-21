import Foundation
import Combine

/// Lets the view model read the BetterAuth bearer token without owning the
/// auth session. Implementations must be safe to read from any actor — the
/// API client calls this on its own actor before issuing a request.
public protocol BearerTokenSource: Sendable {
    func currentToken() async -> String?
}

public struct NoBearerToken: BearerTokenSource {
    public init() {}
    public func currentToken() async -> String? { nil }
}

/// Reads `bearerToken` from a `BetterAuthSession` on the main actor.
public struct AuthSessionTokenSource: BearerTokenSource {
    private let read: @Sendable () async -> String?

    public init(_ session: BetterAuthSession) {
        // Capture the session by reference but hop to the main actor to read
        // its @Published bearerToken safely.
        self.read = { [weak session] in
            await MainActor.run { session?.bearerToken }
        }
    }

    public func currentToken() async -> String? {
        await read()
    }
}

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
    @Published public var audiencePresetID = AudiencePreset.default
    @Published public var context = ""
    @Published public var profile = TravelerProfile()
    @Published public private(set) var phrases: [Phrase] = []
    @Published public private(set) var adaptations: [String: PhraseAdaptation] = [:]
    @Published public private(set) var sessions: [SessionSummary] = []
    @Published public private(set) var activeSessionName = ""
    @Published public private(set) var activeSessionTitle = "New chat"
    @Published public private(set) var tokenCount = 0
    @Published public private(set) var status: Status = .idle
    @Published public private(set) var errorMessage = ""
    @Published public private(set) var speakingPhraseId: String?
    @Published public private(set) var katakanaSuggestions: [NameKatakanaOption] = []
    @Published public private(set) var katakanaSuggestStatus = ""
    @Published public private(set) var mapsImportStatus = ""
    @Published public var realtimeEnabled = true
    @Published public var microphoneEnabled = true
    @Published public var englishToTargetSpeakerEnabled = true
    @Published public var targetToEnglishSpeakerEnabled = true

    private static let autoImproveDelay: UInt64 = 2 * 60 * 1_000_000_000

    private let configuration: AppConfiguration
    private let api: CottonohaAPIClient
    private let profileStore = TravelerProfileStore()
    private let player = PCMPlayer()
    private let ttsPlayer = TTSPlayer()
    private var socket: WebSocketTranscriptionClient?
    private var recorder: AudioRecorder?
    private var shouldSendAudio = true
    private var autoImproveTask: Task<Void, Never>?

    private let tokenSource: BearerTokenSource

    public init(configuration: AppConfiguration, tokenSource: BearerTokenSource = NoBearerToken()) {
        self.configuration = configuration
        self.tokenSource = tokenSource
        self.api = CottonohaAPIClient(
            configuration: configuration,
            tokenProvider: { await tokenSource.currentToken() }
        )
        self.profile = profileStore.load()
    }

    fileprivate func currentBearerToken() async -> String? {
        await tokenSource.currentToken()
    }

    public var isLive: Bool {
        status == .connecting || status == .listening
    }

    public var targetShortName: String {
        targetLanguage.uppercased()
    }

    public func loadInitialData() async {
        AppLog.app.info("Loading initial translator data")
        do {
            let response = try await api.fetchLanguages()
            languages = response.languages
            sourceLanguages = response.defaultSourceLanguages
            targetLanguage = response.defaultTargetLanguage
            try await refreshSessions()
            AppLog.app.info("Loaded initial data languages=\(response.languages.count) sessions=\(self.sessions.count)")
        } catch {
            AppLog.app.error("Initial data load failed: \(error.localizedDescription, privacy: .public)")
            errorMessage = friendlyError(error)
            status = .error
        }
    }

    public func refreshSessions() async throws {
        let response = try await api.fetchSessions(limit: 12)
        sessions = response.sessions
    }

    public func loadSession(_ session: SessionSummary) async {
        cancelAutoImprove()
        do {
            let detail = try await api.fetchSessionDetail(session.name)
            phrases = detail.phrases ?? []
            adaptations = detail.adaptations ?? [:]
            activeSessionName = detail.session?.name ?? session.name
            activeSessionTitle = detail.session?.title ?? session.title
            sourceLanguages = detail.session?.sourceLanguages ?? session.sourceLanguages ?? sourceLanguages
            targetLanguage = detail.session?.targetLanguage ?? session.targetLanguage ?? targetLanguage
            tokenCount = phrases.count
        } catch {
            errorMessage = friendlyError(error)
        }
    }

    /// Build the same adaptation key the desktop uses so the polished text
    /// from `/sessions/{name}` lines up with each phrase bubble.
    public func adaptation(for phrase: Phrase, targetLang: String) -> PhraseAdaptation? {
        let key = "\(phrase.id):\(targetLang)"
        return adaptations[key]
    }

    /// Text we'd actually want to *speak* — prefer the AI-enhanced rewrite
    /// when available, fall back to whatever the live pipeline produced.
    public func bestText(for phrase: Phrase, language: String) -> String {
        if language == phrase.sourceLanguage,
           let adaptation = adaptation(for: phrase, targetLang: targetLanguage),
           !adaptation.sourceRewrite.isEmpty {
            return adaptation.sourceRewrite
        }
        if let adaptation = adaptation(for: phrase, targetLang: language),
           !adaptation.targetTranslation.isEmpty {
            return adaptation.targetTranslation
        }
        return phrase.texts[language] ?? ""
    }

    public func speakPhrase(_ phrase: Phrase, language: String) async {
        let text = bestText(for: phrase, language: language).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        speakingPhraseId = phrase.id
        defer { speakingPhraseId = nil }
        // The voice picker is Japanese-only — only forward it when speaking ja.
        let voiceId = (language == "ja" && !profile.ttsVoiceId.isEmpty) ? profile.ttsVoiceId : nil
        do {
            let result = try await api.generateTts(
                text: text,
                targetLanguage: language,
                voiceId: voiceId
            )
            ttsPlayer.play(base64: result.audioBase64)
        } catch {
            errorMessage = friendlyError(error)
        }
    }

    public func suggestKatakana() async {
        let first = profile.firstName.trimmingCharacters(in: .whitespacesAndNewlines)
        let last = profile.lastName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !first.isEmpty || !last.isEmpty else {
            katakanaSuggestStatus = "Add your first or last name first."
            katakanaSuggestions = []
            return
        }
        katakanaSuggestStatus = "Looking up…"
        do {
            let result = try await api.fetchNameKatakanaOptions(firstName: first, lastName: last)
            katakanaSuggestions = result.options
            katakanaSuggestStatus = result.options.isEmpty
                ? "No suggestions returned."
                : ""
        } catch {
            katakanaSuggestions = []
            katakanaSuggestStatus = friendlyError(error)
        }
    }

    public func applyKatakanaOption(_ option: NameKatakanaOption) {
        profile.firstNameKatakana = option.firstKatakana
        profile.lastNameKatakana = option.lastKatakana
        saveProfile()
    }

    public func importGoogleMapsList(url: String) async {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            mapsImportStatus = "Paste a Google Maps list link first."
            return
        }
        mapsImportStatus = "Importing…"
        do {
            let result = try await api.importGoogleMapsList(url: trimmed)
            let lines = result.places.map { place -> String in
                if let addr = place.address, !addr.isEmpty {
                    return "\(place.name) — \(addr)"
                }
                return place.name
            }
            profile.savedPlaces = Self.mergeLines(existing: profile.savedPlaces, additions: lines)
            saveProfile()
            mapsImportStatus = "Imported \(result.places.count) places\(result.title.isEmpty ? "" : " from \(result.title)")."
        } catch {
            mapsImportStatus = friendlyError(error)
        }
    }

    private static func mergeLines(existing: String, additions: [String]) -> String {
        var seen = Set<String>()
        var result: [String] = []
        for raw in (existing.components(separatedBy: .newlines) + additions) {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty else { continue }
            let key = line.lowercased()
            if seen.insert(key).inserted {
                result.append(line)
            }
        }
        return result.joined(separator: "\n")
    }

    /// Reset the workspace so the next `start()` begins a brand-new session
    /// instead of extending the previous one. Equivalent to the desktop
    /// "New chat" button.
    public func newChat() {
        cancelAutoImprove()
        activeSessionName = ""
        activeSessionTitle = "New chat"
        phrases = []
        tokenCount = 0
        errorMessage = ""
        status = .idle
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
        cancelAutoImprove()
        let resumeSessionName = activeSessionName
        let isResuming = !resumeSessionName.isEmpty
        AppLog.realtime.info("Starting translation session realtime=\(self.realtimeEnabled) resume=\(isResuming) sourceLanguages=\(self.sourceLanguages.joined(separator: ","), privacy: .public) targetLanguage=\(self.targetLanguage, privacy: .public)")
        errorMessage = ""
        if !isResuming {
            phrases = []
            activeSessionTitle = realtimeEnabled ? "Realtime overdub" : "New chat"
            tokenCount = 0
        }
        shouldSendAudio = microphoneEnabled
        status = .connecting

        do {
            let socket = WebSocketTranscriptionClient(url: configuration.websocketURL)
            self.socket = socket

            var startMessage = StartTranscriptionMessage(
                sourceLanguages: Array(dictUniquing(sourceLanguages + [targetLanguage])),
                targetLanguage: targetLanguage,
                expectedSpeakerCount: expectedSpeakerCount,
                enableOpenAIRealtime: realtimeEnabled,
                context: mergedContext
            )
            startMessage.sessionName = resumeSessionName

            let token = await currentBearerToken()
            try await socket.connect(
                startMessage: startMessage,
                bearerToken: token,
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
            AppLog.realtime.info("Translation session listening")
        } catch {
            AppLog.realtime.error("Translation session failed to start: \(error.localizedDescription, privacy: .public)")
            fail(friendlyError(error))
            await stop()
        }
    }

    public func stop() async {
        AppLog.realtime.info("Stopping translation session")
        status = .stopping
        recorder?.stop()
        recorder = nil
        await socket?.stop()
        socket = nil
        player.stop()
        status = .stopped
        try? await refreshSessions()
        scheduleAutoImprove(for: activeSessionName)
        AppLog.realtime.info("Translation session stopped")
    }

    private func scheduleAutoImprove(for sessionName: String) {
        cancelAutoImprove()
        guard profile.autoImprove, !sessionName.isEmpty else { return }
        let api = self.api
        autoImproveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: TranslatorViewModel.autoImproveDelay)
            if Task.isCancelled { return }
            do {
                try await api.rediarizeSession(sessionName)
                if Task.isCancelled { return }
                try await api.retranslateSession(sessionName)
                AppLog.realtime.info("Auto-improve completed for session=\(sessionName, privacy: .public)")
            } catch {
                // Best-effort: a failure leaves the saved chat untouched.
                AppLog.realtime.warning("Auto-improve skipped for session=\(sessionName, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
            await self?.clearAutoImproveTask()
        }
    }

    private func cancelAutoImprove() {
        autoImproveTask?.cancel()
        autoImproveTask = nil
    }

    private func clearAutoImproveTask() {
        autoImproveTask = nil
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
            activeSessionName = session.name
            applyIncomingTitle(session.title)
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
            activeSessionName = saved.session
            applyIncomingTitle(saved.title)
            phrases = saved.phrases
            tokenCount = saved.tokenCount
            status = .stopped
            try? await refreshSessions()
        case .error(let message):
            fail(message)
        }
    }

    private func applyIncomingTitle(_ incoming: String?) {
        let candidate = (incoming ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        // On resume the backend re-emits "New chat" before the saved title is
        // restored — don't overwrite a real title we already have on screen.
        if !candidate.isEmpty, candidate.lowercased() != "new chat" {
            activeSessionTitle = candidate
        } else if activeSessionTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            activeSessionTitle = "New chat"
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
        AppLog.app.error("Translator entered error state: \(message, privacy: .public)")
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
