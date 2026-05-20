export type RecorderHandle = {
  stop: () => void;
};

export type PcmAudioPlayer = {
  playBase64Pcm16: (audio: string, sampleRate: number) => void;
  stop: () => void;
};

export type PcmRecorderOptions = {
  autoGainControl?: boolean;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
};

const TARGET_SAMPLE_RATE = 16000;

export async function startPcmRecorder(
  onChunk: (chunk: ArrayBuffer) => void,
  options: PcmRecorderOptions = {}
): Promise<RecorderHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: options.echoCancellation ?? false,
      noiseSuppression: options.noiseSuppression ?? false,
      autoGainControl: options.autoGainControl ?? false
    }
  });

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const pcm = floatTo16BitPcm(resample(input, context.sampleRate, TARGET_SAMPLE_RATE));
    const chunk = new ArrayBuffer(pcm.byteLength);
    new Int16Array(chunk).set(pcm);
    onChunk(chunk);
  };

  source.connect(processor);
  processor.connect(context.destination);

  return {
    stop: () => {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    }
  };
}

export async function createPcmAudioPlayer(): Promise<PcmAudioPlayer> {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const context = new AudioContextClass();
  if (context.state === "suspended") {
    await context.resume();
  }

  let nextStartTime = context.currentTime;
  const sources = new Set<AudioBufferSourceNode>();

  return {
    playBase64Pcm16: (audio: string, sampleRate: number) => {
      const pcm = base64ToInt16(audio);
      if (pcm.length === 0) {
        return;
      }
      const buffer = context.createBuffer(1, pcm.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < pcm.length; index += 1) {
        channel[index] = Math.max(-1, Math.min(1, pcm[index] / 0x8000));
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        sources.delete(source);
      };
      sources.add(source);

      const startAt = Math.max(context.currentTime + 0.02, nextStartTime);
      source.start(startAt);
      nextStartTime = startAt + buffer.duration;
    },
    stop: () => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Already ended.
        }
      }
      sources.clear();
      void context.close();
    }
  };
}

function resample(input: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return input;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const before = Math.floor(sourceIndex);
    const after = Math.min(before + 1, input.length - 1);
    const fraction = sourceIndex - before;
    output[index] = input[before] + (input[after] - input[before]) * fraction;
  }

  return output;
}

function floatTo16BitPcm(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
}

function base64ToInt16(value: string): Int16Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Int16Array(bytes.buffer);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
