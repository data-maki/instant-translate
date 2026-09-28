// Deferred speech requests exercise the real UI handlers without microphone or browser access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { AutoSpeakQueue } from "../.test-build/lib/autospeak.js";

const names = ["changeTtsMode", "speakPhraseText", "playSpeechItem", "speechOptions", "getSpeechQueue", "resetSpeechQueue", "refreshAutoSpeak", "maybeAutoSpeakPhrases", "setTtsStatusFor"];
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
const result = { mime_type: "audio/mpeg", audio_base64: "test" };
function phrase(id, source = "en") {
  return { id, source_lang: source, texts: { en: `English ${id}`, bg: `Български ${id}` }, is_final: true };
}
function harness(phrases) {
  const requests = [], audio = [];
  const statuses = {};
  const deps = {
    AutoSpeakQueue, phrases, ttsModeRef: { current: "push" }, ttsLatencyRef: { current: "fast" },
    ttsQueueRef: { current: null }, ttsAudioRef: { current: null }, adaptationsRef: { current: {} },
    ttsSpeakLanguage: "bg", travelerProfile: {}, userId: "test-user", setTtsMode: () => {},
    setTtsStatus: update => Object.assign(statuses, { value: update(statuses.value || {}) }),
    generateTts: (payload, _user, signal) => {
      const request = { ...deferred(), payload, signal };
      requests.push(request);
      return request.promise;
    },
    playTtsThroughAec: async (_src, signal) => {
      const done = deferred();
      const playback = { done: done.promise, finish: done.resolve, stopped: false, stop() { this.stopped = true; done.resolve(); } };
      audio.push(playback);
      signal.addEventListener("abort", () => playback.stop(), { once: true });
      return playback;
    }
  };
  const api = new Function(...Object.keys(deps), `${compiled}\nreturn {${names.join(",")}}`)(...Object.values(deps));
  return { api, requests, audio, statuses, deps };
}

test("toggle starts at the latest box, queues new English turns, and ignores Bulgarian replies", async () => {
  const history = [phrase("old"), phrase("latest")];
  const h = harness(history);
  h.api.changeTtsMode("auto");
  assert.deepEqual(h.requests.map(request => request.payload.text), ["Български latest"]);
  h.requests[0].resolve(result);
  await flush();
  h.api.maybeAutoSpeakPhrases([...history, phrase("reply", "bg"), phrase("new")], {});
  assert.equal(h.requests.length, 1);
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
