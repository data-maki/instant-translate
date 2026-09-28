import Foundation
import SwiftUI
import CottonohaCore

@main
struct CottonohaIOSApp: App {
    var body: some Scene {
        WindowGroup {
            CottonohaRootView(
                configuration: AppConfiguration(apiBaseURL: configuredAPIBaseURL)
            )
        }
    }

    private var configuredAPIBaseURL: URL {
        if let url = Self.urlOverride(from: ProcessInfo.processInfo.environment["COTTONOHA_API_BASE_URL"]) {
            return url
        }
        if let value = Bundle.main.object(forInfoDictionaryKey: "CottonohaAPIBaseURL") as? String,
           let url = Self.urlOverride(from: value) {
            return url
        }
        return AppConfiguration().apiBaseURL
    }

    private static func urlOverride(from rawValue: String?) -> URL? {
        let value = (rawValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains("$(") else { return nil }
        guard let url = URL(string: value),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil else { return nil }
        return url
    }
}
