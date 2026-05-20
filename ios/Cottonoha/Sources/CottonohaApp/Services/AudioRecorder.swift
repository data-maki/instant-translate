import AVFoundation
import Foundation

public final class AudioRecorder: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "cottonoha.audio-recorder")
    private var converter: AVAudioConverter?
    private var outputFormat: AVAudioFormat?
    private var onChunk: (@Sendable (Data) -> Void)?

    public init() {}

    public func start(onChunk: @escaping @Sendable (Data) -> Void) throws {
        self.onChunk = onChunk

        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setPreferredSampleRate(16_000)
        try session.setActive(true)
        #endif

        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: 16_000,
            channels: 1,
            interleaved: true
        ) else {
            throw AudioError.couldNotCreateFormat
        }
        converter = AVAudioConverter(from: inputFormat, to: targetFormat)
        outputFormat = targetFormat

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
            self?.queue.async {
                self?.convertAndEmit(buffer)
            }
        }
        engine.prepare()
        try engine.start()
        AppLog.audio.info("Audio recorder started inputRate=\(inputFormat.sampleRate) targetRate=\(targetFormat.sampleRate)")
    }

    public func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        converter = nil
        outputFormat = nil
        onChunk = nil
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
        AppLog.audio.info("Audio recorder stopped")
    }

    private func convertAndEmit(_ buffer: AVAudioPCMBuffer) {
        guard let converter, let outputFormat else { return }
        let ratio = outputFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
        guard let converted = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }

        var didProvideInput = false
        var error: NSError?
        converter.convert(to: converted, error: &error) { _, status in
            if didProvideInput {
                status.pointee = .noDataNow
                return nil
            }
            didProvideInput = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, let data = converted.int16PCMData else {
            if let error {
                AppLog.audio.error("Audio conversion failed: \(error.localizedDescription, privacy: .public)")
            }
            return
        }
        onChunk?(data)
    }
}

public enum AudioError: LocalizedError {
    case couldNotCreateFormat

    public var errorDescription: String? {
        "Could not create the required 16 kHz PCM audio format."
    }
}

private extension AVAudioPCMBuffer {
    var int16PCMData: Data? {
        guard let channelData = int16ChannelData else { return nil }
        let frameCount = Int(frameLength)
        return Data(bytes: channelData[0], count: frameCount * MemoryLayout<Int16>.size)
    }
}
