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

export async function playTtsThroughAec(src: string): Promise<TtsPlayback> {
  const { context, destination } = await ensureLoopback();

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
    try {
      source.disconnect();
    } catch {
      // already disconnected
    }
    element.src = "";
    resolveDone();
  };

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
    stop: () => {
      element.pause();
      finish();
    },
  };
}
