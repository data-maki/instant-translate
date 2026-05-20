import BetterAuth
import Combine
import Foundation

@MainActor
public final class BetterAuthSession: ObservableObject {
    public let client: BetterAuthClient
    @Published public private(set) var isAuthenticated = false
    @Published public private(set) var displayName = ""
    @Published public private(set) var errorMessage = ""
    @Published public private(set) var isBusy = false

    public init(configuration: AppConfiguration) {
        self.client = BetterAuthClient(baseURL: configuration.authBaseURL, scheme: configuration.authScheme)
    }

    public func refresh() async {
        AppLog.auth.info("Refreshing auth session")
        await client.session.refreshSession()
        syncFromClient()
    }

    public func signIn(email: String, password: String) async {
        AppLog.auth.info("Starting email sign-in")
        await runAuthAction {
            _ = try await client.signIn.email(with: .init(email: email, password: password))
        }
    }

    public func signUp(name: String, email: String, password: String) async {
        AppLog.auth.info("Starting email sign-up")
        await runAuthAction {
            _ = try await client.signUp.email(with: .init(email: email, password: password, name: name.isEmpty ? email : name))
        }
    }

    public func signOut() async {
        AppLog.auth.info("Starting sign-out")
        await runAuthAction {
            _ = try await client.signOut()
        }
    }

    private func runAuthAction(_ action: () async throws -> Void) async {
        isBusy = true
        errorMessage = ""
        do {
            try await action()
            await client.session.refreshSession()
            syncFromClient()
        } catch {
            AppLog.auth.error("Auth action failed: \(error.localizedDescription, privacy: .public)")
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    private func syncFromClient() {
        if let user = client.session.data?.user {
            isAuthenticated = true
            displayName = user.name
            AppLog.auth.info("Auth session active")
        } else {
            isAuthenticated = false
            displayName = ""
            AppLog.auth.info("No active auth session")
        }
    }
}
