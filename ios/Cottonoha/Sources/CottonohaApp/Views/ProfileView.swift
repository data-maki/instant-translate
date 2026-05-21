import SwiftUI

// Tiny shims so this view compiles on macOS as well as iOS. SwiftUI's
// navigation-title display modes and the number-pad keyboard are iOS-only;
// these wrappers are no-ops elsewhere.
private extension View {
    func platformNavigationLargeTitle() -> some View {
        #if os(iOS)
        return self.navigationBarTitleDisplayMode(.large)
        #else
        return self
        #endif
    }

    func platformNavigationInlineTitle() -> some View {
        #if os(iOS)
        return self.navigationBarTitleDisplayMode(.inline)
        #else
        return self
        #endif
    }

    func platformNumberPadKeyboard() -> some View {
        #if os(iOS)
        return self.keyboardType(.numberPad)
        #else
        return self
        #endif
    }
}

struct ProfileView: View {
    @ObservedObject var model: TranslatorViewModel
    @ObservedObject var auth: BetterAuthSession

    var body: some View {
        List {
            NavigationLink {
                ProfileSection(model: model)
            } label: {
                ProfileRow(
                    title: "Profile",
                    detail: "Name and how Japanese speakers should read it."
                )
            }

            NavigationLink {
                PersonalizationSection(model: model)
            } label: {
                ProfileRow(
                    title: "Personalization",
                    detail: "Voice, transcript polish, and how the translator behaves around you."
                )
            }

            NavigationLink {
                TripSection(model: model)
            } label: {
                ProfileRow(
                    title: "Trip",
                    detail: "Travel context — hotel, who you're with, dietary needs."
                )
            }

            NavigationLink {
                PlacesSection(model: model)
            } label: {
                ProfileRow(
                    title: "Saved places",
                    detail: "Spots you want the translator to recognize."
                )
            }

            Section {
                Button("Sign out", role: .destructive) {
                    Task { await auth.signOut() }
                }
            }
        }
        .navigationTitle("Profile")
        .platformNavigationLargeTitle()
    }
}

private struct ProfileRow: View {
    var title: String
    var detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.body.weight(.semibold))
            Text(detail)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

private struct ProfileSection: View {
    @ObservedObject var model: TranslatorViewModel

    var body: some View {
        Form {
            Section {
                TextField("First name", text: $model.profile.firstName)
                    .textContentType(.givenName)
                    .onChange(of: model.profile.firstName) { model.saveProfile() }
                TextField("Last name", text: $model.profile.lastName)
                    .textContentType(.familyName)
                    .onChange(of: model.profile.lastName) { model.saveProfile() }
            } header: {
                Text("Your name")
            } footer: {
                Text("Shows up by default — change it if friends or hosts call you something different.")
            }

            Section {
                TextField("First name (katakana)", text: $model.profile.firstNameKatakana)
                    .onChange(of: model.profile.firstNameKatakana) { model.saveProfile() }
                TextField("Last name (katakana)", text: $model.profile.lastNameKatakana)
                    .onChange(of: model.profile.lastNameKatakana) { model.saveProfile() }
                Button {
                    Task { await model.suggestKatakana() }
                } label: {
                    Label("Suggest katakana", systemImage: "sparkles")
                }
                if !model.katakanaSuggestStatus.isEmpty {
                    Text(model.katakanaSuggestStatus)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                if !model.katakanaSuggestions.isEmpty {
                    ForEach(model.katakanaSuggestions, id: \.self) { option in
                        Button {
                            model.applyKatakanaOption(option)
                        } label: {
                            KatakanaOptionRow(option: option)
                        }
                        .buttonStyle(.plain)
                    }
                }
            } header: {
                Text("カタカナ — Japanese reading")
            } footer: {
                Text("Helps Japanese speakers read your name out loud.")
            }
        }
        .navigationTitle("Profile")
        .platformNavigationInlineTitle()
    }
}

private struct KatakanaOptionRow: View {
    var option: NameKatakanaOption

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(option.firstKatakana.isEmpty ? "—" : option.firstKatakana)
                    .font(.body.weight(.semibold))
                Text("・")
                    .foregroundStyle(.secondary)
                Text(option.lastKatakana.isEmpty ? "—" : option.lastKatakana)
                    .font(.body.weight(.semibold))
            }
            Text("Sounds like \(option.firstReadingEn) \(option.lastReadingEn)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

private struct PersonalizationSection: View {
    @ObservedObject var model: TranslatorViewModel

    var body: some View {
        Form {
            Section {
                ForEach(JapaneseTtsVoice.all) { voice in
                    Button {
                        model.profile.ttsVoiceId = voice.id
                        model.profile.ttsVoiceName = voice.name
                        model.saveProfile()
                    } label: {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(voice.name)
                                    .font(.body.weight(.semibold))
                                Text(voice.kana)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                Text(voice.description)
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            if voice.id == model.profile.ttsVoiceId {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.tint)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text("Japanese voice")
            } footer: {
                Text("Used when the app speaks Japanese on your behalf.")
            }

            Section {
                Toggle("Auto-improve chats", isOn: $model.profile.autoImprove)
                    .onChange(of: model.profile.autoImprove) { model.saveProfile() }
            } footer: {
                Text("Two minutes after a chat stops, this quietly re-runs speaker labeling and re-translates the transcript with a higher-quality model. The polished version replaces the live one the next time you open the chat. Resuming the chat before the timer fires cancels it. Failed runs leave the chat untouched.")
            }
        }
        .navigationTitle("Personalization")
        .platformNavigationInlineTitle()
    }
}

private struct TripSection: View {
    @ObservedObject var model: TranslatorViewModel

    var body: some View {
        Form {
            Section {
                TextField("Your age", text: $model.profile.age)
                    .platformNumberPadKeyboard()
                    .onChange(of: model.profile.age) { model.saveProfile() }
                TextField("Hotel or neighborhood", text: $model.profile.hotel)
                    .onChange(of: model.profile.hotel) { model.saveProfile() }
            } header: {
                Text("Stay")
            }

            Section {
                TextField("Who is with you?", text: $model.profile.travelParty, axis: .vertical)
                    .lineLimit(2...4)
                    .onChange(of: model.profile.travelParty) { model.saveProfile() }
            } header: {
                Text("Travel party")
            } footer: {
                Text("e.g. My wife Ana, my daughter Mia.")
            }

            Section {
                TextField("Allergies or restrictions", text: $model.profile.allergies, axis: .vertical)
                    .lineLimit(2...4)
                    .onChange(of: model.profile.allergies) { model.saveProfile() }
                TextField("Spice preference", text: $model.profile.spiceLevel)
                    .onChange(of: model.profile.spiceLevel) { model.saveProfile() }
            } header: {
                Text("Food")
            }

            Section {
                TextField("Mobility or luggage needs", text: $model.profile.mobility, axis: .vertical)
                    .lineLimit(2...4)
                    .onChange(of: model.profile.mobility) { model.saveProfile() }
            } header: {
                Text("Mobility")
            } footer: {
                Text("e.g. need elevator, stroller, large suitcase.")
            }
        }
        .navigationTitle("Trip")
        .platformNavigationInlineTitle()
    }
}

private struct PlacesSection: View {
    @ObservedObject var model: TranslatorViewModel
    @State private var mapsUrl = ""

    var body: some View {
        Form {
            Section {
                TextField("Google Maps list link", text: $mapsUrl)
                    .textContentType(.URL)
                    .autocorrectionDisabled()
                Button {
                    Task {
                        await model.importGoogleMapsList(url: mapsUrl)
                        if model.mapsImportStatus.hasPrefix("Imported") {
                            mapsUrl = ""
                        }
                    }
                } label: {
                    Label("Import shared list", systemImage: "square.and.arrow.down")
                }
                .disabled(mapsUrl.trimmingCharacters(in: .whitespaces).isEmpty)
                if !model.mapsImportStatus.isEmpty {
                    Text(model.mapsImportStatus)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Import from Google Maps")
            } footer: {
                Text("Paste a shared maps.app.goo.gl link to pull every saved place into the list below.")
            }

            Section {
                TextField("Places to remember", text: $model.profile.savedPlaces, axis: .vertical)
                    .lineLimit(4...12)
                    .onChange(of: model.profile.savedPlaces) { model.saveProfile() }
            } footer: {
                Text("Kiyomizu-dera, Kyoto Station, favorite ramen shop...")
            }
        }
        .navigationTitle("Saved places")
        .platformNavigationInlineTitle()
    }
}
