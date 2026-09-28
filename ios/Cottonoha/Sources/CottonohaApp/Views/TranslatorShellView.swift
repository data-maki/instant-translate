import SwiftUI

#if os(iOS)
import UIKit
#endif

struct TranslatorShellView: View {
    @StateObject private var model: TranslatorViewModel
    @State private var showingLanguages = false
    @State private var showingHistory = false
    @State private var showingProfile = false
    @State private var showingSettings = false
    @State private var showingComposer = false

    init(configuration: AppConfiguration) {
        _model = StateObject(wrappedValue: TranslatorViewModel(configuration: configuration))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                TranslatorTheme.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    HeaderBar(
                        model: model,
                        sourceTitle: sourceTitle,
                        targetTitle: targetTitle,
                        sourceName: languageName(model.primarySourceLanguage),
                        targetName: languageName(model.targetLanguage),
                        statusText: statusText,
                        onLanguages: { showingLanguages = true },
                        onHistory: { showingHistory = true },
                        onSettings: { showingSettings = true },
                        onProfile: { showingProfile = true }
                    )
                    content
                }
            }
            .safeAreaInset(edge: .bottom) {
                ActionDock(
                    model: model,
                    startTitle: startButtonTitle,
                    onStart: {
                        impact()
                        Task { await model.start() }
                    },
                    onStop: {
                        notification(.success)
                        Task { await model.stop() }
                    },
                    onCompose: { showingComposer = true }
                )
            }
            .preferredColorScheme(.light)
            .task {
                await model.loadInitialData()
            }
            .sheet(isPresented: $showingLanguages) {
                LanguagePickerSheet(model: model)
                    .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $showingHistory) {
                HistoryView(model: model)
                    .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $showingProfile) {
                NavigationStack {
                    ProfileView(model: model)
                }
                .presentationDetents([.large])
            }
            .sheet(isPresented: $showingSettings) {
                TranslatorSettingsSheet(model: model)
                    .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $showingComposer) {
                TextComposerSheet(model: model)
                    .presentationDetents([.height(260), .medium])
            }
        }
    }

    private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !model.errorMessage.isEmpty {
                        StatusBanner(
                            title: "Needs attention",
                            text: model.errorMessage,
                            tone: .danger
                        )
                    }
                    if !model.improveStatus.isEmpty {
                        StatusBanner(
                            title: "Transcript",
                            text: model.improveStatus,
                            tone: .neutral
                        )
                    }

                    LiveStatusPanel(model: model)

                    if let current = model.phrases.last {
                        SectionTitle("Current")
                        TranslationCard(
                            phrase: current,
                            targetLanguage: model.targetLanguage,
                            model: model,
                            isCurrent: true
                        )
                        .id(current.id)

                        let earlier = Array(model.phrases.dropLast())
                        if !earlier.isEmpty {
                            SectionTitle("Earlier")
                            ForEach(earlier) { phrase in
                                TranslationCard(
                                    phrase: phrase,
                                    targetLanguage: model.targetLanguage,
                                    model: model,
                                    isCurrent: false
                                )
                                .id(phrase.id)
                            }
                        }
                    } else {
                        ReadyPanel(
                            model: model,
                            sourceTitle: sourceTitle,
                            targetTitle: targetTitle,
                            onConfigure: { showingSettings = true }
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 170)
            }
            .scrollIndicators(.hidden)
            .onChange(of: model.phrases.count) { _, _ in
                guard let last = model.phrases.last else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    private var statusText: String {
        if !model.errorMessage.isEmpty {
            return "Needs attention"
        }
        if model.status == .connecting {
            return "Connecting"
        }
        if model.status == .stopping {
            return "Stopping"
        }
        if model.isLive {
            if model.audioChunkCount > 0 {
                return model.backendConfirmedListening ? "Listening" : "Streaming audio"
            }
            return "Mic ready"
        }
        if model.phrases.isEmpty {
            return "Ready"
        }
        return "Paused"
    }

    private var startButtonTitle: String {
        if model.status == .connecting {
            return "Connecting"
        }
        if !model.activeSessionName.isEmpty {
            return "Resume"
        }
        return "Start Listening"
    }

    private var sourceTitle: String {
        model.primarySourceShortName
    }

    private var targetTitle: String {
        model.targetShortName
    }

    private func languageName(_ code: String) -> String {
        model.languages.first { $0.code == code }?.name ?? code.uppercased()
    }
}

private enum TranslatorTheme {
    static let background = Color(red: 0.965, green: 0.972, blue: 0.958)
    static let surface = Color.white
    static let surfaceAlt = Color(red: 0.94, green: 0.955, blue: 0.948)
    static let ink = Color(red: 0.045, green: 0.058, blue: 0.075)
    static let muted = Color(red: 0.35, green: 0.39, blue: 0.43)
    static let faint = Color(red: 0.70, green: 0.73, blue: 0.74)
    static let line = Color(red: 0.83, green: 0.86, blue: 0.85)
    static let blue = Color(red: 0.05, green: 0.43, blue: 0.95)
    static let green = Color(red: 0.05, green: 0.55, blue: 0.31)
    static let red = Color(red: 0.88, green: 0.10, blue: 0.16)
    static let redSoft = Color(red: 1.0, green: 0.90, blue: 0.91)
}

private struct HeaderBar: View {
    @ObservedObject var model: TranslatorViewModel
    var sourceTitle: String
    var targetTitle: String
    var sourceName: String
    var targetName: String
    var statusText: String
    var onLanguages: () -> Void
    var onHistory: () -> Void
    var onSettings: () -> Void
    var onProfile: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Cottonoha")
                        .font(.system(size: 22, weight: .bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                        .foregroundStyle(TranslatorTheme.ink)
                    Text(model.activeSessionTitle)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                        .foregroundStyle(TranslatorTheme.muted)
                }

                Spacer(minLength: 8)

                HeaderIconButton(systemName: "square.and.pencil", label: "New chat", action: model.newChat)
                    .disabled(model.isLive || model.status == .stopping || model.improvingTranscript)
                HeaderIconButton(systemName: "clock", label: "History", action: onHistory)
                HeaderIconButton(systemName: "slider.horizontal.3", label: "Settings", action: onSettings)
                HeaderIconButton(systemName: "person.crop.circle", label: "Profile", action: onProfile)
            }

            HStack {
                StatusPill(text: statusText, isLive: model.isLive)
                Spacer()
                Text(model.realtimeEnabled ? "Realtime voice beta" : "Transcript mode")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TranslatorTheme.muted)
            }

            Button(action: onLanguages) {
                HStack(spacing: 10) {
                    LanguageBadge(code: sourceTitle, name: sourceName, isLeading: true)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(TranslatorTheme.muted)
                        .frame(width: 30, height: 30)
                        .background(TranslatorTheme.surfaceAlt, in: Circle())
                    LanguageBadge(code: targetTitle, name: targetName, isLeading: false)
                }
                .padding(10)
                .background(TranslatorTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(TranslatorTheme.line, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .disabled(model.isLive || model.status == .stopping || model.loadingSession || model.improvingTranscript)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 14)
        .background(TranslatorTheme.background)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(TranslatorTheme.line)
                .frame(height: 1)
        }
    }
}

private struct HeaderIconButton: View {
    var systemName: String
    var label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(TranslatorTheme.ink)
                .frame(width: 36, height: 36)
                .background(TranslatorTheme.surface, in: Circle())
                .overlay(Circle().stroke(TranslatorTheme.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

private struct StatusPill: View {
    var text: String
    var isLive: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(isLive ? TranslatorTheme.green : TranslatorTheme.faint)
                .frame(width: 7, height: 7)
            Text(text)
                .font(.system(size: 12, weight: .bold))
                .lineLimit(1)
        }
        .foregroundStyle(isLive ? TranslatorTheme.green : TranslatorTheme.muted)
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(isLive ? TranslatorTheme.green.opacity(0.10) : TranslatorTheme.surface)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(isLive ? TranslatorTheme.green.opacity(0.20) : TranslatorTheme.line, lineWidth: 1))
    }
}

private struct LanguageBadge: View {
    var code: String
    var name: String
    var isLeading: Bool

    var body: some View {
        VStack(alignment: isLeading ? .leading : .trailing, spacing: 2) {
            Text(code)
                .font(.system(size: 20, weight: .heavy))
                .foregroundStyle(TranslatorTheme.ink)
            Text(name)
                .font(.system(size: 11, weight: .semibold))
                .lineLimit(1)
                .foregroundStyle(TranslatorTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: isLeading ? .leading : .trailing)
        .padding(.horizontal, 4)
    }
}

private struct LiveStatusPanel: View {
    @ObservedObject var model: TranslatorViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                DiagnosticChip(
                    icon: "network",
                    title: "Backend",
                    value: backendValue,
                    tone: model.backendConfirmedListening ? .good : .neutral
                )
                DiagnosticChip(
                    icon: model.microphoneEnabled ? "mic.fill" : "mic.slash.fill",
                    title: "Mic",
                    value: model.microphoneEnabled ? "On" : "Muted",
                    tone: model.microphoneEnabled ? .good : .muted
                )
                DiagnosticChip(
                    icon: "waveform",
                    title: "Audio",
                    value: audioValue,
                    tone: model.audioChunkCount > 0 ? .good : .neutral
                )
            }

            AudioLevelBar(level: model.isLive ? model.audioLevel : 0)
        }
        .padding(14)
        .background(TranslatorTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(TranslatorTheme.line, lineWidth: 1)
        )
    }

    private var backendValue: String {
        if model.isLive {
            return model.backendConfirmedListening ? "Listening" : model.lastBackendEvent
        }
        return model.lastBackendEvent == "Not connected" ? "Ready" : model.lastBackendEvent
    }

    private var audioValue: String {
        if model.audioChunkCount > 0 {
            return "Streaming"
        }
        return model.isLive ? "Waiting" : "Idle"
    }
}

private enum DiagnosticTone {
    case good
    case neutral
    case muted
}

private struct DiagnosticChip: View {
    var icon: String
    var title: String
    var value: String
    var tone: DiagnosticTone

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(TranslatorTheme.faint)
                Text(value)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .foregroundStyle(TranslatorTheme.ink)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: 52)
        .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var color: Color {
        switch tone {
        case .good:
            return TranslatorTheme.green
        case .neutral:
            return TranslatorTheme.blue
        case .muted:
            return TranslatorTheme.faint
        }
    }
}

private struct AudioLevelBar: View {
    var level: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(TranslatorTheme.surfaceAlt)
                Capsule()
                    .fill(TranslatorTheme.green)
                    .frame(width: max(8, proxy.size.width * CGFloat(min(max(level, 0), 1))))
            }
        }
        .frame(height: 5)
        .clipShape(Capsule())
    }
}

private struct ReadyPanel: View {
    @ObservedObject var model: TranslatorViewModel
    var sourceTitle: String
    var targetTitle: String
    var onConfigure: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 8) {
                Text(model.isLive ? "Listening for speech" : "Ready to translate")
                    .font(.system(size: 30, weight: .heavy))
                    .foregroundStyle(TranslatorTheme.ink)
                Text(model.isLive
                    ? "The first detected phrase will appear here with its \(targetTitle) translation."
                    : "\(sourceTitle) speech will appear with \(targetTitle) translation as soon as the first phrase is detected.")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(TranslatorTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                ContextBadge(icon: "person.2.fill", text: AudiencePreset.find(model.audiencePresetID).label.capitalized)
                ContextBadge(icon: "number", text: "\(model.expectedSpeakerCount) speakers")
                ContextBadge(icon: model.realtimeEnabled ? "waveform.circle.fill" : "text.bubble.fill", text: model.realtimeEnabled ? "Voice beta" : "Transcript")
            }

            if !model.isLive {
                Button(action: onConfigure) {
                    Label("Adjust context and output", systemImage: "slider.horizontal.3")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(TranslatorTheme.ink)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .background(TranslatorTheme.surfaceAlt, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(18)
        .background(TranslatorTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(TranslatorTheme.line, lineWidth: 1)
        )
    }
}

private struct ContextBadge: View {
    var icon: String
    var text: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: icon)
            Text(text)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .font(.system(size: 12, weight: .semibold))
        .foregroundStyle(TranslatorTheme.muted)
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(TranslatorTheme.surfaceAlt, in: Capsule())
    }
}

private struct SectionTitle: View {
    var title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title.uppercased())
            .font(.system(size: 11, weight: .black))
            .foregroundStyle(TranslatorTheme.faint)
            .tracking(0.8)
            .padding(.top, 2)
    }
}

private struct TranslationCard: View {
    var phrase: Phrase
    var targetLanguage: String
    private var outputLanguage: String {
        guard targetLanguage == sourceCode else { return targetLanguage }
        return model.sourceLanguages.first(where: { $0 != sourceCode }) ?? targetLanguage
    }
    @ObservedObject var model: TranslatorViewModel
    var isCurrent: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: isCurrent ? 16 : 12) {
            HStack(spacing: 8) {
                Text(phrase.speakerLabel)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(TranslatorTheme.ink)
                if !phrase.isFinal {
                    Text("LIVE")
                        .font(.system(size: 10, weight: .black))
                        .foregroundStyle(TranslatorTheme.blue)
                        .padding(.horizontal, 7)
                        .frame(height: 20)
                        .background(TranslatorTheme.blue.opacity(0.10), in: Capsule())
                }
                Spacer()
                if hasEnhancement {
                    Image(systemName: "sparkles")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(TranslatorTheme.blue)
                }
            }

            LanguageTextBlock(
                code: sourceCode,
                title: languageName(sourceCode),
                text: sourceText,
                placeholder: "Listening...",
                isPrimary: true,
                isJapanese: sourceCode == "ja",
                phrase: phrase,
                model: model
            )

            if outputLanguage != sourceCode {
                Divider().overlay(TranslatorTheme.line)
                LanguageTextBlock(
                    code: outputLanguage,
                    title: languageName(outputLanguage),
                    text: targetText,
                    placeholder: model.isLive && !phrase.isFinal ? "Translating..." : "No translation yet",
                    isPrimary: false,
                    isJapanese: outputLanguage == "ja",
                    phrase: phrase,
                    model: model
                )
            }
        }
        .padding(isCurrent ? 18 : 14)
        .background(TranslatorTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(isCurrent ? TranslatorTheme.blue.opacity(0.32) : TranslatorTheme.line, lineWidth: 1)
        )
        .shadow(color: isCurrent ? Color.black.opacity(0.08) : Color.clear, radius: 16, y: 8)
    }

    private var sourceCode: String {
        phrase.sourceLanguage ?? model.primarySourceLanguage
    }

    private var sourceText: String {
        let text = model.bestText(for: phrase, language: sourceCode).trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            return text
        }
        return phrase.texts[sourceCode] ?? phrase.texts.values.first ?? ""
    }

    private var targetText: String {
        model.bestText(for: phrase, language: outputLanguage).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var hasEnhancement: Bool {
        guard model.showEnhancedText else { return false }
        if let adaptation = model.adaptation(for: phrase, targetLang: outputLanguage) {
            return !adaptation.sourceRewrite.isEmpty || !adaptation.targetTranslation.isEmpty
        }
        return false
    }

    private func languageName(_ code: String) -> String {
        model.languages.first { $0.code == code }?.name ?? code.uppercased()
    }
}

private struct LanguageTextBlock: View {
    var code: String
    var title: String
    var text: String
    var placeholder: String
    var isPrimary: Bool
    var isJapanese: Bool
    var phrase: Phrase
    @ObservedObject var model: TranslatorViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Text(code.uppercased())
                    .font(.system(size: 11, weight: .black))
                    .foregroundStyle(isPrimary ? TranslatorTheme.blue : TranslatorTheme.green)
                    .frame(minWidth: 30, alignment: .leading)
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(TranslatorTheme.muted)
                Spacer()
                Button {
                    impact(.light)
                    Task { await model.speakPhrase(phrase, language: code) }
                } label: {
                    Image(systemName: model.speakingPhraseId == phrase.id ? "speaker.wave.2.fill" : "speaker.wave.2")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(TranslatorTheme.muted)
                        .frame(width: 32, height: 32)
                        .background(TranslatorTheme.surfaceAlt, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(text.isEmpty)
                .accessibilityLabel("Speak \(code.uppercased())")
            }

            Text(text.isEmpty ? placeholder : text)
                .font(.system(size: isPrimary ? 21 : 18, weight: isPrimary ? .bold : .semibold))
                .foregroundStyle(text.isEmpty ? TranslatorTheme.faint : TranslatorTheme.ink)
                .lineSpacing(3)
                .textSelection(.enabled)

            if model.showRomaji, isJapanese, let romaji = phrase.romajiJa, !romaji.isEmpty {
                Text(romaji)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(TranslatorTheme.muted)
                    .textSelection(.enabled)
            }
        }
    }
}

private enum BannerTone {
    case danger
    case neutral
}

private struct StatusBanner: View {
    var title: String
    var text: String
    var tone: BannerTone

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tone == .danger ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .foregroundStyle(tone == .danger ? TranslatorTheme.red : TranslatorTheme.blue)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundStyle(TranslatorTheme.ink)
                Text(text)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(TranslatorTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(tone == .danger ? TranslatorTheme.redSoft : TranslatorTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(tone == .danger ? TranslatorTheme.red.opacity(0.20) : TranslatorTheme.line, lineWidth: 1)
        )
    }
}

private struct ActionDock: View {
    @ObservedObject var model: TranslatorViewModel
    var startTitle: String
    var onStart: () -> Void
    var onStop: () -> Void
    var onCompose: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            if model.isLive {
                HStack(spacing: 10) {
                    DockToggleButton(
                        title: model.microphoneEnabled ? "Mic On" : "Muted",
                        systemName: model.microphoneEnabled ? "mic.fill" : "mic.slash.fill",
                        isActive: model.microphoneEnabled
                    ) {
                        impact(.light)
                        model.toggleMicrophone()
                    }

                    if model.realtimeEnabled {
                        DockToggleButton(
                            title: model.voiceOutputEnabled ? "Voice On" : "Voice Off",
                            systemName: model.voiceOutputEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill",
                            isActive: model.voiceOutputEnabled
                        ) {
                            impact(.light)
                            model.toggleVoiceOutput()
                        }
                    }

                    DockToggleButton(
                        title: "Type",
                        systemName: "keyboard",
                        isActive: false,
                        action: onCompose
                    )
                }
            }

            HStack(spacing: 12) {
                if model.isLive {
                    Button(action: onStop) {
                        Label("Stop", systemImage: "stop.fill")
                            .font(.system(size: 18, weight: .heavy))
                            .frame(maxWidth: .infinity)
                            .frame(height: 58)
                            .foregroundStyle(.white)
                            .background(TranslatorTheme.red, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                } else {
                    Button(action: onStart) {
                        Label(startTitle, systemImage: "mic.fill")
                            .font(.system(size: 18, weight: .heavy))
                            .frame(maxWidth: .infinity)
                            .frame(height: 58)
                            .foregroundStyle(.white)
                            .background(TranslatorTheme.blue, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(model.status == .connecting || model.status == .stopping || model.loadingSession || model.improvingTranscript)
                }

                if !model.isLive {
                    Button(action: onCompose) {
                        Image(systemName: "keyboard")
                            .font(.system(size: 19, weight: .bold))
                            .foregroundStyle(TranslatorTheme.ink)
                            .frame(width: 58, height: 58)
                            .background(TranslatorTheme.surfaceAlt, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Type phrase")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(TranslatorTheme.surface)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(TranslatorTheme.line)
                .frame(height: 1)
        }
    }
}

private struct DockToggleButton: View {
    var title: String
    var systemName: String
    var isActive: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemName)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(isActive ? TranslatorTheme.blue : TranslatorTheme.muted)
                .frame(maxWidth: .infinity)
                .frame(height: 42)
                .background(isActive ? TranslatorTheme.blue.opacity(0.10) : TranslatorTheme.surfaceAlt, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct TranslatorSettingsSheet: View {
    @ObservedObject var model: TranslatorViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Conversation") {
                    Picker("Audience", selection: $model.audiencePresetID) {
                        ForEach(AudiencePreset.all) { preset in
                            Text(preset.label.capitalized).tag(preset.id)
                        }
                    }
                    .disabled(model.isLive)
                    Stepper("Expected speakers: \(model.expectedSpeakerCount)", value: $model.expectedSpeakerCount, in: 2...6)
                        .disabled(model.isLive)
                }

                Section("Mode") {
                    Toggle("Realtime voice beta", isOn: $model.realtimeEnabled)
                        .disabled(model.isLive)
                    Toggle("Voice output", isOn: $model.voiceOutputEnabled)
                        .disabled(!model.realtimeEnabled)
                    Toggle("Autospeak English replies", isOn: $model.autoSpeakEnabled)
                        .disabled(model.realtimeEnabled)
                    Text("Starts at the latest box and queues English-to-local-language replies. Translations into English stay silent.")
                        .font(.footnote)
                }

                Section("Transcript") {
                    Toggle("Use enhanced text", isOn: $model.showEnhancedText)
                    Toggle("Show romaji", isOn: $model.showRomaji)
                    Button {
                        Task { await model.improveActiveSession() }
                    } label: {
                        Label(model.improvingTranscript ? "Improving..." : "Improve transcript", systemImage: "sparkles")
                    }
                    .disabled(model.activeSessionName.isEmpty || model.isLive || model.improvingTranscript)
                }

                Section("Connection") {
                    LabeledContent("Backend", value: model.lastBackendEvent)
                    LabeledContent("Events", value: "\(model.backendEventCount)")
                    LabeledContent("Audio", value: model.audioChunkCount > 0 ? "Streaming" : "Idle")
                }
            }
            .navigationTitle("Session Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .preferredColorScheme(.light)
    }
}

private struct TextComposerSheet: View {
    @ObservedObject var model: TranslatorViewModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool
    @State private var submitting = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                TextField("Type a phrase to translate", text: $model.typedText, axis: .vertical)
                    .lineLimit(3...5)
                    .font(.system(size: 18, weight: .medium))
                    .padding(14)
                    .background(TranslatorTheme.surfaceAlt, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .focused($focused)

                Button {
                    submitting = true
                    Task {
                        await model.submitTypedText()
                        submitting = false
                        dismiss()
                    }
                } label: {
                    Label(submitting ? "Translating" : "Translate", systemImage: submitting ? "hourglass" : "paperplane.fill")
                        .font(.system(size: 17, weight: .heavy))
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .foregroundStyle(.white)
                        .background(TranslatorTheme.blue, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(submitting || model.typedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Spacer(minLength: 0)
            }
            .padding(16)
            .background(TranslatorTheme.background)
            .navigationTitle("\(model.primarySourceShortName) -> \(model.targetShortName)")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                focused = true
            }
        }
        .preferredColorScheme(.light)
    }
}

private enum HapticImpact {
    case light
    case medium
}

private enum HapticNotification {
    case success
}

@MainActor private func impact(_ style: HapticImpact = .medium) {
    #if os(iOS)
    let feedbackStyle: UIImpactFeedbackGenerator.FeedbackStyle = style == .light ? .light : .medium
    UIImpactFeedbackGenerator(style: feedbackStyle).impactOccurred()
    #endif
}

@MainActor private func notification(_ type: HapticNotification) {
    _ = type
    #if os(iOS)
    let feedbackType: UINotificationFeedbackGenerator.FeedbackType = .success
    UINotificationFeedbackGenerator().notificationOccurred(feedbackType)
    #endif
}
