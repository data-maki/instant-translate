/**
 * Plays TTS audio through a local WebRTC loopback so the browser's
 * acoustic echo canceller (already engaged on the `getUserMedia` mic stream
 * via `echoCancellation: true`) treats it as far-end audio and subtracts it
 * from what the mic captures.
 *
 * Why this is necessary: a plain `<audio>` element playing a `data:` URL goes
 * straight to the default output and is invisible to the AEC reference path,
 * so the speaker output leaks back into the mic and gets re-transcribed. By
 * routing the same audio through an `RTCPeerConnection` pair, the playback
 * arrives at the sink as a remote WebRTC track — which AEC does see.
 */

type Loopback = {
  context: AudioContext;
  destination: MediaStreamAudioDestinationNode;
  sink: HTMLAudioElement;
};

let loopback: Loopback | null = null;
let loopbackPromise: Promise<Loopback> | null = null;

async function ensureLoopback(): Promise<Loopback> {
  if (loopback) {
    if (loopback.context.state === "suspended") {
      await loopback.context.resume();
    }
    // A connected remote track can still be silent: autoplay may leave the
    // final output element paused. Explicit playback also surfaces rejection.
    await loopback.sink.play();
    return loopback;
  }
  if (loopbackPromise) return loopbackPromise;

  loopbackPromise = (async () => {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();

    const outbound = new RTCPeerConnection();
    const inbound = new RTCPeerConnection();

    outbound.onicecandidate = (event) => {
      if (event.candidate) void inbound.addIceCandidate(event.candidate);
    };
    inbound.onicecandidate = (event) => {
      if (event.candidate) void outbound.addIceCandidate(event.candidate);
    };

    const sink = document.createElement("audio");
    sink.autoplay = true;
    sink.setAttribute("playsinline", "true");
    inbound.ontrack = (event) => {
      sink.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    };

    for (const track of destination.stream.getAudioTracks()) {
      outbound.addTrack(track, destination.stream);
    }

    const offer = await outbound.createOffer();
    await outbound.setLocalDescription(offer);
    await inbound.setRemoteDescription(offer);
    const answer = await inbound.createAnswer();
    await inbound.setLocalDescription(answer);
    await outbound.setRemoteDescription(answer);

    loopback = { context, destination, sink };
    await sink.play();
    return loopback;
  })();

  try {
    return await loopbackPromise;
  } finally {
    loopbackPromise = null;
  }
}

export type TtsPlayback = {
  /** Resolves when playback ends (naturally or via stop()). */
  done: Promise<void>;
  /** Interrupt playback and free the underlying nodes. */
  stop: () => void;
};

/** Called from a click/start handler to unlock audio and negotiate AEC early. */
export async function warmTtsPlayback(): Promise<void> {
  await ensureLoopback();
}

/** Play 24 kHz signed little-endian PCM immediately, without a complete MP3 or
 * decodeAudioData. Every chunk still goes through the WebRTC echo reference. */
export async function playPcmTtsThroughAec(response: Response, signal?: AbortSignal): Promise<TtsPlayback> {
  if (response.headers.get("Content-Type")?.startsWith("audio/mpeg")) {
    const url = URL.createObjectURL(await response.blob());
    try {
      const playback = await playTtsThroughAec(url, signal);
      void playback.done.finally(() => URL.revokeObjectURL(url));
      return playback;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
  const { context, destination } = await ensureLoopback();
  signal?.throwIfAborted();
  if (!response.body) throw new Error("Missing speech audio");
  const reader = response.body.getReader();
  const sources = new Set<AudioBufferSourceNode>();
  let finished = false;
  let ended = false;
  let scheduledUntil = context.currentTime;
  let trailingByte: number | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // A stream can fail before the caller receives the playback handle.
  void done.catch(() => {});
  let resolveStarted!: () => void;
  let rejectStarted!: (error: unknown) => void;
  const started = new Promise<void>((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
  const finish = (error?: unknown) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", stop);
    void reader.cancel().catch(() => {});
    for (const source of sources) { source.onended = null; source.stop(); source.disconnect(); }
    sources.clear();
    rejectStarted(error ?? new DOMException("Speech stopped", "AbortError"));
    if (error) rejectDone(error);
    else resolveDone();
  };
  const stop = () => finish();
  signal?.addEventListener("abort", stop, { once: true });
  void (async () => {
    try {
      while (!finished) {
        const { value, done: eof } = await reader.read();
        if (finished) return;
        if (eof) {
          if (trailingByte !== undefined) throw new Error("Incomplete speech audio sample");
          ended = true;
          if (!sources.size) finish();
          return;
        }
        let bytes = value;
        if (trailingByte !== undefined) {
          bytes = new Uint8Array(value.length + 1);
          bytes[0] = trailingByte;
          bytes.set(value, 1);
          trailingByte = undefined;
        }
        if (bytes.length % 2) trailingByte = bytes[bytes.length - 1];
        const samples = Math.floor(bytes.length / 2);
        if (!samples) continue;
        const buffer = context.createBuffer(1, samples, 24000);
        const channel = buffer.getChannelData(0);
        const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
        for (let i = 0; i < samples; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);
        sources.add(source);
        source.onended = () => {
          sources.delete(source);
          source.disconnect();
          if (ended && !sources.size) finish();
        };
        const at = Math.max(scheduledUntil, context.currentTime + 0.04);
        scheduledUntil = at + buffer.duration;
        source.start(at);
        resolveStarted();
      }
    } catch (error) { finish(error); }
  })();
  await started;
  return { done, stop };
}

export async function playTtsThroughAec(src: string, signal?: AbortSignal): Promise<TtsPlayback> {
  const { context, destination } = await ensureLoopback();
  signal?.throwIfAborted();

  const element = document.createElement("audio");
  element.src = src;
  // The element's output is rerouted by MediaElementAudioSourceNode, so it
  // does not play to the default output directly — only the loopback sink
  // (a WebRTC remote stream) reaches the speakers, which is what makes AEC
  // see it as far-end audio.
  const source = context.createMediaElementSource(element);
  source.connect(destination);

  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", stop);
    try {
      source.disconnect();
    } catch {
      // already disconnected
    }
    element.src = "";
    resolveDone();
  };

  const stop = () => {
    element.pause();
    finish();
  };
  signal?.addEventListener("abort", stop, { once: true });

  element.onended = finish;
  element.onerror = finish;

  try {
    await element.play();
  } catch (err) {
    finish();
    throw err;
  }

  return {
    done,
    stop,
  };
}
