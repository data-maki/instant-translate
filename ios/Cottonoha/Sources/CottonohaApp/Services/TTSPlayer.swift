import AVFoundation
import Foundation

/// Playback completes only when the clip ends, so queued translations cannot overlap.
@MainActor
public final class TTSPlayer: NSObject, AVAudioPlayerDelegate {
    private var current: AVAudioPlayer?
    private var completion: CheckedContinuation<Void, Error>?

    public override init() { super.init() }

    public func play(base64: String) async throws {
        try Task.checkCancellation()
        stop()
        guard let data = Data(base64Encoded: base64) else { throw APIError.invalidResponse }
        #if os(iOS)
        // Keep the microphone available while playing a translated reply.
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
        #endif
        let player = try AVAudioPlayer(data: data)
        player.delegate = self
        player.prepareToPlay()
        current = player
        try await withCheckedThrowingContinuation { continuation in
            completion = continuation
            if !player.play() { finish(.failure(APIError.server("Could not play speech."))) }
        }
    }

    public func stop() {
        current?.stop()
        finish(.failure(CancellationError()))
    }

    nonisolated public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current, ObjectIdentifier(current) == identity else { return }
            finish(flag ? .success(()) : .failure(APIError.server("Speech playback failed.")))
        }
    }

    nonisolated public func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        let identity = ObjectIdentifier(player)
        Task { @MainActor [weak self] in
            guard let self, let current, ObjectIdentifier(current) == identity else { return }
            finish(.failure(APIError.server("Could not decode speech audio.")))
        }
    }

    private func finish(_ result: Result<Void, Error>) {
        current?.delegate = nil
        current = nil
        let pending = completion
        completion = nil
        pending?.resume(with: result)
    }
}
