import AVFoundation
import Foundation

/// Plays the ElevenLabs MP3 audio returned by `/tts/speak`. AVAudioPlayer
/// owns the file lifetime; we stop the previous clip when a new one starts
/// so taps in quick succession don't overlap.
public final class TTSPlayer: @unchecked Sendable {
    private let queue = DispatchQueue(label: "cottonoha.ttsplayer")
    private var current: AVAudioPlayer?

    public init() {}

    public func play(base64: String) {
        guard let data = Data(base64Encoded: base64) else { return }
        queue.async { [weak self] in
            guard let self else { return }
            self.current?.stop()
            do {
                #if os(iOS)
                try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
                try AVAudioSession.sharedInstance().setActive(true)
                #endif
                let player = try AVAudioPlayer(data: data)
                player.prepareToPlay()
                player.play()
                self.current = player
            } catch {
                AppLog.realtime.error("TTS playback failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    public func stop() {
        queue.async { [weak self] in
            self?.current?.stop()
            self?.current = nil
        }
    }
}
