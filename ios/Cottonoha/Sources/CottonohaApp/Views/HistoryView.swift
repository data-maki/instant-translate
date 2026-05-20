import SwiftUI

struct HistoryView: View {
    @ObservedObject var model: TranslatorViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if model.sessions.isEmpty {
                    ContentUnavailableView("No conversations yet", systemImage: "bubble.left.and.bubble.right")
                } else {
                    ForEach(model.sessions) { session in
                        Button {
                            Task {
                                await model.loadSession(session)
                                dismiss()
                            }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(session.title)
                                    .font(.headline)
                                    .lineLimit(1)
                                HStack {
                                    Text(session.updated ?? "Recent")
                                    if let duration = session.durationSeconds {
                                        Text("· \(durationLabel(duration))")
                                    }
                                    Text("· \(session.tokenCount) tokens")
                                }
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("History")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                try? await model.refreshSessions()
            }
        }
    }

    private func durationLabel(_ seconds: Double) -> String {
        let total = Int(seconds)
        return "\(total / 60)m \(total % 60)s"
    }
}
