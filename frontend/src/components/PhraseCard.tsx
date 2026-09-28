"use client";

import type { CSSProperties } from "react";
import type { Language, Phrase } from "@/lib/api";
import {
  adaptationKey,
  buildPhraseDisplayPairs,
  phraseSourceLanguage,
  supportsRomanization,
  type PhraseAdaptation,
  type PhrasePair,
  type PhraseSpeech
} from "@/lib/phrase-text";
import {
  fallbackSpeakerLabel,
  initialsFromSpeakerName,
  speakerColor,
  speakerKey
} from "@/lib/speaker";

export type { PhraseAdaptation };
export { supportsRomanization } from "@/lib/phrase-text";

type SpeakerDraft = {
  initials?: string;
  mergeInto: string;
  label: string;
};

type TtsPlaybackState = "loading" | "playing" | "error";
type LeftLanguageSelection = "all" | string;
type SpeakHandler = (key: string, text: string, language: string) => void;

export function PhraseCard({
  activeLeftLanguage,
  adaptations,
  editingSpeaker,
  leftLanguageSelection,
  languageMap,
  onEditSpeaker,
  onSpeak,
  phrases,
  speakerDrafts,
  showEnhancedEnglish,
  showRomaji,
  targetLanguage,
  ttsStatus
}: {
  activeLeftLanguage: string;
  adaptations: Record<string, PhraseAdaptation>;
  editingSpeaker: string | null;
  leftLanguageSelection: LeftLanguageSelection;
  languageMap: Map<string, Language>;
  onEditSpeaker: (speakerId: string, label: string) => void;
  onSpeak: SpeakHandler;
  phrases: Phrase[];
  speakerDrafts: Record<string, SpeakerDraft>;
  showEnhancedEnglish: boolean;
  showRomaji: boolean;
  targetLanguage: string;
  ttsStatus: Record<string, TtsPlaybackState>;
}) {
  const phrase = phrases[0]!;
  const color = speakerColor(speakerKey(phrase.speaker));
  const style = { "--speaker-color": color } as CSSProperties;
  const speakerId = speakerKey(phrase.speaker);
  const speakerLabel = speakerDrafts[speakerId]?.label.trim() || phrase.speaker_label || fallbackSpeakerLabel(speakerId);
  const speakerInitials = speakerDrafts[speakerId]?.initials?.trim() || initialsFromSpeakerName(speakerLabel, speakerId);
  const isEditingSpeaker = Boolean(speakerId && editingSpeaker === speakerId);
  const sourceLang = phraseSourceLanguage(phrase, activeLeftLanguage);
  const isTargetSource = sourceLang === targetLanguage;
  const leftLanguage = isTargetSource
    ? activeLeftLanguage
    : leftLanguageSelection === "all"
      ? sourceLang
      : activeLeftLanguage;

  const leftLabel = languageLabel(languageMap, leftLanguage);
  const targetLabel = languageLabel(languageMap, targetLanguage);
  const phrasePairs = buildPhraseDisplayPairs({
    phrases,
    adaptations,
    activeLeftLanguage,
    targetLanguage,
    leftLanguage,
    isTargetSource,
    showEnhancedEnglish,
    showRomaji
  });
  const hasEnhancedEnglish = phrases.some((item) => Boolean(adaptations[adaptationKey(item, activeLeftLanguage)]?.source_rewrite?.trim()));
  const loading = phrases.some((item) => adaptations[adaptationKey(item, activeLeftLanguage)]?.status === "loading");

  const bubbleCode = sourceLang;
  const bubbleLabel = languageLabel(languageMap, sourceLang);
  const translationCode = isTargetSource ? leftLanguage : targetLanguage;
  const translationLabel = isTargetSource ? leftLabel : targetLabel;

  return (
    <article className="phrase" style={style}>
      <BubbleWithSpeaker
        code={bubbleCode}
        editingSpeaker={isEditingSpeaker}
        enhanced={isTargetSource && showEnhancedEnglish && hasEnhancedEnglish}
        label={bubbleLabel}
        loading={loading}
        onEditSpeaker={onEditSpeaker}
        onSpeak={onSpeak}
        pairs={phrasePairs}
        speakerId={speakerId}
        speakerInitials={speakerInitials}
        speakerLabel={speakerLabel}
        translationCode={translationCode}
        translationLabel={translationLabel}
        ttsStatus={ttsStatus}
      />
    </article>
  );
}

function languageLabel(languageMap: Map<string, Language>, code: string): string {
  const language = languageMap.get(code);
  return language ? `${language.flag} ${language.name}` : code.toUpperCase();
}

function BubbleWithSpeaker({
  code,
  editingSpeaker,
  enhanced = false,
  label,
  loading = false,
  onEditSpeaker,
  onSpeak,
  pairs,
  speakerId,
  speakerInitials,
  speakerLabel,
  translationCode,
  translationLabel,
  ttsStatus
}: {
  code: string;
  editingSpeaker: boolean;
  enhanced?: boolean;
  label: string;
  loading?: boolean;
  onEditSpeaker: (speakerId: string, label: string) => void;
  onSpeak: SpeakHandler;
  pairs: PhrasePair[];
  speakerId: string;
  speakerInitials: string;
  speakerLabel: string;
  translationCode: string;
  translationLabel: string;
  ttsStatus: Record<string, TtsPlaybackState>;
}) {
  return (
    <div className={`bubbleWithSpeaker ${editingSpeaker ? "editingSpeaker" : ""}`}>
      <SpeakerTag initials={speakerInitials} onOpen={() => onEditSpeaker(speakerId, speakerLabel)} />
      <div className="speechBubbleHighlight">
        <SpeechBubble
          code={code}
          enhanced={enhanced}
          label={label}
          loading={loading}
          onSpeak={onSpeak}
          pairs={pairs}
          translationCode={translationCode}
          translationLabel={translationLabel}
          ttsStatus={ttsStatus}
        />
      </div>
    </div>
  );
}

function SpeakerTag({ initials, onOpen }: { initials: string; onOpen: () => void }) {
  return (
    <button aria-label={`Edit speaker ${initials}`} className="speakerTag" onClick={onOpen} title={`Edit speaker ${initials}`} type="button">
      <span className="speakerTagInitials">{initials}</span>
    </button>
  );
}

function SpeechBubble({
  code,
  enhanced = false,
  label,
  loading = false,
  onSpeak,
  pairs,
  translationCode,
  translationLabel,
  ttsStatus
}: {
  code: string;
  enhanced?: boolean;
  label: string;
  loading?: boolean;
  onSpeak: SpeakHandler;
  pairs: PhrasePair[];
  translationCode: string;
  translationLabel: string;
  ttsStatus: Record<string, TtsPlaybackState>;
}) {
  return (
    <div className={`speechBubble ${code === "ja" ? "japanese" : ""} ${enhanced ? "aiEnhanced" : ""}`} dir="auto" lang={code} title={label}>
      <div className="speechBubbleBody">
        {pairs.map((pair, index) => (
          <div className="phrasePairLine" key={pair.sourceSpeech?.key || index}>
            <SpeechText
              code={code} label={label} text={pair.text} reading={pair.romaji}
              speech={pair.sourceSpeech} onSpeak={onSpeak}
              state={pair.sourceSpeech ? ttsStatus[pair.sourceSpeech.key] : undefined}
            />
            {pair.translation ? (
              <SpeechText
                code={translationCode} label={translationLabel} text={pair.translation} reading={pair.translationRomaji}
                speech={pair.translationSpeech} onSpeak={onSpeak} translation
                state={pair.translationSpeech ? ttsStatus[pair.translationSpeech.key] : undefined}
              />
            ) : null}
          </div>
        ))}
      </div>
      {loading ? <span className="romaji">Translating...</span> : null}
    </div>
  );
}

function SpeechText({
  code,
  label,
  text,
  reading,
  speech,
  translation = false,
  onSpeak,
  state
}: {
  code: string;
  label: string;
  text: string;
  reading?: string;
  speech?: PhraseSpeech;
  translation?: boolean;
  onSpeak: SpeakHandler;
  state?: TtsPlaybackState;
}) {
  const action = state === "error" ? "Retry" : state === "playing" ? "Replay" : "Play";
  return (
    <button
      aria-label={`${action} ${label}: ${text}`}
      aria-busy={state === "loading"}
      className={`phraseTextButton ${translation ? "translation" : "original"} ${state || ""}`}
      disabled={!speech}
      dir="auto"
      lang={speech && text !== speech.text && supportsRomanization(code) ? `${code}-Latn` : code}
      onClick={(event) => {
        event.stopPropagation();
        if (speech) onSpeak(speech.key, speech.text, speech.language);
      }}
      title={`${action} ${label}`}
      type="button"
    >
      <span className="phraseTextContent">
        <span className={translation ? "bubbleTranslation" : "bubbleOriginal"}>{text || "..."}</span>
        {reading ? <span className="inlineRomaji" lang={`${code}-Latn`} title="Latin reading. Tap to hear the pronunciation.">{reading}</span> : null}
      </span>
      {speech ? <span aria-hidden="true" className={`ttsSpeakerButton ${state || ""}`}>
        {state === "loading" ? "..." : state === "playing" ? "🔊" : state === "error" ? "⚠︎" : "🔈"}
      </span> : null}
    </button>
  );
}
