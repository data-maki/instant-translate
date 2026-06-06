import SwiftUI

public struct CottonohaRootView: View {
    @AppStorage("cottonoha.hasCompletedOnboarding.v1") private var hasCompletedOnboarding = false
    private let configuration: AppConfiguration

    public init(configuration: AppConfiguration = AppConfiguration()) {
        self.configuration = configuration
    }

    public var body: some View {
        Group {
            if !hasCompletedOnboarding {
                OnboardingView {
                    hasCompletedOnboarding = true
                }
            } else {
                TranslatorShellView(configuration: configuration)
            }
        }
        .task {
            AppLog.app.info("Root view launched. onboardingComplete=\(hasCompletedOnboarding)")
        }
    }
}
