import assert from "node:assert/strict";
import { test } from "node:test";
import { playPcmTtsThroughAec, warmTtsPlayback } from "./tts-playback";

const nodes: FakeSource[] = [];
const destination = { stream: { getAudioTracks: () => [] } };
class FakeSource {
  buffer!: { duration: number; samples: Float32Array };
  onended: (() => void) | null = null;
  stopped = false;
  disconnected = false;
  at = 0;
  connect(target: unknown) { assert.equal(target, destination); }
  disconnect() { this.disconnected = true; }
  start(at: number) { this.at = at; }
  stop() { this.stopped = true; }
  end() { this.onended?.(); }
}
class FakeContext {
  state = "running";
  currentTime = 1;
  createMediaStreamDestination() { return destination; }
  createBuffer(_channels: number, count: number, rate: number) {
    const samples = new Float32Array(count);
    return { duration: count / rate, samples, getChannelData: () => samples };
  }
  createBufferSource() { const source = new FakeSource(); nodes.push(source); return source; }
}
class FakePeer {
  async createOffer() { return {}; }
  async createAnswer() { return {}; }
  async setLocalDescription() {}
  async setRemoteDescription() {}
}

async function flush() { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }

test("PCM starts before EOF, preserves split samples, and abort stops scheduled audio", async () => {
  const originals = { AudioContext: globalThis.AudioContext, RTCPeerConnection: globalThis.RTCPeerConnection, document: globalThis.document };
  const sink = {
    paused: true,
    playError: null as Error | null,
    setAttribute() {},
    async play() {
      if (this.playError) throw this.playError;
      this.paused = false;
    }
  };
  Object.assign(globalThis, { AudioContext: FakeContext, RTCPeerConnection: FakePeer, document: { createElement: () => sink } });
  try {
    await warmTtsPlayback();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; }, cancel() { cancelled = true; }
    }));
    const abort = new AbortController();
    const starting = playPcmTtsThroughAec(response, abort.signal);
    controller.enqueue(new Uint8Array([0, 128, 255])); // -32768, then half of +32767
    const playback = await starting;
    // Receiving samples is not audible playback if autoplay left the sink paused.
    assert.equal(sink.paused, false);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0]!.buffer.samples[0], -1);
    assert.equal(nodes[0]!.at, 1.04);
    let completed = false;
    void playback.done.then(() => { completed = true; });
    nodes[0]!.end(); // A network gap is not the end of the utterance.
    await flush();
    assert.equal(completed, false);
    controller.enqueue(new Uint8Array([127, 0, 0]));
    await flush();
    assert.deepEqual([...nodes[1]!.buffer.samples], [32767 / 32768, 0]);
    abort.abort();
    await playback.done;
    assert.ok(nodes[1]!.stopped && nodes[1]!.disconnected);
    assert.ok(cancelled);
    assert.ok(completed);

    // Failures after audio starts must release the queue, not leave it hanging.
    let failure!: ReadableStreamDefaultController<Uint8Array>;
    const failing = playPcmTtsThroughAec(new Response(new ReadableStream({ start(value) { failure = value; } })));
    failure.enqueue(new Uint8Array([1, 0]));
    const broken = await failing;
    failure.error(new Error("stream disconnected"));
    await assert.rejects(broken.done, /stream disconnected/);
    assert.ok(nodes.at(-1)!.stopped);

    sink.paused = true;
    sink.playError = new DOMException("Output blocked", "NotAllowedError");
    await assert.rejects(playPcmTtsThroughAec(new Response(new Uint8Array([1, 0]))), /Output blocked/);
    sink.playError = null;
    await warmTtsPlayback();
    assert.equal(sink.paused, false); // A later user click can retry the output.
  } finally { Object.assign(globalThis, originals); }
});
