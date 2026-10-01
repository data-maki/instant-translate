"use client";

import type { CSSProperties } from "react";
import type { Language, Phrase } from "@/lib/api";
import { languageHue } from "@/lib/language-colors";
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
  const speakerLabel = speakerId ? speakerDrafts[speakerId]?.label.trim() || phrase.speaker_label || fallbackSpeakerLabel(speakerId) : "Unknown";
  const speakerInitials = speakerId ? speakerDrafts[speakerId]?.initials?.trim() || initialsFromSpeakerName(speakerLabel, speakerId) : "?";
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
      <SpeakerTag initials={speakerInitials} known={Boolean(speakerId)} onOpen={() => onEditSpeaker(speakerId, speakerLabel)} />
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

function SpeakerTag({ initials, known, onOpen }: { initials: string; known: boolean; onOpen: () => void }) {
  return (
    <button aria-label={known ? `Edit speaker ${initials}` : "Voice not identified"} className="speakerTag" disabled={!known} onClick={onOpen} title={known ? `Edit speaker ${initials}` : "Voice not identified"} type="button">
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
  const sourceParts = pairs.flatMap(pair => pair.sourceSpeech ? [pair.sourceSpeech] : []);
  const translationParts = pairs.flatMap(pair => pair.translationSpeech ? [pair.translationSpeech] : []);
  const sourceSpeech = paragraphSpeech(sourceParts);
  const translationSpeech = paragraphSpeech(translationParts);
  return (
    <div className={`speechBubble ${code === "ja" ? "japanese" : ""} ${enhanced ? "aiEnhanced" : ""}`} dir="auto" lang={code} title={label}>
      <div className="speechBubbleBody">
        <div className="paragraphPlayback" dir="ltr">
          <ParagraphPlayButton code={code} label={label} side="source" speech={sourceSpeech} onSpeak={onSpeak}
            state={paragraphPlaybackState(sourceSpeech, sourceParts, ttsStatus)} />
          <ParagraphPlayButton code={translationCode} label={translationLabel} side="translation" speech={translationSpeech} onSpeak={onSpeak}
            state={paragraphPlaybackState(translationSpeech, translationParts, ttsStatus)} />
        </div>
        {pairs.map((pair, index) => (
          <div className="phrasePairLine" key={pair.sourceSpeech?.key || index}>
            <SpeechText
              code={code} label={label} text={pair.text} reading={pair.romaji}
              speech={pair.sourceSpeech}
            />
            {pair.translation ? (
              <>
                <span aria-hidden="true" className="phraseTranslationSeparator"> · </span>
                <SpeechText
                  code={translationCode} label={translationLabel} text={pair.translation} reading={pair.translationRomaji}
                  speech={pair.translationSpeech} translation
                />
              </>
            ) : null}
          </div>
        ))}
      </div>
      {loading ? <span className="romaji">Translating...</span> : null}
    </div>
  );
}

function paragraphSpeech(parts: PhraseSpeech[]): PhraseSpeech | undefined {
  const first = parts[0];
  if (!first) return undefined;
  return { key: first.key.replace(/^tts:/, "tts:paragraph:"), language: first.language,
    text: parts.map(part => part.text.trim()).join(" ") };
}

function paragraphPlaybackState(speech: PhraseSpeech | undefined, parts: PhraseSpeech[], statuses: Record<string, TtsPlaybackState>) {
  if (speech && statuses[speech.key]) return statuses[speech.key];
  // Autospeak still advances sentence by sentence; show its activity on the
  // matching paragraph/language control without changing the manual payload.
  const states = parts.map(part => statuses[part.key]);
  return (["playing", "loading", "error"] as const).find(state => states.includes(state));
}

function languageStyle(code: string): CSSProperties {
  const hue = languageHue(code);
  return { "--language-color": hue === undefined
    ? "var(--muted)"
    : `hsl(${hue} var(--language-saturation) var(--language-lightness))`
  } as CSSProperties;
}

function ParagraphPlayButton({ code, label, side, speech, onSpeak, state }: {
  code: string;
  label: string;
  side: "source" | "translation";
  speech?: PhraseSpeech;
  onSpeak: SpeakHandler;
  state?: TtsPlaybackState;
}) {
  const action = state === "error" ? "Retry" : state === "playing" ? "Replay" : state === "loading" ? "Preparing" : "Play";
  const description = `${action} paragraph in ${label} (${side})`;
  return (
    <button aria-label={description} aria-busy={state === "loading"}
      className={`paragraphPlayButton ${side} ${state || ""}`} disabled={!speech}
      onClick={() => { if (speech) onSpeak(speech.key, speech.text, speech.language); }}
      style={languageStyle(code)} title={speech ? description : `${label} text is not available yet`} type="button">
      <span aria-hidden="true">{code.toUpperCase()}</span>
      <span aria-hidden="true"><SpeechPlaybackIcon state={state} /></span>
    </button>
  );
}

function SpeechText({
  code,
  label,
  text,
  reading,
  speech,
  translation = false
}: {
  code: string;
  label: string;
  text: string;
  reading?: string;
  speech?: PhraseSpeech;
  translation?: boolean;
}) {
  return (
    <span
      className={`phraseText ${translation ? "translation" : "original"}`}
      dir="auto"
      lang={speech && text !== speech.text && supportsRomanization(code) ? `${code}-Latn` : code}
      style={languageStyle(code)}
    >
      <span className="phraseLanguageLabel" title={label}>
        {code.toUpperCase()}
      </span>{"\u00a0"}
      <span className="phraseTextContent">
        <span className={translation ? "bubbleTranslation" : "bubbleOriginal"}>{text || "..."}</span>
        {reading ? <> <span className="inlineRomaji" lang={`${code}-Latn`} title="Latin reading">[{reading}]</span></> : null}
      </span>
    </span>
  );
}

function SpeechPlaybackIcon({ state }: { state?: TtsPlaybackState }) {
  return (
    <span className={`ttsSpeakerButton ${state || ""}`}>
      {state === "playing" ? (
        <span className="ttsWaveform">
          <span /><span /><span /><span />
        </span>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
          {state === "error" ? <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6m0 4h.01" />
          </> : <>
            <path d="M11 4 6 8H3v8h3l5 4V4Z" />
            <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
          </>}
        </svg>
      )}
    </span>
  );
}
