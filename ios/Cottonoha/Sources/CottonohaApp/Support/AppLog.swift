import OSLog

enum AppLog {
    static let app = Logger(subsystem: "app.cottonoha.ios", category: "app")
    static let network = Logger(subsystem: "app.cottonoha.ios", category: "network")
    static let realtime = Logger(subsystem: "app.cottonoha.ios", category: "realtime")
    static let audio = Logger(subsystem: "app.cottonoha.ios", category: "audio")
}
