import SwiftUI

struct AuthGateView: View {
    @ObservedObject var auth: BetterAuthSession
    @State private var mode: AuthMode = .signIn
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 22) {
                Spacer(minLength: 24)

                VStack(spacing: 10) {
                    BrandBadge()
                    Text("cottonoha")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                    Text(mode == .signIn ? "Sign in to start translating." : "Create an account to continue.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Picker("Mode", selection: $mode) {
                    Text("Sign in").tag(AuthMode.signIn)
                    Text("Sign up").tag(AuthMode.signUp)
                }
                .pickerStyle(.segmented)

                VStack(spacing: 12) {
                    if mode == .signUp {
                        TextField("Name", text: $name)
                            .textContentType(.name)
                            .fieldStyle()
                    }
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled()
                        .fieldStyle()
                    SecureField("Password", text: $password)
                        .textContentType(mode == .signIn ? .password : .newPassword)
                        .fieldStyle()
                }

                if !auth.errorMessage.isEmpty {
                    Text(auth.errorMessage)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task {
                        if mode == .signIn {
                            await auth.signIn(email: email, password: password)
                        } else {
                            await auth.signUp(name: name, email: email, password: password)
                        }
                    }
                } label: {
                    Text(auth.isBusy ? "Please wait..." : mode.buttonTitle)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(auth.isBusy || email.isEmpty || password.count < 8)

                Spacer(minLength: 24)
            }
            .padding(22)
            .background(AppBackground())
        }
    }
}

private enum AuthMode {
    case signIn
    case signUp

    var buttonTitle: String {
        switch self {
        case .signIn: "Sign in"
        case .signUp: "Create account"
        }
    }
}

private struct BrandBadge: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(.thinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(.white.opacity(0.55), lineWidth: 1)
                )
            Text("言")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(.red)
        }
        .frame(width: 64, height: 64)
    }
}

private extension View {
    func fieldStyle() -> some View {
        self
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(.white.opacity(0.45), lineWidth: 1)
            )
    }
}
