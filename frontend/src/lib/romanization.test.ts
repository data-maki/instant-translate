import assert from "node:assert/strict";
import { test } from "node:test";
import { romanizeBulgarian } from "./romanization";
import { adaptationKey, buildPhraseDisplayPairs, supportsRomanization } from "./phrase-text";
import type { Phrase } from "./api";

test("Bulgarian alphabet, letter combinations, casing and punctuation", () => {
  assert.equal(romanizeBulgarian("а б в г д е ж з и й к л м н о п р с т у ф х ц ч ш щ ъ ь ю я"),
    "a b v g d e zh z i y k l m n o p r s t u f h ts ch sh sht a y yu ya");
  assert.equal(romanizeBulgarian("Здравей, как си?"), "Zdravey, kak si?");
  assert.equal(romanizeBulgarian("Щастие, джаз, дзън, синьо, Йордан."), "Shtastie, dzhaz, dzan, sinyo, Yordan.");
  assert.equal(romanizeBulgarian("Тя ѝ каза: ЗДРАВЕЙ!"), "Tya i kaza: ZDRAVEY!");
  assert.equal(romanizeBulgarian("София / Sofia @ 18:30 👋"), "Sofia / Sofia @ 18:30 👋");
  assert.equal(romanizeBulgarian("И\u0300 и и\u0306"), "I i y");
});

test("word-final ия and the established Bulgaria spelling", () => {
  assert.equal(romanizeBulgarian("София, България, Мария и Италия."), "Sofia, Bulgaria, Maria i Italia.");
  assert.equal(romanizeBulgarian("БЪЛГАРИЯ: станция, станцията"), "BULGARIA: stantsia, stantsiyata");
});

function pair(item: Phrase, showRomaji = false, adaptations = {}) {
  return buildPhraseDisplayPairs({ phrases: [item], adaptations, activeLeftLanguage: "bg",
    targetLanguage: "en", leftLanguage: "bg", isTargetSource: item.source_lang === "en",
    showEnhancedEnglish: false, showRomaji })[0]!;
}

const base: Phrase = { id: "old", speaker: 1, speaker_label: "You", source_lang: "bg", is_final: true,
  texts: { bg: "Къде е гарата?", en: "Where is the station?" } };

test("Bulgarian source and translated Bulgarian both get a Latin reading, including history", () => {
  assert.ok(supportsRomanization("bg"));
  assert.ok(supportsRomanization("ja"));
  assert.equal(supportsRomanization("en"), false);
  const spoken = pair(base);
  assert.equal(spoken.text, "Къде е гарата?");
  assert.equal(spoken.romaji, "Kade e garata?");
  assert.equal(spoken.translation, "Where is the station?");
  const translated = pair({ ...base, source_lang: "en" });
  assert.equal(translated.text, "Where is the station?");
  assert.equal(translated.translation, "Къде е гарата?");
  assert.equal(translated.translationRomaji, "Kade e garata?");
});

test("Latin-only display never changes the original-language playback payload", () => {
  const spoken = pair(base, true);
  assert.equal(spoken.text, "Kade e garata?");
  assert.equal(spoken.sourceSpeech?.text, "Къде е гарата?");
  assert.equal(spoken.sourceSpeech?.language, "bg");
  const translated = pair({ ...base, source_lang: "en" }, true);
  assert.equal(translated.translation, "Kade e garata?");
  assert.equal(translated.translationSpeech?.text, "Къде е гарата?");
  assert.equal(translated.translationSpeech?.language, "bg");
});

test("a saved fallback translation gets its reading without a backend romanization field", () => {
  const item = { ...base, source_lang: "en", texts: { en: "Where is the station?" } };
  const displayed = pair(item, false, { [adaptationKey(item, "bg")]: {
    source_rewrite: "", target_translation: "Къде е гарата?", status: "ready"
  } });
  assert.equal(displayed.translationRomaji, "Kade e garata?");
  assert.equal(displayed.translationSpeech?.text, "Къде е гарата?");
});
