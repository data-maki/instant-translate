import Foundation

public struct TravelerProfile: Codable, Equatable, Sendable {
    public var firstName = ""
    public var lastName = ""
    public var firstNameKatakana = ""
    public var lastNameKatakana = ""
    public var age = ""
    public var hotel = ""
    public var travelParty = ""
    public var allergies = ""
    public var spiceLevel = ""
    public var mobility = ""
    public var savedPlaces = ""

    public init() {}

    public var fullName: String {
        [firstName, lastName]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    public var katakanaName: String {
        [firstNameKatakana, lastNameKatakana]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    public var sonioxContext: String {
        var lines: [String] = []
        if !fullName.isEmpty { lines.append("Traveler name: \(fullName)") }
        if !katakanaName.isEmpty { lines.append("Traveler name in katakana: \(katakanaName)") }
        if !age.isEmpty { lines.append("Traveler age: \(age)") }
        if !hotel.isEmpty { lines.append("Hotel or area: \(hotel)") }
        if !travelParty.isEmpty { lines.append("Travel party: \(travelParty)") }
        if !allergies.isEmpty { lines.append("Food restrictions: \(allergies)") }
        if !spiceLevel.isEmpty { lines.append("Spice preference: \(spiceLevel)") }
        if !mobility.isEmpty { lines.append("Mobility or luggage needs: \(mobility)") }
        if !savedPlaces.isEmpty { lines.append("Saved places: \(savedPlaces)") }
        guard !lines.isEmpty else { return "" }
        return "[Traveler profile]\n" + lines.joined(separator: "\n") + "\n[/Traveler profile]"
    }
}
