import SwiftUI

public struct CottonohaRootView: View {
    @StateObject private var auth: BetterAuthSession
    @AppStorage("cottonoha.hasCompletedOnboarding.v1") private var hasCompletedOnboarding = false
    private let configuration: AppConfiguration

    public init(configuration: AppConfiguration = AppConfiguration()) {
        self.configuration = configuration
        _auth = StateObject(wrappedValue: BetterAuthSession(configuration: configuration))
    }

    public var body: some View {
        Group {
            if !hasCompletedOnboarding {
                OnboardingView {
                    hasCompletedOnboarding = true
                }
            } else if auth.isAuthenticated {
                TranslatorShellView(configuration: configuration, auth: auth)
            } else {
                AuthGateView(auth: auth)
            }
        }
        .task {
            await auth.refresh()
        }
    }
}
