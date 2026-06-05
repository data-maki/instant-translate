import SwiftUI

struct TranslatorShellView: View {
    @StateObject private var model: TranslatorViewModel
    @State private var showingLanguages = false
    @State private var showingHistory = false

    init(configuration: AppConfiguration) {
        _model = StateObject(wrappedValue: TranslatorViewModel(configuration: configuration))
    }

    var body: some View {
        NavigationStack {
            ZStack {
                AppBackground()
                VStack(spacing: 0) {
                    header
                    languageRail
                    Divider().opacity(0.35)
                    transcriptCanvas
                    controls
                }
            }
            .toolbar {
                ToolbarItem {
                    Button {
                        model.newChat()
                    } label: {
                        Image(systemName: "square.and.pencil")
                    }
                    .accessibilityLabel("New chat")
                    .disabled(model.isLive)
                }
                ToolbarItem {
                    Button {
                        showingHistory = true
                    } label: {
                        Image(systemName: "clock")
                    }
                    .accessibilityLabel("History")
                }
                ToolbarItem {
                    NavigationLink {
                        ProfileView(model: model)
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                    .accessibilityLabel("Profile")
                }
            }
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
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(directionTitle)
                    .font(.headline.weight(.bold))
                    .lineLimit(1)
                Text("\(model.status.rawValue) · \(model.tokenCount) tokens")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Toggle("GPT realtime", isOn: $model.realtimeEnabled)
                .labelsHidden()
                .disabled(model.isLive)
            Text("GPT")
                .font(.caption.weight(.bold))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial)
    }

    private var languageRail: some View {
        Button {
            showingLanguages = true
        } label: {
            HStack {
                Label(sourceTitle, systemImage: "waveform")
                Spacer()
                Image(systemName: "arrow.right")
                    .font(.caption.weight(.bold))
                Spacer()
                Label(targetTitle, systemImage: "text.bubble")
            }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .buttonStyle(.plain)
        .disabled(model.isLive)
        .background(.thinMaterial)
    }

    private var transcriptCanvas: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    if model.phrases.isEmpty {
                        ChatHero(model: model)
                            .frame(maxWidth: .infinity)
                    } else {
                        ForEach(model.phrases) { phrase in
                            PhraseBubble(
                                phrase: phrase,
                                targetLanguage: model.targetLanguage,
                                model: model
                            )
                            .id(phrase.id)
                        }
                    }
                }
                .padding(16)
            }
            .onChange(of: model.phrases.count) {
                guard let last = model.phrases.last else { return }
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
        .overlay(alignment: .top) {
            if !model.errorMessage.isEmpty {
                Text(model.errorMessage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.red)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
            }
        }
    }

    @ViewBuilder
    private var controls: some View {
        if model.isLive {
            RealtimeControlBar(model: model)
        } else if !model.phrases.isEmpty {
            Button {
                Task { await model.start() }
            } label: {
                Label(resumeButtonLabel, systemImage: "mic.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .padding(14)
            .background(.ultraThinMaterial)
        }
    }

    private var resumeButtonLabel: String {
        if !model.activeSessionName.isEmpty {
            return model.realtimeEnabled ? "Resume realtime" : "Resume chat"
        }
        return model.realtimeEnabled ? "Start realtime" : "Start session"
    }

    private var directionTitle: String {
        "\(sourceTitle) → \(targetTitle)"
    }

    private var sourceTitle: String {
        model.sourceLanguages.map(shortLabel).joined(separator: ", ")
    }

    private var targetTitle: String {
        shortLabel(model.targetLanguage)
    }

    private func shortLabel(_ code: String) -> String {
        code.uppercased()
    }
}

private struct ChatHero: View {
    @ObservedObject var model: TranslatorViewModel

    private static let accent = Color(red: 0.74, green: 0.0, blue: 0.18)
    private static let accentSoft = Color(red: 0.97, green: 0.89, blue: 0.91)

    var body: some View {
        VStack(spacing: 22) {
            Text("Ready when you are.")
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .multilineTextAlignment(.center)
                .padding(.top, 12)

            Button {
                Task { await model.start() }
            } label: {
                ZStack {
                    Circle()
                        .fill(Self.accent)
                        .frame(width: 116, height: 116)
                        .shadow(color: Self.accent.opacity(0.35), radius: 18, y: 10)
                    Image(systemName: "mic.fill")
                        .font(.system(size: 44, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Start session")
            .disabled(model.isLive)
            .opacity(model.isLive ? 0.5 : 1)

            VStack(spacing: 10) {
                Text("WHO ARE YOU SPEAKING TO?")
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)

                FlexibleChipRow(items: AudiencePreset.all) { preset in
                    HeroChip(
                        label: preset.label,
                        isActive: preset.id == model.audiencePresetID,
                        accent: Self.accent,
                        accentSoft: Self.accentSoft
                    ) {
                        model.audiencePresetID = preset.id
                    }
                }
            }
            .padding(.top, 4)

            HStack(spacing: 6) {
                Text("SPEAKERS")
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(1)
                    .foregroundStyle(.secondary)
                    .padding(.trailing, 2)

                ForEach([2, 3, 4, 5, 6], id: \.self) { count in
                    HeroSpeakerOption(
                        count: count,
                        isActive: count == model.expectedSpeakerCount,
                        accent: Self.accent,
                        accentSoft: Self.accentSoft
                    ) {
                        model.expectedSpeakerCount = count
                    }
                }
            }
        }
        .frame(maxWidth: 560)
        .padding(.vertical, 32)
    }
}

private struct HeroChip: View {
    var label: String
    var isActive: Bool
    var accent: Color
    var accentSoft: Color
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .padding(.horizontal, 16)
                .frame(minHeight: 38)
                .foregroundStyle(isActive ? accent : Color.primary)
                .background(
                    Capsule().fill(isActive ? AnyShapeStyle(accentSoft) : AnyShapeStyle(.regularMaterial))
                )
                .overlay(
                    Capsule().stroke(
                        isActive ? accent.opacity(0.55) : Color.primary.opacity(0.12),
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
    }
}

private struct HeroSpeakerOption: View {
    var count: Int
    var isActive: Bool
    var accent: Color
    var accentSoft: Color
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(count == 6 ? "6+" : "\(count)")
                .font(.system(size: 13, weight: .semibold))
                .frame(minWidth: 32, minHeight: 28)
                .padding(.horizontal, 6)
                .foregroundStyle(isActive ? accent : Color.secondary)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(isActive ? accentSoft : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(isActive ? accent.opacity(0.55) : Color.clear, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct FlexibleChipRow<Item: Identifiable, Content: View>: View {
    let items: [Item]
    @ViewBuilder let content: (Item) -> Content

    var body: some View {
        let columns = [GridItem(.adaptive(minimum: 88), spacing: 8)]
        LazyVGrid(columns: columns, alignment: .center, spacing: 8) {
            ForEach(items) { item in
                content(item)
            }
        }
        .padding(.horizontal, 16)
    }
}

private struct LiveCanvasView: View {
    var status: TranslatorViewModel.Status
    var direction: String
    var isLive: Bool

    var body: some View {
        VStack(spacing: 18) {
            HStack {
                Circle()
                    .fill(isLive ? .green : .secondary)
                    .frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(isLive ? "Listening" : "Ready to listen")
                        .font(.headline.weight(.bold))
                    Text(status.rawValue)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(14)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            HStack(alignment: .center, spacing: 5) {
                ForEach([18, 34, 52, 66, 52], id: \.self) { height in
                    Capsule()
                        .fill(.red.opacity(0.8))
                        .frame(width: 6, height: CGFloat(height))
                }
            }
            Text(direction)
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(.thinMaterial, in: Capsule())
            Text("Original speech and translation will appear here together.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }
}

private struct PhraseBubble: View {
    var phrase: Phrase
    var targetLanguage: String
    @ObservedObject var model: TranslatorViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(phrase.speakerLabel)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                if hasEnhancement {
                    Label("Enhanced", systemImage: "sparkles")
                        .labelStyle(.iconOnly)
                        .font(.caption2)
                        .foregroundStyle(.tint)
                }
                Spacer()
                if !phrase.isFinal {
                    Text("live")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(orderedLanguages, id: \.self) { code in
                let displayText = model.bestText(for: phrase, language: code)
                let isEnhanced = hasEnhancement(for: code)
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text(code.uppercased())
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button {
                            Task { await model.speakPhrase(phrase, language: code) }
                        } label: {
                            Image(systemName: speakerSymbol(for: code))
                                .foregroundStyle(.secondary)
                                .imageScale(.medium)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Speak this \(code.uppercased()) line")
                    }
                    Text(displayText)
                        .font(code == "ja" ? .body : .callout)
                        .italic(isEnhanced)
                        .textSelection(.enabled)
                }
                if code != orderedLanguages.last {
                    Divider().opacity(0.35)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var orderedLanguages: [String] {
        phrase.texts.keys.sorted()
    }

    private var hasEnhancement: Bool {
        orderedLanguages.contains { hasEnhancement(for: $0) }
    }

    private func hasEnhancement(for code: String) -> Bool {
        if code == phrase.sourceLanguage,
           let adaptation = model.adaptation(for: phrase, targetLang: targetLanguage),
           !adaptation.sourceRewrite.isEmpty {
            return true
        }
        if let adaptation = model.adaptation(for: phrase, targetLang: code),
           !adaptation.targetTranslation.isEmpty {
            return true
        }
        return false
    }

    private func speakerSymbol(for code: String) -> String {
        model.speakingPhraseId == phrase.id
            ? "speaker.wave.2.fill"
            : "speaker.wave.2"
    }
}

private struct RealtimeControlBar: View {
    @ObservedObject var model: TranslatorViewModel

    var body: some View {
        HStack(spacing: 10) {
            Button {
                model.toggleEnglishToTargetSpeaker()
            } label: {
                Label("EN → \(model.targetShortName)", systemImage: "speaker.wave.2.fill")
                    .labelStyle(.titleAndIcon)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(model.englishToTargetSpeakerEnabled ? .red : .secondary)

            Button {
                model.toggleMicrophone()
            } label: {
                Image(systemName: model.microphoneEnabled ? "mic.fill" : "mic.slash.fill")
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.borderedProminent)
            .clipShape(Circle())

            Button {
                model.toggleTargetToEnglishSpeaker()
            } label: {
                Label("\(model.targetShortName) → EN", systemImage: "speaker.wave.2.fill")
                    .labelStyle(.titleAndIcon)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(model.targetToEnglishSpeakerEnabled ? .red : .secondary)

            Button(role: .destructive) {
                Task { await model.stop() }
            } label: {
                Text("Stop")
                    .font(.subheadline.weight(.bold))
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(10)
        .background(.ultraThinMaterial)
    }
}
