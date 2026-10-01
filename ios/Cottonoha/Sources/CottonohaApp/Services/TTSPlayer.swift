import AVFoundation
import Foundation

/// One cancellable output. Completion means the final buffer has actually played.
@MainActor
public final class TTSPlayer: NSObject, AVAudioPlayerDelegate {
    private var current: AVAudioPlayer?
    private var completion: CheckedContinuation<Void, Error>?
    private let engine = AVAudioEngine()
    private let pcm = AVAudioPlayerNode()
    private var generation = UUID()
    private var pendingBuffers = 0
    private var activeAudio: SpeechAudio?

    public override init() {
        super.init()
        engine.attach(pcm)
    }

    func play(_ audio: SpeechAudio, onStart: @escaping () -> Void) async throws {
        try Task.checkCancellation()
        stop()
        let request = generation
        activeAudio = audio
        do {
            try activateOutput()
            switch audio.format {
            case .mp3:
                var data = Data()
                for try await chunk in audio.chunks { try Task.checkCancellation(); data.append(chunk) }
                try Task.checkCancellation()
                let player = try AVAudioPlayer(data: data)
                player.delegate = self
                player.prepareToPlay()
                current = player
                try await withCheckedThrowingContinuation { continuation in
                    completion = continuation
                    if player.play() { onStart() }
                    else { finish(.failure(APIError.server("Could not play speech."))) }
                }
            case .pcm(let sampleRate):
                guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate,
                                                 channels: 1, interleaved: false) else { throw APIError.invalidResponse }
                engine.connect(pcm, to: engine.mainMixerNode, format: format)
                engine.prepare()
                try engine.start()
                var remainder = Data(), started = false
                for try await chunk in audio.chunks {
                    try Task.checkCancellation()
                    guard generation == request else { throw CancellationError() }
                    remainder.append(chunk)
                    let byteCount = remainder.count - remainder.count % 2
                    guard byteCount > 0 else { continue }
                    let samples = byteCount / 2
                    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples)),
                          let output = buffer.floatChannelData?[0] else { throw APIError.invalidResponse }
                    buffer.frameLength = AVAudioFrameCount(samples)
                    let bytes = Array(remainder.prefix(byteCount))
                    for i in 0..<samples {
                        let value = Int16(bitPattern: UInt16(bytes[i * 2]) | UInt16(bytes[i * 2 + 1]) << 8)
                        output[i] = Float(value) / 32768
                    }
                    remainder = Data(remainder.dropFirst(byteCount))
                    pendingBuffers += 1
                    pcm.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                        Task { @MainActor in
                            guard let self, self.generation == request else { return }
                            self.pendingBuffers -= 1
                            if self.pendingBuffers == 0, self.completion != nil { self.finish(.success(())) }
                        }
                    }
                    if !started { started = true; pcm.play(); onStart() }
                }
                try Task.checkCancellation()
                guard started, remainder.isEmpty else { throw APIError.server("Incomplete speech audio.") }
                if pendingBuffers > 0 {
                    try await withCheckedThrowingContinuation { completion = $0 }
                }
            }
            if generation == request { activeAudio = nil }
        } catch {
            if generation == request { stop() }
            throw error
        }
    }

    private func activateOutput() throws {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
        #endif
    }

    public func stop() {
        generation = UUID()
        activeAudio?.cancel()
        activeAudio = nil
        current?.stop()
        pcm.stop()
        engine.stop()
        pendingBuffers = 0
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
