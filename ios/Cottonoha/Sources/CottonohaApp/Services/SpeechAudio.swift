import Foundation

struct SpeechAudio: Sendable {
    enum Format: Equatable, Sendable { case pcm(sampleRate: Double), mp3 }
    let format: Format
    let chunks: AsyncThrowingStream<Data, Error>
    let cancel: @Sendable () -> Void

    static func complete(_ data: Data, format: Format) -> SpeechAudio {
        SpeechAudio(format: format, chunks: AsyncThrowingStream { stream in
            stream.yield(data)
            stream.finish()
        }, cancel: {})
    }
}

struct SpeechCache {
    struct Key: Hashable { let text: String; let language: String; let voice: String? }
    private struct Entry { let data: Data; let sampleRate: Double; let saved: Date }
    private var entries: [Key: Entry] = [:]

    mutating func get(_ key: Key, now: Date = Date()) -> SpeechAudio? {
        entries = entries.filter { now.timeIntervalSince($0.value.saved) < 300 }
        guard let entry = entries[key] else { return nil }
        return .complete(entry.data, format: .pcm(sampleRate: entry.sampleRate))
    }

    mutating func insert(_ data: Data, sampleRate: Double, key: Key, now: Date = Date()) {
        guard !data.isEmpty, data.count <= 4 * 1024 * 1024 else { return }
        entries = entries.filter { now.timeIntervalSince($0.value.saved) < 300 }
        entries[key] = Entry(data: data, sampleRate: sampleRate, saved: now)
        while entries.count > 32 || entries.values.reduce(0, { $0 + $1.data.count }) > 8 * 1024 * 1024 {
            guard let oldest = entries.min(by: { $0.value.saved < $1.value.saved })?.key else { break }
            entries[oldest] = nil
        }
    }
}
