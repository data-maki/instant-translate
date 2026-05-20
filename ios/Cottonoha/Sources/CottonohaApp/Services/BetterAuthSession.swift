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
        await client.session.refreshSession()
        syncFromClient()
    }

    public func signIn(email: String, password: String) async {
        await runAuthAction {
            _ = try await client.signIn.email(with: .init(email: email, password: password))
        }
    }

    public func signUp(name: String, email: String, password: String) async {
        await runAuthAction {
            _ = try await client.signUp.email(with: .init(email: email, password: password, name: name.isEmpty ? email : name))
        }
    }

    public func signOut() async {
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
            errorMessage = error.localizedDescription
        }
        isBusy = false
    }

    private func syncFromClient() {
        if let user = client.session.data?.user {
            isAuthenticated = true
            displayName = user.name
        } else {
            isAuthenticated = false
            displayName = ""
        }
    }
}
