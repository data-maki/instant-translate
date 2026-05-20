import SwiftUI

struct OnboardingView: View {
    var onFinish: () -> Void
    @State private var selection = 0

    private let pages = OnboardingPage.pages

    var body: some View {
        ZStack {
            MechaOnboardingBackground()
            VStack(spacing: 0) {
                HStack {
                    Text("コトノハ")
                        .font(.system(size: 18, weight: .black, design: .rounded))
                    Text("言の葉")
                        .font(.caption.weight(.black))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .foregroundStyle(MechaPalette.ivory)
                        .background(MechaPalette.red, in: Capsule())
                    Spacer()
                    Button("Skip") {
                        onFinish()
                    }
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(MechaPalette.ink)
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)

                MechaMarquee()
                    .padding(.top, 18)

                TabView(selection: $selection) {
                    ForEach(Array(pages.enumerated()), id: \.offset) { index, page in
                        OnboardingPageView(page: page, index: index)
                            .tag(index)
                    }
                }
                #if os(iOS)
                .tabViewStyle(.page(indexDisplayMode: .never))
                #endif

                HStack(spacing: 8) {
                    ForEach(pages.indices, id: \.self) { index in
                        Capsule()
                            .fill(index == selection ? MechaPalette.red : MechaPalette.ink.opacity(0.22))
                            .frame(width: index == selection ? 26 : 8, height: 8)
                    }
                }
                .padding(.bottom, 18)

                Button {
                    if selection < pages.count - 1 {
                        withAnimation(.spring(response: 0.32, dampingFraction: 0.84)) {
                            selection += 1
                        }
                    } else {
                        onFinish()
                    }
                } label: {
                    HStack {
                        if selection == pages.count - 1 {
                            Text("MAZIN・GO!")
                        } else {
                            Text("Next")
                        }
                        Image(systemName: "arrow.right")
                    }
                    .font(.headline.weight(.black))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                }
                .foregroundStyle(MechaPalette.ivory)
                .background(
                    LinearGradient(
                        colors: [Color(red: 0.91, green: 0.27, blue: 0.22), MechaPalette.red, MechaPalette.redDeep],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(MechaPalette.ink, lineWidth: 2)
                )
                .shadow(color: MechaPalette.ink, radius: 0, x: 0, y: 6)
                .padding(.horizontal, 22)
                .padding(.bottom, 28)
            }
        }
    }
}

private struct OnboardingPage: Hashable {
    var kicker: String
    var title: String
    var body: String
    var glyph: String
    var callout: String
    var chips: [String]

    static let pages = [
        OnboardingPage(
            kicker: "DROP · 01 / JA ⇄ EN",
            title: "Speak it. Be understood.",
            body: "Choose the languages, tap Start, and keep the phone between speakers. Cottonoha keeps the original and translation together.",
            glyph: "通",
            callout: "声のまま訳す",
            chips: ["JA ⇄ EN", "Subtitles", "Overdub"]
        ),
        OnboardingPage(
            kicker: "COCKPIT MODE",
            title: "Three controls during realtime.",
            body: "Left speaker plays English into the target language. The mic button pauses capture. Right speaker plays the target language back into English.",
            glyph: "声",
            callout: "Speaker · Mic · Speaker",
            chips: ["EN → JA", "Mic", "JA → EN"]
        ),
        OnboardingPage(
            kicker: "CONTEXT BOOST",
            title: "Set the room before you talk.",
            body: "Profile details like names, hotels, allergies, and saved places help the backend choose the right words and level of politeness.",
            glyph: "場",
            callout: "敬語と空気まで",
            chips: ["Names", "Places", "Tone"]
        )
    ]
}

private struct OnboardingPageView: View {
    var page: OnboardingPage
    var index: Int

    var body: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 10)
            ZStack {
                MechaSunburst()
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [MechaPalette.red.opacity(0.95), MechaPalette.redDeep, Color(red: 0.16, green: 0.02, blue: 0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .stroke(MechaPalette.ink, lineWidth: 2)
                    )
                    .shadow(color: MechaPalette.ink, radius: 0, x: 0, y: 10)

                VStack(spacing: 14) {
                    HStack {
                        Text(page.kicker)
                            .font(.caption.weight(.black))
                            .tracking(1.2)
                            .foregroundStyle(MechaPalette.gold)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(MechaPalette.ink, in: Capsule())
                            .overlay(Capsule().stroke(MechaPalette.gold, lineWidth: 1.5))
                        Spacer()
                        HStack(spacing: 5) {
                            Circle().fill(MechaPalette.red).frame(width: 8, height: 8)
                            Text("起動中")
                                .font(.caption2.weight(.black))
                        }
                        .foregroundStyle(MechaPalette.ink)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 7)
                        .background(MechaPalette.gold, in: Capsule())
                    }

                    ZStack {
                        Text(page.glyph)
                            .font(.system(size: 128, weight: .black, design: .rounded))
                            .foregroundStyle(MechaPalette.ivory)
                            .shadow(color: MechaPalette.ink, radius: 0, x: 5, y: 5)
                        Text("Z")
                            .font(.system(size: 84, weight: .black, design: .rounded))
                            .italic()
                            .foregroundStyle(MechaPalette.gold)
                            .rotationEffect(.degrees(-10))
                            .offset(x: 76, y: 42)
                            .shadow(color: MechaPalette.ink, radius: 0, x: 4, y: 4)
                    }

                    HStack {
                        Text(page.callout)
                            .font(.headline.weight(.black))
                            .foregroundStyle(MechaPalette.ivory)
                        Spacer()
                        Text("0\(index + 1)")
                            .font(.title2.weight(.black).monospacedDigit())
                            .foregroundStyle(MechaPalette.gold)
                    }
                }
                .padding(18)
            }
            .frame(height: 330)
            .padding(.horizontal, 22)

            VStack(alignment: .leading, spacing: 14) {
                Text(page.title)
                    .font(.system(size: 32, weight: .black, design: .rounded))
                    .foregroundStyle(MechaPalette.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
                Text(page.body)
                    .font(.body.weight(.medium))
                    .foregroundStyle(MechaPalette.ink.opacity(0.82))
                    .lineSpacing(3)
                HStack {
                    ForEach(page.chips, id: \.self) { chip in
                        Text(chip)
                            .font(.caption.weight(.black))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(MechaPalette.gold, in: Capsule())
                            .overlay(Capsule().stroke(MechaPalette.ink, lineWidth: 1.5))
                    }
                }
            }
            .padding(.horizontal, 24)
            Spacer(minLength: 0)
        }
    }
}

private struct MechaMarquee: View {
    private let labels = ["日本で生まれた", "声のまま訳す", "PRIVATE BETA", "MAZIN・GO!", "東京発・世界へ"]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 18) {
                ForEach(labels, id: \.self) { label in
                    HStack(spacing: 8) {
                        Text("✦")
                            .foregroundStyle(MechaPalette.red)
                        Text(label)
                    }
                }
            }
            .font(.caption.weight(.black))
            .foregroundStyle(MechaPalette.gold)
            .padding(.horizontal, 18)
            .padding(.vertical, 9)
        }
        .background(MechaPalette.ink)
        .overlay(alignment: .top) { Rectangle().fill(MechaPalette.red).frame(height: 2) }
        .overlay(alignment: .bottom) { Rectangle().fill(MechaPalette.red).frame(height: 2) }
    }
}

private struct MechaOnboardingBackground: View {
    var body: some View {
        MechaPalette.ivory
            .overlay(
                LinearGradient(
                    colors: [Color.white.opacity(0.55), MechaPalette.paper.opacity(0.65)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .ignoresSafeArea()
    }
}

private struct MechaSunburst: View {
    var body: some View {
        ZStack {
            ForEach(0..<18, id: \.self) { index in
                Rectangle()
                    .fill(MechaPalette.gold.opacity(index.isMultiple(of: 2) ? 0.22 : 0.08))
                    .frame(width: 14, height: 420)
                    .rotationEffect(.degrees(Double(index) * 10))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

private enum MechaPalette {
    static let red = Color(red: 0.85, green: 0.15, blue: 0.11)
    static let redDeep = Color(red: 0.49, green: 0.04, blue: 0.03)
    static let ink = Color(red: 0.04, green: 0.07, blue: 0.19)
    static let gold = Color(red: 1.0, green: 0.85, blue: 0.30)
    static let ivory = Color(red: 1.0, green: 0.97, blue: 0.91)
    static let paper = Color(red: 0.95, green: 0.92, blue: 0.86)
}
