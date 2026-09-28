import SwiftUI

struct HistoryView: View {
    @ObservedObject var model: TranslatorViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var renamingSession: SessionSummary?
    @State private var renameDraft = ""
    @State private var deletingSession: SessionSummary?

    var body: some View {
        NavigationStack {
            List {
                if !model.historyStatus.isEmpty {
                    Text(model.historyStatus)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.red)
                }
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
                        .contextMenu {
                            Button {
                                startRename(session)
                            } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                            Button(role: .destructive) {
                                deletingSession = session
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                deletingSession = session
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            Button {
                                startRename(session)
                            } label: {
                                Label("Rename", systemImage: "pencil")
                            }
                            .tint(.blue)
                        }
                    }
                    if model.sessions.count < model.sessionTotal {
                        Button {
                            Task { await model.loadMoreSessions() }
                        } label: {
                            HStack {
                                if model.loadingMoreSessions {
                                    ProgressView()
                                }
                                Text(model.loadingMoreSessions ? "Loading…" : "Load more")
                            }
                        }
                        .disabled(model.loadingMoreSessions)
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
            .alert("Rename chat", isPresented: renameAlertBinding) {
                TextField("Chat name", text: $renameDraft)
                Button("Cancel", role: .cancel) {
                    renamingSession = nil
                    renameDraft = ""
                }
                Button("Save") {
                    guard let session = renamingSession else { return }
                    let title = renameDraft
                    Task {
                        await model.renameSession(session, title: title)
                        renamingSession = nil
                        renameDraft = ""
                    }
                }
            }
            .confirmationDialog(
                "Delete chat?",
                isPresented: deleteDialogBinding,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    guard let session = deletingSession else { return }
                    Task {
                        await model.deleteSession(session)
                        deletingSession = nil
                    }
                }
                Button("Cancel", role: .cancel) {
                    deletingSession = nil
                }
            }
        }
    }

    private var renameAlertBinding: Binding<Bool> {
        Binding(
            get: { renamingSession != nil },
            set: { if !$0 { renamingSession = nil } }
        )
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(
            get: { deletingSession != nil },
            set: { if !$0 { deletingSession = nil } }
        )
    }

    private func startRename(_ session: SessionSummary) {
        renamingSession = session
        renameDraft = session.title
    }

    private func durationLabel(_ seconds: Double) -> String {
        let total = Int(seconds)
        return "\(total / 60)m \(total % 60)s"
    }
}
