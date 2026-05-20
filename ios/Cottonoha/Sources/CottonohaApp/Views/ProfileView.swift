import SwiftUI

struct ProfileView: View {
    @ObservedObject var model: TranslatorViewModel
    @ObservedObject var auth: BetterAuthSession
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("First name", text: $model.profile.firstName)
                    TextField("Last name", text: $model.profile.lastName)
                    TextField("First name in katakana", text: $model.profile.firstNameKatakana)
                    TextField("Last name in katakana", text: $model.profile.lastNameKatakana)
                }

                Section("Travel context") {
                    TextField("Age", text: $model.profile.age)
                    TextField("Hotel or neighborhood", text: $model.profile.hotel)
                    TextField("Travel party", text: $model.profile.travelParty, axis: .vertical)
                }

                Section("Food & accessibility") {
                    TextField("Allergies or restrictions", text: $model.profile.allergies, axis: .vertical)
                    TextField("Spice preference", text: $model.profile.spiceLevel)
                    TextField("Mobility or luggage needs", text: $model.profile.mobility, axis: .vertical)
                }

                Section("Saved places") {
                    TextField("Places to remember", text: $model.profile.savedPlaces, axis: .vertical)
                        .lineLimit(3...8)
                }

                Section {
                    Button("Save profile") {
                        model.saveProfile()
                        dismiss()
                    }
                    Button("Sign out", role: .destructive) {
                        Task {
                            await auth.signOut()
                        }
                    }
                }
            }
            .navigationTitle("Profile")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
