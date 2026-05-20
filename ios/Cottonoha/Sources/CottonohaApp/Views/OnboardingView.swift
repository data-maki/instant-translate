import SwiftUI

struct OnboardingView: View {
    var onFinish: () -> Void
    @State private var selection = 0

    private let pages = OnboardingPage.pages

    var body: some View {
        ZStack {
            OnboardingPalette.background
                .ignoresSafeArea()

            VStack(spacing: 0) {
                header
                    .padding(.horizontal, 24)
                    .padding(.top, 18)

                TabView(selection: $selection) {
                    ForEach(Array(pages.enumerated()), id: \.offset) { index, page in
                        OnboardingPageView(page: page)
                            .tag(index)
                    }
                }
                #if os(iOS)
                .tabViewStyle(.page(indexDisplayMode: .never))
                #endif

                indicator
                    .padding(.bottom, 22)

                primaryButton
                    .padding(.horizontal, 24)
                    .padding(.bottom, 28)
            }
        }
    }

    private var header: some View {
        HStack {
            Text("コトノハ")
                .font(.system(size: 17, weight: .heavy, design: .rounded))
                .tracking(1)
                .foregroundStyle(OnboardingPalette.ink)
            Spacer()
            if selection < pages.count - 1 {
                Button("Skip") { onFinish() }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(OnboardingPalette.ink.opacity(0.45))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: selection)
    }

    private var indicator: some View {
        HStack(spacing: 8) {
            ForEach(pages.indices, id: \.self) { index in
                Button {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
                        selection = index
                    }
                } label: {
                    Capsule()
                        .fill(index == selection ? OnboardingPalette.red : OnboardingPalette.ink.opacity(0.15))
                        .frame(width: index == selection ? 22 : 6, height: 6)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var primaryButton: some View {
        Button {
            if selection < pages.count - 1 {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
                    selection += 1
                }
            } else {
                onFinish()
            }
        } label: {
            Text(selection == pages.count - 1 ? "Get Started" : "Continue")
                .font(.system(size: 17, weight: .semibold, design: .rounded))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 17)
                .foregroundStyle(OnboardingPalette.ivory)
                .background(OnboardingPalette.red, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .shadow(color: OnboardingPalette.red.opacity(0.25), radius: 18, y: 8)
        }
        .buttonStyle(PressableStyle())
    }
}

private struct OnboardingPage: Hashable {
    var title: String
    var body: String
    var illustration: Illustration

    enum Illustration: Hashable {
        case hero
        case cockpit
        case profile
    }

    static let pages = [
        OnboardingPage(
            title: "Speak naturally.\nBe understood.",
            body: "Pick two languages and place the phone between you. Cottonoha keeps both sides of the conversation.",
            illustration: .hero
        ),
        OnboardingPage(
            title: "Three buttons.\nThat's the app.",
            body: "Tap a speaker to translate aloud. Tap the mic to pause. That's it.",
            illustration: .cockpit
        ),
        OnboardingPage(
            title: "Add context.\nGet better words.",
            body: "Tell Cottonoha about names, places, and tone. It will pick the right vocabulary and level of politeness.",
            illustration: .profile
        )
    ]
}

private struct OnboardingPageView: View {
    var page: OnboardingPage

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 12)

            illustration
                .frame(maxWidth: .infinity)
                .frame(height: 260)
                .padding(.horizontal, 24)

            Spacer(minLength: 24)

            VStack(alignment: .leading, spacing: 14) {
                Text(page.title)
                    .font(.system(size: 32, weight: .bold, design: .rounded))
                    .foregroundStyle(OnboardingPalette.ink)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)

                Text(page.body)
                    .font(.system(size: 16, weight: .regular, design: .rounded))
                    .foregroundStyle(OnboardingPalette.ink.opacity(0.6))
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 28)
            .padding(.bottom, 8)
        }
    }

    @ViewBuilder
    private var illustration: some View {
        switch page.illustration {
        case .hero: HeroIllustration()
        case .cockpit: CockpitIllustration()
        case .profile: ProfileIllustration()
        }
    }
}

private struct HeroIllustration: View {
    @State private var pulse = false

    var body: some View {
        ZStack {
            Circle()
                .fill(OnboardingPalette.red.opacity(0.08))
                .scaleEffect(pulse ? 1.05 : 0.95)
                .animation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true), value: pulse)

            Circle()
                .fill(OnboardingPalette.red.opacity(0.12))
                .frame(width: 200, height: 200)

            Text("通")
                .font(.system(size: 150, weight: .black, design: .rounded))
                .foregroundStyle(OnboardingPalette.red)
                .shadow(color: OnboardingPalette.red.opacity(0.25), radius: 24, y: 10)
        }
        .onAppear { pulse = true }
    }
}

private struct CockpitIllustration: View {
    var body: some View {
        HStack(spacing: 22) {
            CockpitButton(icon: "speaker.wave.2.fill",
                          label: "EN → 日本語",
                          tint: OnboardingPalette.ink)
            CockpitButton(icon: "mic.fill",
                          label: "Pause",
                          tint: OnboardingPalette.red,
                          large: true)
            CockpitButton(icon: "speaker.wave.2.fill",
                          label: "日本語 → EN",
                          tint: OnboardingPalette.ink)
        }
    }
}

private struct CockpitButton: View {
    var icon: String
    var label: String
    var tint: Color
    var large: Bool = false

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(tint)
                    .frame(width: large ? 86 : 70, height: large ? 86 : 70)
                Image(systemName: icon)
                    .font(.system(size: large ? 30 : 24, weight: .semibold))
                    .foregroundStyle(OnboardingPalette.ivory)
            }
            .shadow(color: tint.opacity(0.22), radius: 14, y: 8)

            Text(label)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(OnboardingPalette.ink.opacity(0.55))
        }
    }
}

private struct ProfileIllustration: View {
    private struct Row: Identifiable {
        let id = UUID()
        let icon: String
        let label: String
        let value: String
    }

    private let rows: [Row] = [
        Row(icon: "person.text.rectangle", label: "Names", value: "Alex, 田中さん"),
        Row(icon: "mappin.and.ellipse", label: "Places", value: "渋谷, Park Hyatt"),
        Row(icon: "text.bubble", label: "Tone", value: "Polite")
    ]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(rows) { row in
                HStack(spacing: 14) {
                    Image(systemName: row.icon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(OnboardingPalette.red)
                        .frame(width: 22)
                    Text(row.label)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .foregroundStyle(OnboardingPalette.ink)
                    Spacer()
                    Text(row.value)
                        .font(.system(size: 14, weight: .regular, design: .rounded))
                        .foregroundStyle(OnboardingPalette.ink.opacity(0.5))
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
                .background(OnboardingPalette.ivory, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(OnboardingPalette.ink.opacity(0.06), lineWidth: 1)
                )
            }
        }
    }
}

private struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

private enum OnboardingPalette {
    static let red = Color(red: 0.85, green: 0.15, blue: 0.11)
    static let ink = Color(red: 0.04, green: 0.07, blue: 0.19)
    static let ivory = Color.white
    static let background = Color(red: 0.99, green: 0.98, blue: 0.96)
}
