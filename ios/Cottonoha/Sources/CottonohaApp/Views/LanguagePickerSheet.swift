import SwiftUI

struct LanguagePickerSheet: View {
    @ObservedObject var model: TranslatorViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filteredLanguages: [Language] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return model.languages }
        return model.languages.filter {
            $0.code.lowercased().contains(needle) || $0.name.lowercased().contains(needle)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Search") {
                    TextField("Search languages", text: $query)
                }

                Section("Spoken") {
                    ForEach(filteredLanguages) { language in
                        Button {
                            model.toggleSourceLanguage(language.code)
                        } label: {
                            HStack {
                                Text(language.displayName)
                                Spacer()
                                if model.sourceLanguages.contains(language.code) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.red)
                                }
                            }
                        }
                        .disabled(language.code == model.targetLanguage)
                    }
                }

                Section("Translate to") {
                    ForEach(filteredLanguages) { language in
                        Button {
                            model.setTargetLanguage(language.code)
                        } label: {
                            HStack {
                                Text(language.displayName)
                                Spacer()
                                if model.targetLanguage == language.code {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.red)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Languages")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
