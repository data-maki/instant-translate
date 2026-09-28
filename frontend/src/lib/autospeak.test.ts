import assert from "node:assert/strict";
import { test } from "node:test";
import type { Phrase } from "./api";
import { AutoSpeakQueue, type SpeechItem, type SpeechOptions } from "./autospeak";
import { adaptationKey } from "./phrase-text";
import type { TtsPlayback } from "./tts-playback";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function phrase(id: string, source = "en", ready = true): Phrase {
  return { id, speaker: "1", speaker_label: "Person", source_lang: source,
    texts: { en: `English ${id}`, bg: ready ? `Български ${id}` : "" }, is_final: true };
}

async function flush() {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function harness() {
  const queue = new AutoSpeakQueue();
  const jobs: Array<{ item: SpeechItem; signal: AbortSignal; done: ReturnType<typeof deferred<void>>; stopped: boolean }> = [];
  const options: SpeechOptions = {
    language: "bg", latency: "fast", adaptations: {}, status: () => {},
    play: async (item, signal) => {
      const job = { item, signal, done: deferred<void>(), stopped: false };
      jobs.push(job);
      return { done: job.done.promise, stop: () => { job.stopped = true; job.done.resolve(); } };
    }
  };
  return { queue, options, jobs };
}

test("enabling starts at the latest box and plays new translations sequentially", async () => {
  const { queue, options, jobs } = harness();
  const history = [phrase("old-1"), phrase("old-2"), phrase("latest")];
  queue.enable(history, options);
  queue.update([...history, phrase("next"), phrase("last")], options);
  await flush();
  assert.deepEqual(jobs.map(job => job.item.text), ["Български latest"]);
  jobs[0]!.done.resolve();
  await flush();
  assert.deepEqual(jobs.map(job => job.item.text), ["Български latest", "Български next"]);
  jobs[1]!.done.resolve();
  await flush();
  assert.equal(jobs[2]!.item.text, "Български last");
  assert.ok(jobs.every(job => !job.stopped));
});

test("a Bulgarian latest box never causes a backwards search or speech feedback", async () => {
  const { queue, options, jobs } = harness();
  const history = [phrase("old-English"), phrase("reply", "bg")];
  queue.enable(history, options);
  queue.update([...history, phrase("echo", "bg")], options);
  await flush();
  assert.equal(jobs.length, 0);
  queue.update([...history, phrase("echo", "bg"), phrase("new-English")], options);
  await flush();
  assert.deepEqual(jobs.map(job => job.item.text), ["Български new-English"]);
});

test("later translations cannot overtake an unfinished English turn", async () => {
  const { queue, options, jobs } = harness();
  const first = phrase("first", "en", false);
  queue.enable([first], options);
  queue.update([first, phrase("second")], options);
  assert.equal(jobs.length, 0);
  options.adaptations = { [adaptationKey(first, "bg")]: { source_rewrite: "First", target_translation: "Първо", status: "ready" } };
  queue.refresh(options);
  await flush();
  assert.equal(jobs[0]!.item.text, "Първо");
  jobs[0]!.done.resolve();
  await flush();
  assert.equal(jobs[1]!.item.text, "Български second");
});

test("partial text and later corrections are spoken only once when finalized", async () => {
  const { queue, options, jobs } = harness();
  queue.enable([{ ...phrase("one"), is_final: false }], options);
  assert.equal(jobs.length, 0);
  queue.update([phrase("one")], options);
  await flush();
  jobs[0]!.done.resolve();
  await flush();
  queue.update([{ ...phrase("one"), texts: { en: "A correction", bg: "Поправка" } }], options);
  queue.refresh(options);
  assert.equal(jobs.length, 1);
});

test("turning autospeak off stops the current audio and discards pending turns", async () => {
  const { queue, options, jobs } = harness();
  queue.enable([phrase("one")], options);
  queue.update([phrase("one"), phrase("two")], options);
  await flush();
  queue.disable();
  await flush();
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0]!.signal.aborted);
  assert.ok(jobs[0]!.stopped);
  queue.enable([phrase("one"), phrase("two"), phrase("three")], options);
  assert.equal(jobs[1]!.item.text, "Български three");
});

test("cancelled synthesis cannot revive a queue or interrupt its replacement", async () => {
  const { queue, options } = harness();
  const synthesis = deferred<TtsPlayback>();
  let signal!: AbortSignal;
  let stopped = false;
  options.play = async (_item, requestSignal) => { signal = requestSignal; return synthesis.promise; };
  queue.enable([phrase("old")], options);
  queue.reset([], options, true);
  assert.ok(signal.aborted);
  synthesis.resolve({ done: Promise.resolve(), stop: () => { stopped = true; } });
  await flush();
  assert.ok(stopped);
});

test("opening or resuming history establishes a boundary without reading it", async () => {
  const { queue, options, jobs } = harness();
  const history = [phrase("old")];
  queue.reset(history, options, true);
  queue.update(history, options);
  assert.equal(jobs.length, 0);
  queue.update([...history, phrase("new")], options);
  await flush();
  assert.equal(jobs[0]!.item.text, "Български new");
});

test("unknown sources and English output do not trigger autospeak", () => {
  const { queue, options, jobs } = harness();
  queue.enable([{ ...phrase("unknown"), source_lang: null }], options);
  assert.equal(jobs.length, 0);
  queue.enable([phrase("english")], { ...options, language: "en" });
  assert.equal(jobs.length, 0);
});

test("manual playback interrupts the backlog; new turns queue behind it", async () => {
  const { queue, options, jobs } = harness();
  queue.enable([phrase("one")], options);
  queue.update([phrase("one"), phrase("two")], options);
  await flush();
  queue.speakNow({ key: "manual", text: "Read this", language: "bg" }, options);
  queue.update([phrase("one"), phrase("two"), phrase("three")], options);
  await flush();
  assert.ok(jobs[0]!.stopped);
  assert.equal(jobs[1]!.item.text, "Read this");
  jobs[1]!.done.resolve();
  await flush();
  assert.equal(jobs[2]!.item.text, "Български three");
});

test("a failed synthesis releases the next queued turn", async () => {
  const { queue, options, jobs } = harness();
  const normalPlay = options.play;
  options.play = (item, signal) => item.text.endsWith("one") ? Promise.reject(new Error("provider failed")) : normalPlay(item, signal);
  queue.enable([], options);
  queue.update([phrase("one"), phrase("two")], options);
  await flush();
  assert.equal(jobs[0]!.item.text, "Български two");
});

test("slow-mode translation completion releases the waiting utterance", async () => {
  const { queue, options, jobs } = harness();
  const first = phrase("one");
  options.latency = "slow";
  queue.enable([first], options);
  assert.equal(jobs.length, 0);
  options.adaptations = { [adaptationKey(first, "bg")]: { source_rewrite: "Polished English", target_translation: "Готово", status: "ready" } };
  queue.refresh(options);
  await flush();
  assert.equal(jobs.length, 1);
});

test("a late adaptation refresh cannot restore a previous output language", async () => {
  const { queue, options, jobs } = harness();
  const current = { ...phrase("one"), texts: { en: "Hello", bg: "Здравей", ja: "こんにちは" } };
  const newOptions = { ...options, language: "ja", latency: "slow" as const };
  queue.enable([current], newOptions);
  assert.equal(jobs.length, 0);
  queue.refresh(options); // Old Bulgarian callback may update readiness only.
  await flush();
  assert.equal(jobs[0]!.item.language, "ja");
});

test("prepares only one reply ahead, reuses it, and keeps playback ordered", async () => {
  const { queue, options, jobs } = harness();
  const prepared: string[] = [];
  const responses = new Map<string, Promise<Response>>();
  options.prepare = (item) => {
    prepared.push(item.text);
    const response = Promise.resolve(new Response(new Uint8Array([0, 0])));
    responses.set(item.text, response);
    return response;
  };
  const play = options.play;
  options.play = async (item, signal, response) => {
    assert.equal(await response, await responses.get(item.text));
    return play(item, signal);
  };
  queue.enable([phrase("one")], options);
  queue.update([phrase("one"), phrase("two"), phrase("three")], options);
  queue.refresh(options);
  await flush();
  assert.deepEqual(prepared, ["Български one", "Български two"]);
  assert.equal(jobs.length, 1);
  jobs[0]!.done.resolve();
  await flush();
  assert.equal(jobs[1]!.item.text, "Български two");
  assert.deepEqual(prepared, ["Български one", "Български two", "Български three"]);
  queue.disable();
});

test("corrections and voice changes invalidate prepared audio; reset cancels it", async () => {
  const { queue, options } = harness();
  const prepared: Array<{ item: SpeechItem; signal: AbortSignal }> = [];
  options.prepare = async (item, signal) => {
    prepared.push({ item, signal });
    return new Response(new Uint8Array([0, 0]));
  };
  queue.enable([phrase("one")], options);
  queue.update([phrase("one"), phrase("two")], options);
  const correction = { ...phrase("two"), texts: { en: "Second", bg: "Поправка" } };
  queue.update([phrase("one"), correction], options);
  assert.ok(prepared[1]!.signal.aborted);
  assert.equal(prepared[2]!.item.text, "Поправка");
  queue.update([phrase("one"), correction], { ...options, preparationKey: "new voice" });
  assert.ok(prepared[2]!.signal.aborted);
  queue.reset([], options, true);
  assert.ok(prepared.every(job => job.signal.aborted));
});

test("lookahead ignores history and Bulgarian replies and never overtakes an untranslated turn", () => {
  const { queue, options } = harness();
  const prepared: string[] = [];
  options.prepare = async item => { prepared.push(item.text); return new Response(); };
  queue.reset([phrase("old")], options, true);
  queue.update([phrase("old"), phrase("reply", "bg"), { ...phrase("pending", "en", false), is_final: false }, phrase("later")], options);
  assert.deepEqual(prepared, []);
});

test("stable draft audio prepares early but waits for confirmation; final text skips debounce", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { queue, options, jobs } = harness();
  const prepared: Array<{ item: SpeechItem; signal: AbortSignal }> = [];
  options.prepare = async (item, signal) => { prepared.push({ item, signal }); return new Response(); };
  queue.enable([{ ...phrase("one"), is_final: false }], options);
  t.mock.timers.tick(149);
  assert.equal(prepared.length, 0);
  t.mock.timers.tick(1);
  assert.equal(prepared.length, 1);
  assert.equal(jobs.length, 0);
  queue.update([phrase("one")], options);
  await flush();
  assert.equal(prepared.length, 1);
  assert.equal(jobs.length, 1);
  queue.disable();

  queue.enable([{ ...phrase("two"), is_final: false }], options);
  queue.update([phrase("two")], options); // No artificial 150-ms wait on final text.
  assert.equal(prepared.length, 2);
  queue.disable();
});

test("draft corrections discard speculative audio and reset cancels pending timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { queue, options, jobs } = harness();
  const prepared: Array<{ item: SpeechItem; signal: AbortSignal }> = [];
  options.prepare = async (item, signal) => { prepared.push({ item, signal }); return new Response(); };
  queue.enable([{ ...phrase("one"), is_final: false }], options);
  t.mock.timers.tick(150);
  queue.update([{ ...phrase("one"), texts: { en: "Correction", bg: "Поправка" } }], options);
  await flush();
  assert.ok(prepared[0]!.signal.aborted);
  assert.deepEqual(jobs.map(job => job.item.text), ["Поправка"]);
  queue.enable([{ ...phrase("two"), is_final: false }], options);
  queue.reset([], options, true);
  t.mock.timers.tick(300);
  assert.equal(prepared.length, 2);
});
