import assert from "node:assert/strict";
import type { Phrase } from "./api";
import {
  adaptationKey,
  buildPhraseDisplayPairs,
  phraseSourceLanguage
} from "./phrase-text";

const SUPPORTED_LANGUAGE_CODES = [
  "ar",
  "bg",
  "bs",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fr",
  "gl",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "mk",
  "ml",
  "mr",
  "ms",
  "my",
  "nl",
  "no",
  "pa",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sr",
  "sv",
  "ta",
  "te",
  "th",
  "tl",
  "tr",
  "uk",
  "ur",
  "vi",
  "zh"
] as const;

type SupportedLanguageCode = typeof SUPPORTED_LANGUAGE_CODES[number];

const SOURCE_TEXT: Record<SupportedLanguageCode, string> = {
  ar: "أنا جائع",
  bg: "гладен съм",
  bs: "gladan sam",
  ca: "tinc gana",
  cs: "mám hlad",
  da: "jeg er sulten",
  de: "ich habe Hunger",
  el: "πεινάω",
  en: "I am hungry",
  es: "tengo hambre",
  et: "mul on kõht tühi",
  eu: "gose naiz",
  fa: "گرسنه‌ام",
  fi: "minulla on nälkä",
  fr: "j'ai faim",
  gl: "teño fame",
  gu: "મને ભૂખ લાગી છે",
  he: "אני רעב",
  hi: "मुझे भूख लगी है",
  hr: "gladan sam",
  hu: "éhes vagyok",
  id: "saya lapar",
  it: "ho fame",
  ja: "お腹がすいた",
  ko: "배고파요",
  lt: "aš alkanas",
  lv: "es esmu izsalcis",
  mk: "гладен сум",
  ml: "എനിക്ക് വിശക്കുന്നു",
  mr: "मला भूक लागली आहे",
  ms: "saya lapar",
  my: "ဗိုက်ဆာတယ်",
  nl: "ik heb honger",
  no: "jeg er sulten",
  pa: "ਮੈਨੂੰ ਭੁੱਖ ਲੱਗੀ ਹੈ",
  pl: "jestem głodny",
  pt: "estou com fome",
  ro: "mi-e foame",
  ru: "я голоден",
  sk: "som hladný",
  sl: "lačen sem",
  sr: "гладан сам",
  sv: "jag är hungrig",
  ta: "எனக்கு பசிக்கிறது",
  te: "నాకు ఆకలిగా ఉంది",
  th: "ฉันหิว",
  tl: "gutom ako",
  tr: "açım",
  uk: "я голодний",
  ur: "مجھے بھوک لگی ہے",
  vi: "tôi đói",
  zh: "我饿了"
};

const ENGLISH_TRANSLATION = "I am hungry";
const CATALAN_TRANSLATION = SOURCE_TEXT.ca;

function phrase({
  id,
  sourceLanguage,
  targetLanguage,
  sourceText = SOURCE_TEXT[sourceLanguage],
  targetText,
  sourceLang = sourceLanguage
}: {
  id: string;
  sourceLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  sourceText?: string;
  targetText: string;
  sourceLang?: SupportedLanguageCode | null;
}): Phrase {
  return {
    id,
    is_final: true,
    romaji_ja: sourceLanguage === "ja" ? "onaka ga suita" : null,
    source_lang: sourceLang,
    speaker: 1,
    speaker_label: "Speaker 1",
    texts: {
      [sourceLanguage]: sourceText,
      [targetLanguage]: targetText
    }
  };
}

function displayPair({
  item,
  activeLeftLanguage,
  leftLanguage,
  targetLanguage,
  showEnhancedEnglish = true,
  showRomaji = false
}: {
  item: Phrase;
  activeLeftLanguage: SupportedLanguageCode;
  leftLanguage: SupportedLanguageCode;
  targetLanguage: SupportedLanguageCode;
  showEnhancedEnglish?: boolean;
  showRomaji?: boolean;
}) {
  return buildPhraseDisplayPairs({
    activeLeftLanguage,
    adaptations: {},
    isTargetSource: phraseSourceLanguage(item, activeLeftLanguage) === targetLanguage,
    leftLanguage,
    phrases: [item],
    showEnhancedEnglish,
    showRomaji,
    targetLanguage
  })[0]!;
}

for (const code of SUPPORTED_LANGUAGE_CODES) {
  const targetLanguage = code === "en" ? "ca" : "en";
  const targetText = code === "en" ? CATALAN_TRANSLATION : ENGLISH_TRANSLATION;
  const item = phrase({
    id: `source-${code}`,
    sourceLanguage: code,
    targetLanguage,
    targetText
  });
  const pair = displayPair({
    item,
    activeLeftLanguage: code,
    leftLanguage: code,
    targetLanguage
  });

  assert.equal(pair.text, SOURCE_TEXT[code], `${code} source text should be primary`);
  assert.equal(pair.translation, targetText, `${code} translation should be secondary`);
}

for (const code of SUPPORTED_LANGUAGE_CODES) {
  const leftLanguage = code === "en" ? "ca" : "en";
  const targetText = code === "en" ? CATALAN_TRANSLATION : ENGLISH_TRANSLATION;
  const item = phrase({
    id: `target-side-${code}`,
    sourceLanguage: code,
    targetLanguage: leftLanguage,
    targetText
  });
  const pair = displayPair({
    item,
    activeLeftLanguage: leftLanguage,
    leftLanguage,
    targetLanguage: code
  });

  assert.equal(pair.text, SOURCE_TEXT[code], `${code} target-side source text should stay primary`);
  assert.equal(pair.translation, targetText, `${code} target-side translation should be secondary`);
}

{
  const item = phrase({
    id: "missing-source-en",
    sourceLanguage: "en",
    sourceLang: null,
    targetLanguage: "ca",
    targetText: CATALAN_TRANSLATION
  });
  const pair = displayPair({
    item,
    activeLeftLanguage: "en",
    leftLanguage: "en",
    targetLanguage: "ca"
  });

  assert.equal(pair.text, SOURCE_TEXT.en);
  assert.equal(pair.translation, CATALAN_TRANSLATION);
}

{
  const item = phrase({
    id: "missing-source-zh",
    sourceLanguage: "zh",
    sourceLang: null,
    targetLanguage: "en",
    targetText: ENGLISH_TRANSLATION
  });
  const pair = displayPair({
    item,
    activeLeftLanguage: "zh",
    leftLanguage: "zh",
    targetLanguage: "en"
  });

  assert.equal(pair.text, SOURCE_TEXT.zh);
  assert.equal(pair.translation, ENGLISH_TRANSLATION);
}

{
  const item = phrase({
    id: "stale-explicit-source",
    sourceLanguage: "ca",
    sourceLang: "zh",
    targetLanguage: "en",
    targetText: ENGLISH_TRANSLATION
  });
  delete item.texts.zh;
  const pair = displayPair({
    item,
    activeLeftLanguage: "ca",
    leftLanguage: "ca",
    targetLanguage: "en"
  });

  assert.equal(pair.text, CATALAN_TRANSLATION);
  assert.equal(pair.translation, ENGLISH_TRANSLATION);
}

{
  const item = phrase({
    id: "adapted-ca",
    sourceLanguage: "ca",
    targetLanguage: "en",
    targetText: ""
  });
  const key = adaptationKey(item, "en");
  const pair = buildPhraseDisplayPairs({
    activeLeftLanguage: "ca",
    adaptations: {
      [key]: {
        source_rewrite: "",
        target_translation: ENGLISH_TRANSLATION,
        status: "ready"
      }
    },
    isTargetSource: false,
    leftLanguage: "ca",
    phrases: [item],
    showEnhancedEnglish: true,
    showRomaji: false,
    targetLanguage: "en"
  })[0]!;

  assert.equal(pair.text, CATALAN_TRANSLATION);
  assert.equal(pair.translation, ENGLISH_TRANSLATION);
}

{
  const item = phrase({
    id: "ja-script-default",
    sourceLanguage: "ja",
    targetLanguage: "en",
    targetText: ENGLISH_TRANSLATION
  });
  const pair = displayPair({
    item,
    activeLeftLanguage: "ja",
    leftLanguage: "ja",
    targetLanguage: "en",
    showRomaji: false
  });

  assert.equal(pair.text, SOURCE_TEXT.ja);
  assert.equal(pair.romaji, "onaka ga suita");
  assert.equal(pair.translation, ENGLISH_TRANSLATION);
}
