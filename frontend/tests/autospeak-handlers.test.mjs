// Deferred speech requests exercise the real UI handlers without microphone or browser access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { AutoSpeakQueue } from "../.test-build/lib/autospeak.js";
import { adaptationKey, firstNonEnglishTextLanguage } from "../.test-build/lib/phrase-text.js";

const names = ["changeTtsMode", "speakPhraseText", "prepareSpeechItem", "playSpeechItem", "speechOptions", "getSpeechQueue", "resetSpeechQueue", "refreshAutoSpeak", "maybeAutoSpeakPhrases", "setTtsStatusFor", "setPhrasesAndFollow", "requestAdaptationsFor", "dedupeList", "recentDialogueForRewrite"];
const source = ts.createSourceFile("TranslatorApp.tsx", readFileSync("src/components/TranslatorApp.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.set(node.name.text, node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(functions.size, names.length);
const compiled = ts.transpileModule([...functions.values()].join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }
}).outputText;
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }
const result = {};
function phrase(id, source = "en") {
  return { id, source_lang: source, texts: { en: `English ${id}`, bg: `Български ${id}` }, is_final: true };
}
function harness(phrases) {
  const requests = [], audio = [];
  const translations = [], rewrites = [], timers = [];
  const statuses = {};
  const deps = {
    AutoSpeakQueue, phrases, ttsModeRef: { current: "push" }, ttsLatencyRef: { current: "fast" },
    ttsQueueRef: { current: null }, ttsAudioRef: { current: null }, adaptationsRef: { current: {} },
    ttsSpeakLanguage: "bg", travelerProfile: {}, userId: "test-user", setTtsMode: () => {},
    activeLeftLanguage: "bg", sourceB: "en", ENGLISH_LANGUAGE: "en",
    adaptationKey, firstNonEnglishTextLanguage, contextBundle: { rewriteTone: {} },
    providerSignalsRef: { current: { transcripts: [], translations: [] } },
    adaptationRequestsRef: { current: new Set() },
    setPhrases: () => {}, scrollFeedToBottomSoon: () => {}, persistAdaptation: () => {},
    setAdaptationsSynced: update => {
      deps.adaptationsRef.current = typeof update === "function" ? update(deps.adaptationsRef.current) : update;
    },
    translatePhrase: payload => { const request = { ...deferred(), payload }; translations.push(request); return request.promise; },
    adaptPhrase: payload => { const request = { ...deferred(), payload }; rewrites.push(request); return request.promise; },
    window: { setTimeout: callback => { timers.push(callback); return timers.length; } },
    setTtsStatus: update => Object.assign(statuses, { value: update(statuses.value || {}) }),
    warmTtsPlayback: async () => {},
    generateTtsStream: (payload, _user, signal) => {
      const request = { ...deferred(), payload, signal };
      requests.push(request);
      return request.promise;
    },
    playPcmTtsThroughAec: async (_src, signal) => {
      const done = deferred();
      const playback = { done: done.promise, finish: done.resolve, stopped: false, stop() { this.stopped = true; done.resolve(); } };
      audio.push(playback);
      signal.addEventListener("abort", () => playback.stop(), { once: true });
      return playback;
    }
  };
  const api = new Function(...Object.keys(deps), `${compiled}\nreturn {${names.join(",")}}`)(...Object.values(deps));
  return { api, requests, audio, statuses, deps, translations, rewrites, timers };
}

test("toggle starts at the latest box, queues new English turns, and ignores Bulgarian replies", async () => {
  const history = [phrase("old"), phrase("latest")];
  const h = harness(history);
  h.api.changeTtsMode("auto");
  assert.deepEqual(h.requests.map(request => request.payload.text), ["Български latest"]);
  h.requests[0].resolve(result);
  await flush();
  h.api.maybeAutoSpeakPhrases([...history, phrase("reply", "bg"), phrase("new")], {});
  assert.equal(h.requests.length, 2); // Next reply synthesizes during playback.
  assert.equal(h.audio.length, 1); // It cannot speak until the current one ends.
  h.audio[0].finish();
  await flush();
  assert.equal(h.requests[1].payload.text, "Български new");
  assert.equal(h.requests[1].payload.target_language, "bg");
  h.api.changeTtsMode("push");
});

test("switching autospeak off while synthesizing prevents any late playback", async () => {
  const h = harness([phrase("latest")]);
  h.api.changeTtsMode("auto");
  h.api.changeTtsMode("push");
  assert.ok(h.requests[0].signal.aborted);
  h.requests[0].resolve(result);
  await flush();
  assert.equal(h.audio.length, 0);
  assert.deepEqual(h.statuses.value, {});
});

test("navigation cancels speech and old adaptation completions cannot read history", async () => {
  const h = harness([phrase("old")]);
  h.api.changeTtsMode("auto");
  h.api.resetSpeechQueue([phrase("history")]);
  h.requests[0].resolve(result);
  h.api.refreshAutoSpeak();
  await flush();
  assert.equal(h.audio.length, 0);
  assert.equal(h.requests.length, 1);
  h.api.maybeAutoSpeakPhrases([phrase("history"), phrase("new")], {});
  assert.equal(h.requests[1].payload.text, "Български new");
  h.api.changeTtsMode("push");
});

test("cancellation during audio setup stops the late playback handle", async () => {
  const h = harness([phrase("latest")]);
  const setup = deferred();
  const options = h.api.speechOptions();
  // The queue contract also protects players whose async setup ignores abort.
  options.play = () => setup.promise;
  h.api.getSpeechQueue().enable([phrase("latest")], options);
  h.api.changeTtsMode("push");
  let stopped = false;
  setup.resolve({ done: Promise.resolve(), stop: () => { stopped = true; } });
  await flush();
  assert.ok(stopped);
});

for (const mode of ["fast", "slow"]) {
  test(`${mode}: an existing Bulgarian translation goes directly to TTS with no translation or rewrite calls`, () => {
    const h = harness([]);
    h.deps.ttsLatencyRef.current = mode;
    h.api.changeTtsMode("auto");
    const current = phrase("translated");
    // Old saved adaptations must not replace the actual transcript translation.
    h.deps.adaptationsRef.current[adaptationKey(current, "bg")] = {
      source_rewrite: "Polished English", target_translation: "Стара версия", status: "loading"
    };
    h.api.setPhrasesAndFollow([current]);
    assert.deepEqual(h.requests.map(request => request.payload.text), ["Български translated"]);
    assert.equal(h.translations.length, 0);
    assert.equal(h.rewrites.length, 0);
    assert.equal(h.timers.length, 0);
    h.api.changeTtsMode("push");
  });
}

test("a new translated English turn never schedules background retranslation", () => {
  const h = harness([]);
  h.api.setPhrasesAndFollow([phrase("translated")]);
  for (const timer of h.timers) timer();
  assert.equal(h.translations.length, 0);
  assert.equal(h.rewrites.length, 0);
  assert.equal(h.timers.length, 0);
});

test("missing Bulgarian is translated once and can speak without an English rewrite", async () => {
  const h = harness([]);
  h.deps.ttsLatencyRef.current = "slow";
  h.api.changeTtsMode("auto");
  const current = { ...phrase("typed"), texts: { en: "Where is the station?" } };
  h.api.setPhrasesAndFollow([current]);
  h.api.setPhrasesAndFollow([current]);
  assert.equal(h.requests.length, 0);
  assert.equal(h.translations.length, 1);
  assert.equal(h.translations[0].payload.target_language, "bg");
  h.translations[0].resolve({ target_translation: "Къде е гарата?" });
  await flush();
  h.api.setPhrasesAndFollow([current]);
  for (const timer of h.timers) timer();
  assert.deepEqual(h.requests.map(request => request.payload.text), ["Къде е гарата?"]);
  assert.equal(h.translations.length, 1);
  assert.equal(h.rewrites.length, 0);
  assert.equal(h.timers.length, 0);
  h.api.changeTtsMode("push");
});

test("a late fallback cannot override or replay a Soniox translation that has arrived", async () => {
  const h = harness([]);
  h.deps.ttsLatencyRef.current = "slow";
  h.api.changeTtsMode("auto");
  const current = phrase("delayed");
  h.api.setPhrasesAndFollow([{ ...current, texts: { en: current.texts.en } }]);
  h.api.setPhrasesAndFollow([current]);
  assert.deepEqual(h.requests.map(request => request.payload.text), [current.texts.bg]);
  h.translations[0].resolve({ target_translation: "Друга версия" });
  await flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.translations.length, 1);
  h.api.changeTtsMode("push");
});

test("requesting another display language translates only that missing language", () => {
  const h = harness([]);
  const current = phrase("translated");
  h.api.requestAdaptationsFor([current], "ja");
  h.api.requestAdaptationsFor([current], "ja");
  assert.deepEqual(h.translations.map(request => request.payload.target_language), ["ja"]);
  assert.equal(h.timers.length, 0);
  assert.equal(h.rewrites.length, 0);
});
