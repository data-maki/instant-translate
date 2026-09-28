import assert from "node:assert/strict";
import { test } from "node:test";
import { generateTtsStream } from "./api";

test("completed speech is cached by user, voice, language and exact text", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(new Uint8Array([1, 0, 2, 0])); };
  try {
    const payload = { text: "Cache test", target_language: "bg" };
    const first = await generateTtsStream(payload, "user-one");
    await first.arrayBuffer();
    const cached = await generateTtsStream(payload, "user-one");
    assert.deepEqual(new Uint8Array(await cached.arrayBuffer()), new Uint8Array([1, 0, 2, 0]));
    assert.equal(calls, 1);
    for (const [request, user] of [
      [payload, "user-two"], [{ ...payload, voice_id: "another" }, "user-one"],
      [{ ...payload, target_language: "ja" }, "user-one"], [{ ...payload, text: "Other text" }, "user-one"]
    ] as const) await (await generateTtsStream(request, user)).arrayBuffer();
    assert.equal(calls, 5);
  } finally { globalThis.fetch = original; }
});

test("first chunk is readable before synthesis ends; incomplete audio is not cached", async () => {
  const original = globalThis.fetch;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }));
  };
  try {
    const payload = { text: "Streaming test", target_language: "bg" };
    const response = await generateTtsStream(payload, "user-one");
    controller.enqueue(new Uint8Array([3, 0]));
    const reader = response.body!.getReader();
    assert.deepEqual((await reader.read()).value, new Uint8Array([3, 0]));
    await reader.cancel();
    const second = await generateTtsStream(payload, "user-one");
    assert.equal(calls, 2);
    await second.body!.cancel();
  } finally { globalThis.fetch = original; }
});

test("an expired or aborted cache request cannot reuse audio", async () => {
  const original = globalThis.fetch;
  const originalNow = Date.now;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(new Uint8Array([0, 0])); };
  try {
    const payload = { text: "Expiry test", target_language: "bg" };
    await (await generateTtsStream(payload, "user-one")).arrayBuffer();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(generateTtsStream(payload, "user-one", controller.signal), { name: "AbortError" });
    Date.now = () => originalNow() + 6 * 60_000;
    await (await generateTtsStream(payload, "user-one")).arrayBuffer();
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; Date.now = originalNow; }
});

test("an older running backend falls back to MP3 without caching it as PCM", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async input => {
    paths.push(String(input));
    if (String(input).endsWith("/tts/stream")) return new Response(null, { status: 404 });
    return Response.json({ audio_base64: "AQI=", mime_type: "audio/mpeg", model_id: "eleven_v3", voice_id: "voice" });
  };
  try {
    const payload = { text: "Old backend test", target_language: "bg" };
    const response = await generateTtsStream(payload, "user-one");
    assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2]));
    await (await generateTtsStream(payload, "user-one")).arrayBuffer();
    assert.equal(paths.length, 4);
    assert.ok(paths[0]!.endsWith("/tts/stream") && paths[1]!.endsWith("/tts/speak"));
  } finally { globalThis.fetch = original; }
});
