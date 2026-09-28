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

function elements(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node.type === "function") return elements(node.type(node.props));
  return [node, ...elements(node.props?.children)];
}

function render(phrases, { showRomaji = false, adaptations = {}, leftLanguageSelection = "all" } = {}) {
  const played = [];
  const tree = PhraseCard({ phrases, adaptations, activeLeftLanguage: "bg", targetLanguage: "en",
    editingSpeaker: null, leftLanguageSelection, speakerDrafts: {}, showEnhancedEnglish: false,
    showRomaji, ttsStatus: {}, onEditSpeaker: () => {}, onSpeak: (...args) => played.push(args),
    languageMap: new Map([["bg", { name: "Bulgarian", flag: "🇧🇬" }], ["en", { name: "English", flag: "🇬🇧" }]]) });
  const buttons = elements(tree).filter(node => node.props.role === "button" && node.props.className?.includes("phraseTextButton"));
  return { tree, buttons, played };
}

const old = { id: "old", source_lang: "en", speaker: 1, speaker_label: "You", is_final: true,
  texts: { en: "Where is the station?", bg: "Къде е гарата?" } };
const click = button => button.props.onClick({ stopPropagation() {} });

test("each old sentence can be replayed in either language even beside an unfinished turn", () => {
  const h = render([old, { ...old, id: "new", is_final: false, texts: { en: "New words" } }]);
  assert.equal(h.buttons.length, 3);
  assert.ok(h.buttons.every(button => !button.props["aria-disabled"]));
  click(h.buttons[0]);
  click(h.buttons[1]);
  click(h.buttons[0]);
  assert.deepEqual(h.played, [
    ["tts:old:en", "Where is the station?", "en"],
    ["tts:old:bg", "Къде е гарата?", "bg"],
    ["tts:old:en", "Where is the station?", "en"]
  ]);
});

test("a history box with only its source text still has a manual play action", () => {
  const h = render([{ ...old, source_lang: "bg", texts: { bg: "Здравей" } }]);
  assert.equal(h.buttons.length, 1);
  click(h.buttons[0]);
  assert.deepEqual(h.played, [["tts:old:bg", "Здравей", "bg"]]);
});

test("the Latin text is clickable but playback still receives Cyrillic", () => {
  const h = render([old], { showRomaji: true });
  assert.ok(h.buttons[1].props["aria-label"].includes("Kade e garata?"));
  assert.equal(h.buttons[1].props.lang, "bg-Latn");
  assert.equal(h.buttons[1].props.tabIndex, 0);
  click(h.buttons[1]);
  for (const key of ["Enter", " "]) {
    let prevented = false;
    h.buttons[1].props.onKeyDown({ key, preventDefault() { prevented = true; }, stopPropagation() {} });
    assert.ok(prevented); // Space plays the phrase rather than scrolling the page.
  }
  assert.deepEqual(h.played, Array(3).fill(["tts:old:bg", "Къде е гарата?", "bg"]));
});

test("a saved source language keeps its label and playback language when the selection differs", () => {
  const h = render([{ ...old, source_lang: "fr", texts: { fr: "Bonjour", en: "Hello" } }], { leftLanguageSelection: "bg" });
  assert.equal(h.buttons[0].props.lang, "fr");
  assert.equal(h.buttons[0].props["aria-label"], "Play FR: Bonjour");
  click(h.buttons[0]);
  assert.deepEqual(h.played, [["tts:old:fr", "Bonjour", "fr"]]);
});
