// Render the real stateless component tree and invoke its actual button handlers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loadSource(path) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
  }).outputText;
  const exports = {};
  new Function("require", "exports", code)((name) => {
    if (name === "@/lib/phrase-text") return require("../.test-build/lib/phrase-text.js");
    if (name === "@/lib/speaker") return loadSource("src/lib/speaker.ts");
    if (name === "@/lib/language-colors") return loadSource("src/lib/language-colors.ts");
    return require(name);
  }, exports);
  return exports;
}
const { PhraseCard } = loadSource("src/components/PhraseCard.tsx");

test("saved transcript duration respects explicit milliseconds, including early turns", () => {
  const source = ts.createSourceFile("TranslatorApp.tsx", readFileSync("src/components/TranslatorApp.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const helpers = source.statements.filter(node => ts.isFunctionDeclaration(node)
    && ["durationFromPhrases", "phraseSeconds"].includes(node.name?.text));
  assert.equal(helpers.length, 2);
  const code = ts.transpileModule(helpers.map(node => node.getText(source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const duration = new Function("speakerTurnSeconds", `${code}; return durationFromPhrases;`)(loadSource("src/lib/speaker.ts").speakerTurnSeconds);
  assert.equal(duration([{time: 8000, time_ms: 8000}, {time: 15000, time_ms: 15000}]), 15);
  assert.equal(duration([{time: 8000, time_ms: 8000}]), 8);
  assert.equal(duration([{time: "3"}]), 3);
  assert.equal(duration([]), null);
});

function elements(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node.type === "function") return elements(node.type(node.props));
  return [node, ...elements(node.props?.children)];
}

function render(phrases, { showRomaji = false, adaptations = {}, leftLanguageSelection = "all", ttsStatus = {} } = {}) {
  const played = [];
  const tree = PhraseCard({ phrases, adaptations, activeLeftLanguage: "bg", targetLanguage: "en",
    editingSpeaker: null, leftLanguageSelection, speakerDrafts: {}, showEnhancedEnglish: false,
    showRomaji, ttsStatus, onEditSpeaker: () => {}, onSpeak: (...args) => played.push(args),
    languageMap: new Map([["bg", { name: "Bulgarian", flag: "🇧🇬" }], ["en", { name: "English", flag: "🇬🇧" }]]) });
  const buttons = elements(tree).filter(node => node.type === "button" && node.props.className?.includes("paragraphPlayButton"));
  return { tree, buttons, played };
}

const old = { id: "old", source_lang: "en", speaker: 1, speaker_label: "You", is_final: true,
  texts: { en: "Where is the station?", bg: "Къде е гарата?" } };
const click = button => button.props.onClick({ stopPropagation() {} });

test("one pair of controls plays every sentence in the paragraph in either language", () => {
  const h = render([old, { ...old, id: "next", texts: { en: "Is it nearby?", bg: "Наблизо ли е?" } }]);
  assert.equal(h.buttons.length, 2);
  assert.ok(h.buttons.every(button => !button.props.disabled));
  click(h.buttons[0]);
  click(h.buttons[1]);
  click(h.buttons[0]);
  assert.deepEqual(h.played, [
    ["tts:paragraph:old:en", "Where is the station? Is it nearby?", "en"],
    ["tts:paragraph:old:bg", "Къде е гарата? Наблизо ли е?", "bg"],
    ["tts:paragraph:old:en", "Where is the station? Is it nearby?", "en"]
  ]);
  assert.equal(elements(h.tree).filter(node => node.props.role === "button").length, 0);
});

test("unfinished text and a missing translation do not disable available paragraph speech", () => {
  const h = render([old, { ...old, id: "new", is_final: false, texts: { en: "New words" } }]);
  click(h.buttons[0]);
  click(h.buttons[1]);
  assert.deepEqual(h.played, [
    ["tts:paragraph:old:en", "Where is the station? New words", "en"],
    ["tts:paragraph:old:bg", "Къде е гарата?", "bg"]
  ]);
});

test("source-only history enables source playback and disables the unavailable translation", () => {
  const h = render([{ ...old, source_lang: "bg", texts: { bg: "Здравей" } }]);
  assert.equal(h.buttons.length, 2);
  assert.equal(h.buttons[0].props.disabled, false);
  assert.equal(h.buttons[1].props.disabled, true);
  click(h.buttons[0]);
  click(h.buttons[1]);
  assert.deepEqual(h.played, [["tts:paragraph:old:bg", "Здравей", "bg"]]);
});

test("Latin-only display still speaks the full Cyrillic paragraph", () => {
  const h = render([old, { ...old, id: "next", texts: { en: "Thanks!", bg: "Благодаря!" } }], { showRomaji: true });
  const translations = elements(h.tree).filter(node => node.props.className === "phraseText translation");
  assert.ok(translations.every(node => node.props.lang === "bg-Latn"));
  assert.ok(elements(h.tree).some(node => node.props.children === "Kade e garata?"));
  assert.equal(h.buttons[1].type, "button"); // Native Enter/Space activation.
  click(h.buttons[1]);
  assert.deepEqual(h.played, [["tts:paragraph:old:bg", "Къде е гарата? Благодаря!", "bg"]]);
});

test("a saved source retains its language even when the selection differs", () => {
  const h = render([{ ...old, source_lang: "fr", texts: { fr: "Bonjour", en: "Hello" } }], { leftLanguageSelection: "bg" });
  assert.equal(h.buttons[0].props["aria-label"], "Play paragraph in FR (source)");
  click(h.buttons[0]);
  assert.deepEqual(h.played, [["tts:paragraph:old:fr", "Bonjour", "fr"]]);
});

test("different paragraphs have independent payloads, including the same speaker returning later", () => {
  const first = render([old]);
  const reply = render([{ ...old, id: "reply", speaker: 2, source_lang: "bg", texts: { bg: "Там", en: "There" } }]);
  const later = render([{ ...old, id: "later", texts: { en: "Thank you", bg: "Благодаря" } }]);
  for (const h of [first, reply, later]) click(h.buttons[0]);
  assert.deepEqual([first.played, reply.played, later.played], [
    [["tts:paragraph:old:en", "Where is the station?", "en"]],
    [["tts:paragraph:reply:bg", "Там", "bg"]],
    [["tts:paragraph:later:en", "Thank you", "en"]]
  ]);
});

test("unknown voices cannot be renamed together as if they were one person", () => {
  const h = render([{ ...old, speaker: null, speaker_label: "Unknown" }]);
  const tag = elements(h.tree).find(node => node.props.className === "speakerTag");
  assert.equal(tag.props.disabled, true);
  assert.equal(tag.props["aria-label"], "Voice not identified");
  assert.ok(h.buttons.every(button => !button.props.disabled));
});

test("paragraph and autospeak activity animate the correct language control", () => {
  const h = render([old], { ttsStatus: { "tts:paragraph:old:bg": "playing", "tts:old:en": "loading" } });
  assert.ok(h.buttons[0].props["aria-busy"]);
  assert.equal(h.buttons[1].props["aria-label"], "Replay paragraph in 🇧🇬 Bulgarian (translation)");
  assert.equal(elements(h.tree).filter(node => node.props.className === "ttsWaveform").length, 1);
  click(h.buttons[1]);
  assert.deepEqual(h.played, [["tts:paragraph:old:bg", "Къде е гарата?", "bg"]]);
});
