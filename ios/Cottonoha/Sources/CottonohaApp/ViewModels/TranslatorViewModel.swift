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
    enum SpeechState { case loading, playing, error }
    @Published private(set) var speechKey: String?
    @Published private(set) var speechState: SpeechState?
    @Published public private(set) var katakanaSuggestions: [NameKatakanaOption] = []
    @Published public private(set) var katakanaSuggestStatus = ""
    @Published public private(set) var mapsImportStatus = ""
    @Published public private(set) var sessionTotal = 0
    @Published public private(set) var loadingMoreSessions = false
    @Published public private(set) var historyStatus = ""
    @Published public private(set) var improvingTranscript = false
    @Published public private(set) var improveStatus = ""
    @Published public var typedText = ""
    @Published public var showEnhancedText = false
    @Published public var showRomaji = false
    @Published public var autoSpeakEnabled = false {
        didSet { speechQueue.setEnabled(autoSpeakEnabled && !realtimeEnabled, phrases: phrases, language: autoSpeakLanguage) }
    }
    @Published public var realtimeEnabled = false {
        didSet { resetSpeechQueue() }
    }
    @Published public private(set) var loadingSession = false
    @Published public var microphoneEnabled = true
    @Published public var voiceOutputEnabled = true
    @Published public var englishToTargetSpeakerEnabled = true
    @Published public var targetToEnglishSpeakerEnabled = true
    @Published public private(set) var audioChunkCount = 0
    @Published public private(set) var backendEventCount = 0
    @Published public private(set) var lastBackendEvent = "Not connected"
    @Published public private(set) var audioLevel: Double = 0
    @Published public private(set) var backendConfirmedListening = false

    private static let autoImproveDelay: UInt64 = 2 * 60 * 1_000_000_000
    private static let sessionPageSize = 24

    private let configuration: AppConfiguration
    private let api: CottonohaAPIClient
    private let profileStore = TravelerProfileStore()
    private let player = PCMPlayer()
    private let ttsPlayer = TTSPlayer()
    private var socket: WebSocketTranscriptionClient?
    private var recorder: AudioRecorder?
    private var shouldSendAudio = true
    private var autoImproveTask: Task<Void, Never>?
    private var loadGeneration = UUID()
    private var connectionGeneration = UUID()
    private var translationTasks: [String: Task<Void, Never>] = [:]
    private var requestedTranslations: Set<String> = []
    private lazy var speechQueue = SpeechQueue(
        play: { [weak self] item, audio in try await self?.playSpeech(item, prepared: audio) },
        stop: { [weak self] in
            self?.ttsPlayer.stop()
            self?.speechKey = nil
            self?.speechState = nil
        },
        text: { [weak self] phrase, language in self?.bestText(for: phrase, language: language) ?? "" },
        prepare: { [weak self] item in
            guard let self else { throw CancellationError() }
            return try await prepareSpeech(item)
        }
    )

    private var autoSpeakLanguage: String {
        targetLanguage == "en" ? sourceLanguages.first(where: { $0 != "en" }) ?? "" : targetLanguage
    }

    private func resetSpeechQueue() {
        speechQueue.reset(phrases, language: autoSpeakLanguage, enabled: autoSpeakEnabled && !realtimeEnabled)
    }

    public init(configuration: AppConfiguration, session: URLSession = .shared) {
        self.configuration = configuration
        self.api = CottonohaAPIClient(configuration: configuration, session: session)
        self.profile = profileStore.load()
    }

    public var isLive: Bool {
        status == .connecting || status == .listening
    }

    public var targetShortName: String {
        targetLanguage.uppercased()
    }

    public var primarySourceLanguage: String {
        sourceLanguages.first { $0 != targetLanguage } ?? sourceLanguages.first ?? "en"
    }

    public var primarySourceShortName: String {
        primarySourceLanguage.uppercased()
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
        let response = try await api.fetchSessions(limit: Self.sessionPageSize)
        sessions = response.sessions
        sessionTotal = response.total
    }

    public func loadMoreSessions() async {
        guard !loadingMoreSessions, sessions.count < sessionTotal else { return }
        loadingMoreSessions = true
        defer { loadingMoreSessions = false }
        do {
            let response = try await api.fetchSessions(limit: Self.sessionPageSize, offset: sessions.count)
            let existing = Set(sessions.map(\.name))
            sessions.append(contentsOf: response.sessions.filter { !existing.contains($0.name) })
            sessionTotal = response.total
            historyStatus = ""
        } catch {
            historyStatus = friendlyError(error)
        }
    }

    public func loadSession(_ session: SessionSummary) async {
        guard !isLive, status != .stopping, !improvingTranscript else { return }
        cancelAutoImprove()
        cancelTranslations()
        resetSpeechQueue()
        connectionGeneration = UUID()
        let request = UUID()
        loadGeneration = request
        loadingSession = true
        defer { if loadGeneration == request { loadingSession = false } }
        do {
            let detail = try await api.fetchSessionDetail(session.name)
            guard loadGeneration == request else { return }
            phrases = detail.phrases ?? []
            adaptations = detail.adaptations ?? [:]
            activeSessionName = detail.session?.name ?? session.name
            activeSessionTitle = detail.session?.title ?? session.title
            sourceLanguages = detail.session?.sourceLanguages ?? session.sourceLanguages ?? sourceLanguages
            targetLanguage = detail.session?.targetLanguage ?? session.targetLanguage ?? targetLanguage
            context = stripKnownContextBlocks(detail.session?.context ?? context)
            resetSpeechQueue()
            status = .stopped
            tokenCount = phrases.count
            improveStatus = ""
            historyStatus = ""
        } catch {
            if loadGeneration == request { errorMessage = friendlyError(error) }
        }
    }

    public func renameSession(_ session: SessionSummary, title: String) async {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        do {
            let result = try await api.renameSession(session.name, title: trimmed)
            sessions = sessions.map { current in
                guard current.name == result.name else { return current }
                var updated = current
                updated.title = result.title
                return updated
            }
            if activeSessionName == result.name {
                activeSessionTitle = result.title
            }
            historyStatus = ""
        } catch {
            historyStatus = friendlyError(error)
        }
    }

    public func deleteSession(_ session: SessionSummary) async {
        if activeSessionName == session.name, isLive || status == .stopping {
            historyStatus = "Stop the current session before deleting it."
            return
        }
        do {
            try await api.deleteSession(session.name)
            sessions.removeAll { $0.name == session.name }
            sessionTotal = max(0, sessionTotal - 1)
            if activeSessionName == session.name {
                newChat()
            }
            historyStatus = ""
        } catch {
            historyStatus = friendlyError(error)
        }
    }

    public func improveActiveSession() async {
        let sessionName = activeSessionName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sessionName.isEmpty, !isLive, status != .stopping, !improvingTranscript, !loadingSession else { return }
        cancelAutoImprove()
        resetSpeechQueue()
        improvingTranscript = true
        improveStatus = "Improving transcript…"
        defer { improvingTranscript = false }
        var voiceReview = ""
        do {
            let diarized = try await api.rediarizeSession(sessionName)
            guard activeSessionName == sessionName else { return }
            voiceReview = diarized.speakerAudit?.summary ?? ""
            if let next = diarized.phrases, !next.isEmpty {
                phrases = next
            }
            let translated = try await api.retranslateSession(sessionName)
            guard activeSessionName == sessionName else { return }
            if let next = translated.phrases, !next.isEmpty {
                phrases = next
            }
            tokenCount = translated.tokenCount ?? diarized.tokenCount ?? phrases.count
            improveStatus = ["Transcript improved.", voiceReview].filter { !$0.isEmpty }.joined(separator: " ")
            resetSpeechQueue()
            try? await refreshSessions()
        } catch {
            if activeSessionName == sessionName {
                improveStatus = [voiceReview, friendlyError(error)].filter { !$0.isEmpty }.joined(separator: " ")
            }
        }
    }

    public func submitTypedText() async {
        let text = typedText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        typedText = ""
        let phraseId = "typed-\(UUID().uuidString)"
        let sourceLanguage = primarySourceLanguage
        let outputLanguage = targetLanguage
        let phrase = Phrase(
            id: phraseId,
            speaker: FlexibleString("typed"),
            speakerLabel: "You",
            sourceLanguage: sourceLanguage,
            texts: [sourceLanguage: text],
            romajiJa: nil,
            isFinal: true,
            time: nil
        )
        phrases.append(phrase)
        tokenCount = phrases.count

        guard sourceLanguage != targetLanguage else { return }
        do {
            let translated = try await api.translatePhrase(
                sourceLanguage: sourceLanguage,
                targetLanguage: outputLanguage,
                sourceText: text,
                audience: AudiencePreset.find(audiencePresetID).label
            )
            guard !translated.targetTranslation.isEmpty,
                  let index = phrases.firstIndex(where: { $0.id == phraseId }) else { return }
            phrases[index].texts[outputLanguage] = translated.targetTranslation
            speechQueue.update(phrases)
        } catch {
            errorMessage = friendlyError(error)
        }
    }

    var paragraphs: [TranscriptParagraph] { TranscriptPresentation.paragraphs(phrases) }

    public func adaptation(for phrase: Phrase, targetLang: String) -> PhraseAdaptation? {
        TranscriptPresentation.adaptation(phrase, language: targetLang, adaptations: adaptations)
    }

    public func bestText(for phrase: Phrase, language: String) -> String {
        TranscriptPresentation.text(phrase, language: language,
            target: phrase.sourceLanguage == targetLanguage ? primarySourceLanguage : targetLanguage,
            enhanced: showEnhancedText, adaptations: adaptations)
    }

    func paragraphText(_ phrases: [Phrase], language: String) -> String {
        phrases.map { bestText(for: $0, language: language).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }.joined(separator: " ")
    }

    func speakParagraph(_ phrases: [Phrase], language: String) async {
        let text = paragraphText(phrases, language: language)
        guard !text.isEmpty, let first = phrases.first else { return }
        await speechQueue.speakNow(SpeechItem(id: "paragraph:\(first.id)", text: text, language: language))
    }

    func playbackState(_ phrases: [Phrase], language: String) -> SpeechState? {
        guard let speechKey else { return nil }
        return speechKey == TranscriptPresentation.speechID(phrases, language: language)
            || phrases.contains { speechKey == "\($0.id):\(language)" } ? speechState : nil
    }

    private func prepareSpeech(_ item: SpeechItem) async throws -> SpeechAudio {
        let voice = item.language == "ja" && !profile.ttsVoiceId.isEmpty ? profile.ttsVoiceId : nil
        return try await api.streamSpeech(text: item.text, language: item.language, voice: voice)
    }

    private func playSpeech(_ item: SpeechItem, prepared: SpeechAudio?) async throws {
        let key = "\(item.id):\(item.language)"
        speechKey = key
        speechState = .loading
        do {
            let audio: SpeechAudio
            if let prepared { audio = prepared } else { audio = try await prepareSpeech(item) }
            if Task.isCancelled { audio.cancel(); throw CancellationError() }
            try await ttsPlayer.play(audio) { [weak self] in
                if self?.speechKey == key { self?.speechState = .playing }
            }
            if !Task.isCancelled, speechKey == key { speechKey = nil; speechState = nil }
        } catch {
            if !Task.isCancelled, speechKey == key {
                speechState = .error
                errorMessage = friendlyError(error)
            }
            throw error
        }
    }

    private func cancelTranslations() {
        translationTasks.values.forEach { $0.cancel() }
        translationTasks = [:]
        requestedTranslations = []
    }

    // Reuse Soniox text and saved fallbacks; request a missing language once.
    func applyTranscript(_ next: [Phrase], tokenCount: Int) {
        phrases = next
        self.tokenCount = tokenCount
        lastBackendEvent = next.isEmpty ? "Waiting for speech" : "Transcript received"
        speechQueue.update(phrases)
        completeMissingTranslations()
    }

    func completeMissingTranslations() {
        let connection = connectionGeneration
        let sessionName = activeSessionName
        for phrase in phrases where phrase.isFinal {
            let source = TranscriptPresentation.sourceLanguage(phrase, preferred: primarySourceLanguage)
            let target = source == targetLanguage ? primarySourceLanguage : targetLanguage
            let original = phrase.texts[source] ?? ""
            guard source != target, !original.isEmpty, bestText(for: phrase, language: target).isEmpty else { continue }
            let key = TranscriptPresentation.adaptationKey(phrase, language: target)
            guard requestedTranslations.insert(key).inserted else { continue }
            translationTasks[key] = Task { [weak self] in
                guard let self else { return }
                defer { if connectionGeneration == connection { translationTasks[key] = nil } }
                do {
                    let result = try await api.translatePhrase(sourceLanguage: source, targetLanguage: target,
                        sourceText: original, audience: AudiencePreset.find(audiencePresetID).label)
                    try Task.checkCancellation()
                    guard connectionGeneration == connection,
                          phrases.contains(where: { $0.id == phrase.id && $0.texts[source] == original }),
                          !result.targetTranslation.isEmpty else { return }
                    let value = PhraseAdaptation(targetTranslation: result.targetTranslation)
                    adaptations[key] = value
                    speechQueue.update(phrases)
                    if !sessionName.isEmpty, activeSessionName == sessionName {
                        try await api.saveAdaptation(sessionName, key: key, adaptation: value)
                    }
                } catch {
                    if !Task.isCancelled, connectionGeneration == connection { errorMessage = friendlyError(error) }
                }
            }
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
        guard !isLive, status != .stopping, !improvingTranscript else { return }
        cancelTranslations()
        loadGeneration = UUID()
        connectionGeneration = UUID()
        loadingSession = false
        cancelAutoImprove()
        activeSessionName = ""
        activeSessionTitle = "New chat"
        phrases = []
        adaptations = [:]
        typedText = ""
        tokenCount = 0
        errorMessage = ""
        improveStatus = ""
        resetSpeechQueue()
        resetRuntimeDiagnostics()
        status = .idle
    }

    public func toggleSourceLanguage(_ code: String) {
        guard !isLive, status != .stopping, !loadingSession, !improvingTranscript, code != targetLanguage else { return }
        if sourceLanguages.contains(code) {
            let next = sourceLanguages.filter { $0 != code }
            if !next.isEmpty {
                sourceLanguages = next
            }
        } else {
            sourceLanguages.append(code)
        }
        resetSpeechQueue()
    }

    public func setTargetLanguage(_ code: String) {
        guard !isLive, status != .stopping, !loadingSession, !improvingTranscript else { return }
        targetLanguage = code
        sourceLanguages.removeAll { $0 == code }
        if sourceLanguages.isEmpty {
            sourceLanguages = [code == "en" ? "ja" : "en"]
        }
        resetSpeechQueue()
    }

    public func saveProfile() {
        resetSpeechQueue()
        profileStore.save(profile)
    }

    public func start() async {
        guard !isLive, status != .stopping, !improvingTranscript, !loadingSession else { return }
        loadGeneration = UUID()
        cancelTranslations()
        let connection = UUID()
        connectionGeneration = connection
        cancelAutoImprove()
        let resumeSessionName = activeSessionName
        let isResuming = !resumeSessionName.isEmpty
        AppLog.realtime.info("Starting translation session realtime=\(self.realtimeEnabled) resume=\(isResuming) sourceLanguages=\(self.sourceLanguages.joined(separator: ","), privacy: .public) targetLanguage=\(self.targetLanguage, privacy: .public)")
        errorMessage = ""
        if !isResuming {
            phrases = []
            adaptations = [:]
            activeSessionTitle = realtimeEnabled ? "Realtime overdub" : "New chat"
            tokenCount = 0
        }
        resetSpeechQueue()
        resetRuntimeDiagnostics()
        shouldSendAudio = microphoneEnabled
        status = .connecting
        lastBackendEvent = "Opening connection"

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

            try await socket.connect(
                startMessage: startMessage,
                onEvent: { [weak self] event in
                    await self?.handle(event, connection: connection)
                },
                onError: { [weak self] message in
                    await self?.fail(message, connection: connection)
                }
            )
            guard connectionGeneration == connection, status == .connecting || status == .listening else { return }
            lastBackendEvent = "Connected"

            let recorder = AudioRecorder()
            self.recorder = recorder
            try recorder.start { [weak self] data in
                Task {
                    guard let self else { return }
                    await self.sendAudioIfNeeded(data)
                }
            }
            status = .listening
            lastBackendEvent = "Microphone ready"
            AppLog.realtime.info("Translation session listening")
        } catch {
            AppLog.realtime.error("Translation session failed to start: \(error.localizedDescription, privacy: .public)")
            fail(friendlyError(error))
            await stop()
        }
    }

    public func stop() async {
        guard status != .stopping else { return }
        let connection = connectionGeneration
        AppLog.realtime.info("Stopping translation session")
        status = .stopping
        recorder?.stop()
        recorder = nil
        await socket?.stop()
        guard connectionGeneration == connection else { return }
        socket = nil
        player.stop()
        status = .stopped
        lastBackendEvent = "Stopped"
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
                let reviewed = try await api.rediarizeSession(sessionName)
                if Task.isCancelled { return }
                if let self, self.activeSessionName == sessionName, !self.isLive {
                    self.improveStatus = reviewed.speakerAudit?.summary ?? ""
                }
                _ = try await api.retranslateSession(sessionName)
                AppLog.realtime.info("Auto-improve completed for session=\(sessionName, privacy: .public)")
            } catch {
                // Best-effort: a failure leaves the saved chat untouched.
                AppLog.realtime.warning("Auto-improve skipped for session=\(sessionName, privacy: .public): \(error.localizedDescription, privacy: .public)")
            }
            self?.clearAutoImproveTask()
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

    public func toggleVoiceOutput() {
        voiceOutputEnabled.toggle()
        englishToTargetSpeakerEnabled = voiceOutputEnabled
        targetToEnglishSpeakerEnabled = voiceOutputEnabled
    }

    private var mergedContext: String {
        [context, profile.sonioxContext]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    private func sendAudioIfNeeded(_ data: Data) async {
        guard shouldSendAudio else { return }
        audioChunkCount += 1
        audioLevel = Self.estimatedAudioLevel(from: data)
        if audioChunkCount == 1 {
            lastBackendEvent = "Streaming audio"
        }
        await socket?.sendAudio(data)
    }

    private func handle(_ event: TranscriptEvent, connection: UUID) async {
        guard connectionGeneration == connection else { return }
        backendEventCount += 1
        switch event {
        case .status(let value):
            if value == "stopped" { status = .stopped }
            else if value == "listening", status != .stopping { status = .listening }
            backendConfirmedListening = value == "listening"
            lastBackendEvent = value == "listening" ? "Backend listening" : "Backend stopped"
        case .session(let session):
            activeSessionName = session.name
            applyIncomingTitle(session.title)
            tokenCount = session.tokenCount
            lastBackendEvent = "Session ready"
        case .transcript(let nextPhrases, let finalTokenCount):
            applyTranscript(nextPhrases, tokenCount: finalTokenCount)
        case .providerUpdate(let update):
            appendProviderBubble(update)
            lastBackendEvent = update.kind == "error" ? "Provider error" : "Realtime update"
        case .realtimeAudio(let audio):
            guard realtimeEnabled, voiceOutputEnabled else { return }
            lastBackendEvent = "Voice audio received"
            player.playBase64PCM16(audio.audio, sampleRate: audio.sampleRate)
        case .saved(let saved):
            guard activeSessionName == saved.session else { return }
            applyIncomingTitle(saved.title)
            phrases = saved.phrases
            tokenCount = saved.tokenCount
            lastBackendEvent = "Saved"
            speechQueue.update(phrases)
            try? await refreshSessions()
        case .error(let message):
            lastBackendEvent = "Backend error"
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
        speechQueue.update(phrases)
    }

    private func resetRuntimeDiagnostics() {
        audioChunkCount = 0
        backendEventCount = 0
        lastBackendEvent = "Not connected"
        audioLevel = 0
        backendConfirmedListening = false
    }

    private static func estimatedAudioLevel(from data: Data) -> Double {
        let sampleCount = data.count / MemoryLayout<Int16>.size
        guard sampleCount > 0 else { return 0 }
        var sumSquares = 0.0
        var sampledCount = 0
        data.withUnsafeBytes { rawBuffer in
            guard let samples = rawBuffer.bindMemory(to: Int16.self).baseAddress else { return }
            let stride = max(1, sampleCount / 160)
            var index = 0
            while index < sampleCount {
                let normalized = Double(samples[index]) / Double(Int16.max)
                sumSquares += normalized * normalized
                sampledCount += 1
                index += stride
            }
        }
        return min(1, sqrt(sumSquares / Double(max(1, sampledCount))) * 5)
    }

    private func stripKnownContextBlocks(_ value: String) -> String {
        var result = value
        for (startMarker, endMarker) in [
            ("[Traveler profile]", "[/Traveler profile]"),
            ("[Japanese register preset]", "[/Japanese register preset]")
        ] {
            while let start = result.range(of: startMarker),
                  let end = result.range(of: endMarker, range: start.upperBound..<result.endIndex) {
                result.removeSubrange(start.lowerBound..<end.upperBound)
            }
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func fail(_ message: String, connection: UUID? = nil) {
        if let connection, connectionGeneration != connection { return }
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
