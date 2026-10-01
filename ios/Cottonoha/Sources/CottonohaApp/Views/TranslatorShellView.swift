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

                    if !model.phrases.isEmpty {
                        ForEach(model.paragraphs) { paragraph in
                            TranslationCard(paragraph: paragraph, model: model,
                                isCurrent: paragraph.id == model.paragraphs.last?.id)
                                .id(paragraph.id)
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
                guard let last = model.paragraphs.last else { return }
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
    var paragraph: TranscriptParagraph
    @ObservedObject var model: TranslatorViewModel
    var isCurrent: Bool
    private var phrase: Phrase { paragraph.phrases[0] }
    private var sourceCode: String {
        TranscriptPresentation.sourceLanguage(phrase, preferred: model.primarySourceLanguage)
    }
    private var outputCode: String {
        sourceCode == model.targetLanguage ? model.primarySourceLanguage : model.targetLanguage
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(phrase.speakerLabel)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(TranslatorTheme.muted)
                    .lineLimit(1)
                Spacer(minLength: 4)
                playbackButton(sourceCode)
                if outputCode != sourceCode { playbackButton(outputCode) }
            }
            Text(transcript)
                .font(.system(size: 15))
                .lineSpacing(3)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(TranslatorTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
            .stroke(isCurrent ? TranslatorTheme.blue.opacity(0.25) : TranslatorTheme.line, lineWidth: 1))
    }

    private func playbackButton(_ code: String) -> some View {
        let state = model.playbackState(paragraph.phrases, language: code)
        let language = model.languages.first { $0.code == code }?.name ?? code.uppercased()
        return Button {
            impact(.light)
            Task { await model.speakParagraph(paragraph.phrases, language: code) }
        } label: {
            HStack(spacing: 3) {
                Text(code.uppercased()).font(.system(size: 10, weight: .semibold))
                Image(systemName: state == .error ? "exclamationmark.circle" : state == .playing ? "waveform" : "speaker.wave.2")
                    .font(.system(size: 12))
                    .symbolEffect(.variableColor, options: .repeating, isActive: state == .playing)
                    .symbolEffect(.pulse, options: .repeating, isActive: state == .loading)
            }
            .foregroundStyle(languageColor(code))
            .padding(.horizontal, 4)
            .frame(minWidth: 40, minHeight: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.paragraphText(paragraph.phrases, language: code).isEmpty)
        .accessibilityLabel("\(state == .error ? "Retry" : "Play") paragraph in \(language)")
        .accessibilityValue(state == .loading ? "Preparing audio" : state == .playing ? "Playing" : "")
    }

    private var transcript: AttributedString {
        var result = AttributedString()
        for (index, item) in paragraph.phrases.enumerated() {
            if index > 0 { result += AttributedString("\n") }
            result += passage(item, language: sourceCode, primary: true)
            if !model.bestText(for: item, language: outputCode).isEmpty, outputCode != sourceCode {
                result += AttributedString(" · ")
                result += passage(item, language: outputCode, primary: false)
            }
        }
        return result
    }

    private func passage(_ phrase: Phrase, language: String, primary: Bool) -> AttributedString {
        let original = model.bestText(for: phrase, language: language)
        let reading = TranscriptPresentation.reading(phrase, language: language, text: original)
        var label = AttributedString(language.uppercased() + " ")
        label.foregroundColor = languageColor(language)
        label.font = .system(size: 10, weight: .semibold)
        var text = AttributedString(model.showRomaji && !reading.isEmpty ? reading : original.isEmpty ? "…" : original)
        text.foregroundColor = primary ? TranslatorTheme.ink : TranslatorTheme.muted
        text.font = .system(size: 15, weight: primary ? .semibold : .regular)
        label += text
        if !model.showRomaji, !reading.isEmpty {
            var latin = AttributedString(" [\(reading)]")
            latin.foregroundColor = languageColor(language)
            latin.font = .system(size: 13)
            label += latin
        }
        return label
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
                    Toggle("Autospeak English → local language", isOn: $model.autoSpeakEnabled)
                        .disabled(model.realtimeEnabled)
                    Text("Starts at the latest box and queues English-to-local-language replies. Translations into English stay silent.")
                        .font(.footnote)
                }

                Section("Transcript") {
                    Toggle("Use enhanced text", isOn: $model.showEnhancedText)
                    Toggle("Latin script only", isOn: $model.showRomaji)
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

private func languageColor(_ code: String) -> Color {
    // Same language families as frontend/src/lib/language-colors.ts.
    let hues: [String: Double] = [
        "es": 22, "ca": 26, "pt": 18, "gl": 20, "it": 30, "fr": 34, "ro": 38, "en": 210,
        "nl": 214, "de": 218, "da": 202, "no": 204, "sv": 206, "bg": 268, "mk": 270, "bs": 262,
        "hr": 260, "sr": 264, "sl": 258, "cs": 250, "sk": 252, "pl": 246, "ru": 276, "uk": 278,
        "lt": 238, "lv": 240, "hi": 350, "ur": 352, "pa": 346, "gu": 342, "mr": 338, "fa": 358,
        "ta": 316, "ml": 320, "te": 312, "ar": 48, "he": 52, "fi": 182, "et": 186, "hu": 176,
        "id": 150, "ms": 154, "tl": 158, "zh": 8, "my": 12, "ja": 298, "ko": 286, "th": 110,
        "vi": 130, "tr": 78, "el": 94, "eu": 166
    ]
    let normalized = code.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? code
    guard let hue = hues[normalized] else { return TranslatorTheme.muted }
    return Color(hue: hue / 360, saturation: 0.42, brightness: 0.48)
}
