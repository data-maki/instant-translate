import SwiftUI

struct TranslatorShellView: View {
    @StateObject private var model: TranslatorViewModel
    @ObservedObject var auth: BetterAuthSession
    @State private var showingLanguages = false
    @State private var showingHistory = false
    @State private var showingProfile = false

    init(configuration: AppConfiguration, auth: BetterAuthSession) {
        _model = StateObject(wrappedValue: TranslatorViewModel(configuration: configuration))
        self.auth = auth
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
                        showingHistory = true
                    } label: {
                        Image(systemName: "clock")
                    }
                    .accessibilityLabel("History")
                }
                ToolbarItem {
                    Button {
                        showingProfile = true
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
            .sheet(isPresented: $showingProfile) {
                ProfileView(model: model, auth: auth)
                    .presentationDetents([.large])
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
                        LiveCanvasView(status: model.status, direction: directionTitle, isLive: model.isLive)
                            .padding(.top, 70)
                    } else {
                        ForEach(model.phrases) { phrase in
                            PhraseBubble(phrase: phrase, targetLanguage: model.targetLanguage)
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

    private var controls: some View {
        Group {
            if model.isLive {
                RealtimeControlBar(model: model)
            } else {
                Button {
                    Task { await model.start() }
                } label: {
                    Label(model.realtimeEnabled ? "Start realtime" : "Start session", systemImage: "mic.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .padding(14)
                .background(.ultraThinMaterial)
            }
        }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(phrase.speakerLabel)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                Spacer()
                if !phrase.isFinal {
                    Text("live")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(phrase.texts.sorted(by: { $0.key < $1.key }), id: \.key) { code, text in
                VStack(alignment: .leading, spacing: 2) {
                    Text(code.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.secondary)
                    Text(text)
                        .font(code == "ja" ? .body : .callout)
                        .textSelection(.enabled)
                }
                if code != phrase.texts.keys.sorted().last {
                    Divider().opacity(0.35)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
