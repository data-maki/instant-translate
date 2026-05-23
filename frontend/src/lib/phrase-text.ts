import type { Phrase } from "@/lib/api";

export const ENGLISH_LANGUAGE = "en";

export type PhraseAdaptation = {
  source_rewrite: string;
  target_translation?: string;
  status: "loading" | "ready" | "error";
};

export type PhrasePair = {
  text: string;
  romaji?: string;
  translation?: string;
  translationRomaji?: string;
};

export type TranscriptLatencyMode = "fast" | "slow";

export function joinDisplayLines(values: Array<string | undefined | null>): string {
  return values.map((value) => (value || "").trim()).filter(Boolean).join("\n");
}

export function firstNonEnglishTextLanguage(phrase: Phrase): string {
  return Object.keys(phrase.texts).find((code) => code !== ENGLISH_LANGUAGE) || "";
}

export function firstNonEnglishText(phrase: Phrase): string {
  const code = firstNonEnglishTextLanguage(phrase);
  return code ? phrase.texts[code] || "" : "";
}

export function adaptationKey(phrase: Phrase, targetLanguage = ""): string {
  const sourceLanguage = phrase.source_lang || firstNonEnglishTextLanguage(phrase);
  const source = sourceLanguage ? phrase.texts[sourceLanguage]?.trim() : "";
  if (!source) {
    return "";
  }
  return targetLanguage ? `${phrase.id}:${targetLanguage}:${source}` : `${phrase.id}:${source}`;
}

export function phraseLeftText(
  phrase: Phrase,
  leftLanguage: string,
  targetLanguage: string,
  adaptations: Record<string, PhraseAdaptation>
): string {
  const sourceLang = phrase.source_lang || firstNonEnglishTextLanguage(phrase) || leftLanguage;
  if (sourceLang === targetLanguage) {
    const adaptation = adaptations[adaptationKey(phrase, leftLanguage)];
    return adaptation?.target_translation || phrase.texts[leftLanguage] || firstNonEnglishText(phrase) || "";
  }
  if (sourceLang === leftLanguage) {
    return phrase.texts[sourceLang] || phrase.texts[leftLanguage] || "";
  }
  const adaptation = adaptations[adaptationKey(phrase, leftLanguage)];
  return adaptation?.target_translation || phrase.texts[leftLanguage] || "";
}

export function phraseTargetText(
  phrase: Phrase,
  targetLanguage: string,
  adaptations: Record<string, PhraseAdaptation>
): string {
  const sourceLang = phrase.source_lang || firstNonEnglishTextLanguage(phrase) || targetLanguage;
  if (sourceLang === targetLanguage) {
    return phrase.texts[targetLanguage] || "";
  }
  const adaptation = adaptations[adaptationKey(phrase, targetLanguage)];
  return phrase.texts[targetLanguage] || adaptation?.target_translation || "";
}

export function phraseShownTargetText(
  phrase: Phrase,
  targetLanguage: string,
  leftLanguage: string,
  adaptations: Record<string, PhraseAdaptation>,
  showEnhancedEnglish: boolean
): string {
  const sourceLang = phrase.source_lang || firstNonEnglishTextLanguage(phrase) || targetLanguage;
  if (sourceLang !== targetLanguage) {
    return phraseTargetText(phrase, targetLanguage, adaptations);
  }
  const adaptation = adaptations[adaptationKey(phrase, leftLanguage)];
  const original = phrase.texts[targetLanguage] || "";
  return showEnhancedEnglish && adaptation?.source_rewrite ? adaptation.source_rewrite : original;
}

function phraseRomanization(phrase: Phrase, langCode: string): string {
  if (langCode === "ja") return phrase.romaji_ja || "";
  return "";
}

export function buildPhraseDisplayPairs({
  phrases,
  adaptations,
  activeLeftLanguage,
  targetLanguage,
  leftLanguage,
  isTargetSource,
  showEnhancedEnglish,
  showRomaji
}: {
  phrases: Phrase[];
  adaptations: Record<string, PhraseAdaptation>;
  activeLeftLanguage: string;
  targetLanguage: string;
  leftLanguage: string;
  isTargetSource: boolean;
  showEnhancedEnglish: boolean;
  showRomaji: boolean;
}): PhrasePair[] {
  return phrases.map((item) => {
    const itemSourceLang = item.source_lang || firstNonEnglishTextLanguage(item) || activeLeftLanguage;
    const romaji = itemSourceLang === leftLanguage || isTargetSource ? phraseRomanization(item, leftLanguage) : "";

    if (isTargetSource) {
      const englishText = phraseShownTargetText(item, targetLanguage, leftLanguage, adaptations, showEnhancedEnglish);
      const otherLanguageText = phraseLeftText(item, leftLanguage, targetLanguage, adaptations);
      return {
        text: englishText,
        translation: showRomaji && romaji ? romaji : otherLanguageText,
        translationRomaji: showRomaji || !romaji ? undefined : romaji
      };
    }

    const originalText = phraseLeftText(item, leftLanguage, targetLanguage, adaptations);
    return {
      text: showRomaji && romaji ? romaji : originalText,
      romaji: showRomaji ? "" : romaji,
      translation: phraseTargetText(item, targetLanguage, adaptations)
    };
  });
}

export function phraseSpeakReady(
  phrase: Phrase,
  adaptations: Record<string, PhraseAdaptation>,
  speakLanguage: string,
  latencyMode: TranscriptLatencyMode
): boolean {
  if (!phrase.is_final) return false;
  if (!speakLanguage) return false;
  const sourceLang = phrase.source_lang || firstNonEnglishTextLanguage(phrase) || speakLanguage;
  if (sourceLang === speakLanguage) {
    return Boolean(phrase.texts[speakLanguage]?.trim());
  }
  const adaptation = adaptations[adaptationKey(phrase, speakLanguage)];
  if (!adaptation?.target_translation?.trim() && !phrase.texts[speakLanguage]?.trim()) {
    return false;
  }
  if (latencyMode === "slow") {
    if (sourceLang === "en") {
      if (adaptation?.status !== "ready" || !adaptation.source_rewrite?.trim()) {
        return false;
      }
    } else if (adaptation?.status !== "ready") {
      return false;
    }
  }
  return true;
}

export function supportsRomanization(langCode: string): boolean {
  return langCode === "ja";
}
