"use client";

import type { CSSProperties } from "react";
import type { Language, Phrase } from "@/lib/api";
import {
  adaptationKey,
  buildPhraseDisplayPairs,
  firstNonEnglishTextLanguage,
  joinDisplayLines,
  phraseSpeakReady,
  phraseTargetText,
  type PhraseAdaptation,
  type PhrasePair
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
type TranscriptLatencyMode = "fast" | "slow";
type LeftLanguageSelection = "all" | string;

export function PhraseCard({
  activeLeftLanguage,
  adaptations,
  editingSpeaker,
  latencyMode,
  leftLanguageSelection,
  languageMap,
  onEditSpeaker,
  onSpeak,
  phrases,
  speakLanguage,
  speakerDrafts,
  showEnhancedEnglish,
  showRomaji,
  targetLanguage,
  ttsStatus
}: {
  activeLeftLanguage: string;
  adaptations: Record<string, PhraseAdaptation>;
  editingSpeaker: string | null;
  latencyMode: TranscriptLatencyMode;
  leftLanguageSelection: LeftLanguageSelection;
  languageMap: Map<string, Language>;
  onEditSpeaker: (speakerId: string, label: string) => void;
  onSpeak: (key: string, text: string, language: string) => void;
  phrases: Phrase[];
  speakLanguage: string;
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
  const sourceLang = phrase.source_lang || firstNonEnglishTextLanguage(phrase) || activeLeftLanguage;
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

  const firstPhrase = phrases[0]!;
  const sourceSpeakText = isTargetSource
    ? joinDisplayLines(phrases.map((item) => phraseTargetText(item, speakLanguage, adaptations)))
    : joinDisplayLines(phrases.map((item) => item.texts[speakLanguage] || ""));
  const sourceSpeakKey = speakLanguage ? `tts:${firstPhrase.id}:${speakLanguage}` : "";
  const sourceSpeakable =
    Boolean(speakLanguage) &&
    sourceSpeakText.trim().length > 0 &&
    phrases.every((item) => phraseSpeakReady(item, adaptations, speakLanguage, latencyMode));
  const sourceOnSpeak = sourceSpeakable
    ? () => onSpeak(sourceSpeakKey, sourceSpeakText, speakLanguage)
    : undefined;
  const sourceTtsState = sourceSpeakable ? ttsStatus[sourceSpeakKey] : undefined;

  const bubbleCode = isTargetSource ? targetLanguage : leftLanguage;
  const bubbleLabel = isTargetSource ? targetLabel : leftLabel;
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
        onSpeak={sourceOnSpeak}
        pairs={phrasePairs}
        speakerId={speakerId}
        speakerInitials={speakerInitials}
        speakerLabel={speakerLabel}
        translationCode={translationCode}
        translationLabel={translationLabel}
        ttsState={sourceTtsState}
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
  ttsState
}: {
  code: string;
  editingSpeaker: boolean;
  enhanced?: boolean;
  label: string;
  loading?: boolean;
  onEditSpeaker: (speakerId: string, label: string) => void;
  onSpeak?: () => void;
  pairs: PhrasePair[];
  speakerId: string;
  speakerInitials: string;
  speakerLabel: string;
  translationCode: string;
  translationLabel: string;
  ttsState?: TtsPlaybackState;
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
          ttsState={ttsState}
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
  ttsState
}: {
  code: string;
  enhanced?: boolean;
  label: string;
  loading?: boolean;
  onSpeak?: () => void;
  pairs: PhrasePair[];
  translationCode: string;
  translationLabel: string;
  ttsState?: TtsPlaybackState;
}) {
  return (
    <div className={`speechBubble ${code === "ja" ? "japanese" : ""} ${enhanced ? "aiEnhanced" : ""}`} dir="auto" lang={code} title={label}>
      <div className="speechBubbleBody">
        {pairs.map((pair, index) => (
          <div className="phrasePairLine" key={index}>
            <span className="lineText">
              <span className="bubbleOriginal">{pair.text || "..."}</span>
              {pair.romaji ? <span className="inlineRomaji"> ({pair.romaji})</span> : null}
              {pair.translation ? (
                <>
                  {" "}
                  <span className="bubbleTranslation" dir="auto" lang={translationCode} title={translationLabel}>
                    {pair.translation}
                  </span>
                  {pair.translationRomaji ? <span className="inlineRomaji"> ({pair.translationRomaji})</span> : null}
                </>
              ) : null}
            </span>
          </div>
        ))}
        {onSpeak ? <TtsSpeakerButton onSpeak={onSpeak} state={ttsState} /> : null}
      </div>
      {loading ? <span className="romaji">Adapting...</span> : null}
    </div>
  );
}

function TtsSpeakerButton({
  disabled = false,
  onSpeak,
  state
}: {
  disabled?: boolean;
  onSpeak: () => void;
  state?: TtsPlaybackState;
}) {
  const label =
    state === "loading"
      ? "Loading speech"
      : state === "playing"
        ? "Playing"
        : state === "error"
          ? "Speech failed (tap to retry)"
          : "Play translation";
  return (
    <button
      aria-label={label}
      className={`ttsSpeakerButton ${state || ""}`}
      disabled={disabled || state === "loading"}
      onClick={(event) => {
        event.stopPropagation();
        onSpeak();
      }}
      title={label}
      type="button"
    >
      {state === "loading" ? "..." : state === "playing" ? "🔊" : state === "error" ? "⚠︎" : "🔈"}
    </button>
  );
}
