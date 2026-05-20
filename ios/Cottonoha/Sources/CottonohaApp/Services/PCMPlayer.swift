import AVFoundation
import Foundation

public final class PCMPlayer: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let queue = DispatchQueue(label: "cottonoha.pcm-player")
    private var isStarted = false

    public init() {
        engine.attach(player)
    }

    public func playBase64PCM16(_ base64: String, sampleRate: Double) {
        guard let data = Data(base64Encoded: base64), !data.isEmpty else { return }
        queue.async { [weak self] in
            self?.play(data: data, sampleRate: sampleRate)
        }
    }

    public func stop() {
        queue.async { [weak self] in
            self?.player.stop()
            self?.engine.stop()
            self?.isStarted = false
        }
    }

    private func play(data: Data, sampleRate: Double) {
        guard let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1, interleaved: false) else {
            return
        }
        if !isStarted {
            engine.connect(player, to: engine.mainMixerNode, format: format)
            try? engine.start()
            player.play()
            isStarted = true
        }
        let sampleCount = data.count / MemoryLayout<Int16>.size
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(sampleCount)) else {
            return
        }
        buffer.frameLength = AVAudioFrameCount(sampleCount)
        data.withUnsafeBytes { rawBuffer in
            guard let input = rawBuffer.bindMemory(to: Int16.self).baseAddress,
                  let output = buffer.floatChannelData?[0] else {
                return
            }
            for index in 0..<sampleCount {
                output[index] = max(-1, min(1, Float(input[index]) / Float(Int16.max)))
            }
        }
        player.scheduleBuffer(buffer, completionHandler: nil)
    }
}
