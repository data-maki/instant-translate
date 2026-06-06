"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  adaptPhrase,
  createRealtimeTranslationSession,
  deleteSession as deleteSavedSession,
  fetchPlacesContext,
  fetchSessionDetail,
  fetchSessions,
  generateTts,
  Language,
  Phrase,
  rediarizeSession,
  renameSession as renameSavedSession,
  retranslateSession,
  saveSessionAdaptation,
  SessionDetail,
  SessionSummary,
  translatePhrase,
  TranscriptEvent,
  websocketUrl
} from "@/lib/api";
import type { PcmAudioPlayer, RecorderHandle } from "@/lib/audio";
import {
  getServerProfileSnapshot,
  loadTravelerProfile,
  profileKatakanaFullDisplay,
  profileWesternFullName,
  subscribeTravelerProfile,
  TravelerProfile
} from "@/lib/profile";
import { PhraseCard, supportsRomanization, type PhraseAdaptation } from "@/components/PhraseCard";
import { ProfileMenu } from "@/components/ProfileMenu";
import {
  adaptationKey,
  ENGLISH_LANGUAGE,
  firstNonEnglishTextLanguage,
  phraseSpeakReady,
  phraseTargetText
} from "@/lib/phrase-text";
import {
  fallbackSpeakerLabel,
  initialsFromSpeakerName,
  normalizeInitials,
  speakerEditableName,
  speakerKey
} from "@/lib/speaker";
import { playTtsThroughAec, type TtsPlayback } from "@/lib/tts-playback";

type AppStatus =
  | "idle"
  | "checking"
  | "requesting microphone"
  | "connecting"
  | "listening"
  | "stopping"
  | "stopped"
  | "error";

const DEFAULT_AUDIENCE_PRESET = "polite-stranger";
const REGISTER_BLOCK_START = "[Japanese register preset]";
const REGISTER_BLOCK_END = "[/Japanese register preset]";

type HiddenRegister =
  | "casual_intimate"
  | "polite_neutral"
  | "polite_neutral_soft"
  | "polite_professional"
  | "public_institution_polite";

type SessionIntent = "restaurant" | "train" | "family" | "shopping" | "doctor" | "custom";
type DeepLFormality = "auto" | "more" | "less" | "default";
type TranscriptLatencyMode = "fast" | "slow";
type LeftLanguageSelection = "all" | string;

const AUDIENCE_PRESETS: {
  id: string;
  label: string;
  intent: SessionIntent;
  deeplFormality: Exclude<DeepLFormality, "auto">;
  tone: string;
  register: HiddenRegister;
  behavior: string;
}[] = [
  {
    id: "service-staff",
    label: "staff",
    intent: "shopping",
    deeplFormality: "more",
    tone: "Polite customer speech",
    register: "polite_neutral",
    behavior:
      "Speak as a customer or traveler talking to staff. Use clear, polite requests; keep it practical for shops, restaurants, hotels, stations, taxis, and travel counters."
  },
  {
    id: "polite-stranger",
    label: "strangers",
    intent: "custom",
    deeplFormality: "more",
    tone: "Soft polite speech",
    register: "polite_neutral_soft",
    behavior:
      "Use safe spoken politeness with extra softness. Prefer gentle attention-getters, indirect requests, and non-command phrasing. Avoid blunt directness and imperatives."
  },
  {
    id: "close-people",
    label: "friends",
    intent: "family",
    deeplFormality: "less",
    tone: "Warm casual speech",
    register: "casual_intimate",
    behavior:
      "Use warm natural speech for close people. Casual wording is normal, but keep it kind and not blunt. Add polite softness only when the note or relationship implies distance."
  },
  {
    id: "work-school",
    label: "work",
    intent: "custom",
    deeplFormality: "more",
    tone: "Professional spoken speech",
    register: "polite_professional",
    behavior:
      "Use professional spoken wording, not stiff written-form language. Prefer concise requests, clear confirmation phrasing, and work or classroom vocabulary."
  },
  {
    id: "official-care",
    label: "official",
    intent: "doctor",
    deeplFormality: "more",
    tone: "Precise polite speech",
    register: "public_institution_polite",
    behavior:
      "Use polite, precise, complete phrases. Avoid casual vagueness. Good for hospitals, pharmacies, immigration, police, banks, city offices, and formal counters."
  }
];

const SPEAKER_COUNT_OPTIONS = ["2", "3", "4", "5", "6"];
const NOTE_EXAMPLES = [
  "Reservation is under Ana",
  "I need an elevator",
  "I want to avoid meat broth",
  "I am trying to politely say no"
];

type SessionPlaceContext = {
  location_hint: string;
  location_context: string;
  poi_type: string;
  places: string;
  terms: string;
  translation_preferences: string;
};

type ContextGeneralEntry = {
  key: string;
  value: string;
};

type ContextTranslationTerm = {
  source: string;
  target: string;
};

type SonioxStructuredContext = {
  general?: ContextGeneralEntry[];
  terms?: string[];
  text?: string;
  translation_terms?: ContextTranslationTerm[];
};

type ContextBundle = {
  soniox: SonioxStructuredContext;
  rewriteTone: Record<string, unknown>;
};

type ProviderSignals = {
  transcripts: string[];
  translations: string[];
};

type RealtimeDirection = "english_to_target" | "target_to_english";

type RealtimeWebRTCSession = {
  audio: HTMLAudioElement;
  pc: RTCPeerConnection;
  setMicEnabled: (enabled: boolean) => void;
  stop: () => void;
  stream: MediaStream;
};

type RealtimeCaptionDraft = {
  id: string;
  input: string;
  output: string;
  sourceLanguage: string;
  targetLanguage: string;
  startedAt: number;
};

const DEEPL_FORMALITY_STORAGE_KEY = "mil-decoder-deepl-formality-v1";
const TTS_MODE_STORAGE_KEY = "mil-decoder-tts-mode-v1";
const SIDEBAR_COLLAPSED_KEY = "cottonoha-sidebar-collapsed-v1";

type TtsMode = "push" | "auto";
type TtsPlaybackState = "loading" | "playing" | "error";
const DISPLAY_GROUP_PAUSE_SECONDS = 10;
const AUTO_IMPROVE_DELAY_MS = 2 * 60 * 1000;
const INITIAL_SESSION_LIMIT = 24;
const SESSION_PAGE_SIZE = 24;
const DEFAULT_SESSION_PLACE_CONTEXT: SessionPlaceContext = {
  location_hint: "",
  location_context: "",
  poi_type: "",
  places: "",
  terms: "",
  translation_preferences: ""
};
const GENERIC_TERMS = new Set(["restaurant", "train", "food", "today", "tomorrow", "hotel", "shop", "station"]);

type SpeakerDraft = {
  initials?: string;
  mergeInto: string;
  label: string;
};

type SpeakerEditorDraft = {
  fullName: string;
  initials: string;
  speakerId: string;
};

type SessionGroup = {
  label: string;
  sessions: SessionSummary[];
  collapsedByDefault?: boolean;
};

export type TranslatorAppProps = {
  initialLanguages?: Language[];
  initialLoadError?: string;
  initialSessionTotal?: number;
  initialSessions?: SessionSummary[];
  initialSourceLanguages?: string[];
  initialTargetLanguage?: string;
  userId?: string;
  userName?: string;
};

export function TranslatorApp({
  initialLanguages = [],
  initialLoadError = "",
  initialSessionTotal,
  initialSessions = [],
  initialSourceLanguages = ["ja"],
  initialTargetLanguage = "en",
  userId,
  userName = ""
}: TranslatorAppProps) {
  const [languages] = useState<Language[]>(initialLanguages);
  const [sourceALanguages, setSourceALanguages] = useState(() =>
    normalizeSourceLanguagesForTarget(initialSourceLanguages, initialTargetLanguage)
  );
  const [sourceB, setSourceB] = useState(initialTargetLanguage);
  const [expectedSpeakerCount, setExpectedSpeakerCount] = useState("2");
  const [audiencePreset, setAudiencePreset] = useState(DEFAULT_AUDIENCE_PRESET);
  const [deeplFormality, setDeepLFormality] = useState<DeepLFormality>(() => {
    if (typeof window === "undefined") return "auto";
    try {
      const saved = window.localStorage.getItem(DEEPL_FORMALITY_STORAGE_KEY);
      if (isDeepLFormality(saved)) return saved;
    } catch {
      // localStorage unavailable
    }
    return "auto";
  });
  const [context, setContext] = useState("");
  const travelerProfile = useSyncExternalStore(
    subscribeTravelerProfile,
    loadTravelerProfile,
    getServerProfileSnapshot
  );
  const [sessionPlaceContext, setSessionPlaceContext] = useState<SessionPlaceContext>(DEFAULT_SESSION_PLACE_CONTEXT);
  const selectedPreset = getAudiencePreset(audiencePreset);
  const sessionIntent = selectedPreset.intent;
  const contextBundle = useMemo(
    () => buildContextBundle(
      context,
      audiencePreset,
      deeplFormality,
      travelerProfile,
      sessionPlaceContext,
      [...sourceALanguages, sourceB]
    ),
    [context, audiencePreset, deeplFormality, travelerProfile, sessionPlaceContext, sourceALanguages, sourceB]
  );
  const [status, setStatus] = useState<AppStatus>(initialLoadError ? "error" : "idle");
  const [error, setError] = useState(initialLoadError);
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [adaptations, setAdaptations] = useState<Record<string, PhraseAdaptation>>({});
  const [tokenCount, setTokenCount] = useState(0);
  const [savedPath, setSavedPath] = useState("");
  const [activeSession, setActiveSession] = useState("");
  const [activeSessionTitle, setActiveSessionTitle] = useState("");
  const [activeDurationSeconds, setActiveDurationSeconds] = useState<number | null>(null);
  const [rediarizeStatus, setRediarizeStatus] = useState("");
  const [rediarizing, setRediarizing] = useState(false);
  const [translationStatus, setTranslationStatus] = useState("");
  const [translating, setTranslating] = useState(false);
  const [improvingAll, setImprovingAll] = useState(false);
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, SpeakerDraft>>({});
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerEditorDraft, setSpeakerEditorDraft] = useState<SpeakerEditorDraft | null>(null);
  const [showEnhancedEnglish, setShowEnhancedEnglish] = useState(true);
  const [showRomaji, setShowRomaji] = useState(false);
  const [openAIRealtimeEnabled, setOpenAIRealtimeEnabled] = useState(false);
  const [transcriptLatencyMode, setTranscriptLatencyMode] = useState<TranscriptLatencyMode>("fast");
  const [leftLanguageSelection, setLeftLanguageSelection] = useState<LeftLanguageSelection>("all");
  const [typedText, setTypedText] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>(initialSessions);
  const [sessionTotal, setSessionTotal] = useState(initialSessionTotal ?? initialSessions.length);
  const [loadingMoreSessions, setLoadingMoreSessions] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useDrawerState();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"; } catch { return false; }
  });
  const [loadingSession, setLoadingSession] = useState("");
  const [micCaptureEnabled, setMicCaptureEnabled] = useState(true);
  const [englishToTargetOverdubEnabled, setEnglishToTargetOverdubEnabled] = useState(true);
  const [targetToEnglishOverdubEnabled, setTargetToEnglishOverdubEnabled] = useState(true);
  const [ttsMode, setTtsMode] = useState<TtsMode>(() => {
    if (typeof window === "undefined") return "push";
    try {
      const saved = window.localStorage.getItem(TTS_MODE_STORAGE_KEY);
      if (saved === "push" || saved === "auto") return saved;
    } catch {
      // localStorage unavailable
    }
    return "push";
  });
  const [ttsStatus, setTtsStatus] = useState<Record<string, TtsPlaybackState>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const audioPlayerRef = useRef<PcmAudioPlayer | null>(null);
  const ttsAudioRef = useRef<TtsPlayback | null>(null);
  const ttsSpokenKeysRef = useRef<Set<string>>(new Set());
  const ttsModeRef = useRef<TtsMode>("push");
  const ttsLatencyRef = useRef<TranscriptLatencyMode>("fast");
  const realtimeSessionsRef = useRef<Record<RealtimeDirection, RealtimeWebRTCSession | null>>({
    english_to_target: null,
    target_to_english: null
  });
  const realtimeCaptionDraftsRef = useRef<Record<RealtimeDirection, RealtimeCaptionDraft | null>>({
    english_to_target: null,
    target_to_english: null
  });
  const realtimePhraseSequenceRef = useRef(0);
  const realtimeTranscriptBridgeActiveRef = useRef(false);
  const sonioxRealtimePhraseCountRef = useRef(0);
  const micCaptureEnabledRef = useRef(true);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowFeedRef = useRef(true);
  const adaptationRequestsRef = useRef<Set<string>>(new Set());
  const adaptationsRef = useRef<Record<string, PhraseAdaptation>>({});
  const activeSessionRef = useRef("");
  const sessionDetailCacheRef = useRef<Record<string, SessionDetail>>({});
  const providerSignalsRef = useRef<ProviderSignals>({ transcripts: [], translations: [] });
  const durationTimerRef = useRef<number | null>(null);
  const stopFallbackTimerRef = useRef<number | null>(null);
  const autoImproveTimerRef = useRef<number | null>(null);

  ttsModeRef.current = ttsMode;
  ttsLatencyRef.current = transcriptLatencyMode;

  const ttsSpeakLanguage = englishOverdubTargetLanguage(sourceALanguages, sourceB);

  const sourceA = sourceALanguages[0] || (sourceB === "en" ? "ja" : "en");
  const canStart = status === "idle" || status === "stopped" || status === "error";
  const isLive = status === "requesting microphone" || status === "connecting" || status === "listening";
  const postProcessing = rediarizing || translating || improvingAll;
  const hasLanguagePair = sourceALanguages.length > 0 && !sourceALanguages.includes(sourceB);
  const showOnboarding = !isLive && phrases.length === 0 && !activeSession;

  const languageMap = useMemo(() => {
    return new Map(languages.map((language) => [language.code, language]));
  }, [languages]);

  const orderedLanguages = useMemo(() => {
    const core = languages.filter((language) => language.priority === "core");
    const rest = languages.filter((language) => language.priority !== "core");
    return [...core, ...rest];
  }, [languages]);
  const leftLanguageOptions = useMemo(() => {
    return collectLeftLanguageOptions(sourceALanguages, phrases, sourceB, languageMap);
  }, [languageMap, phrases, sourceALanguages, sourceB]);
  const activeLeftLanguage = useMemo(() => {
    return resolveLeftLanguageSelection(leftLanguageSelection, leftLanguageOptions, sourceALanguages, sourceB);
  }, [leftLanguageOptions, leftLanguageSelection, sourceALanguages, sourceB]);

  const transcriptStats = useMemo(() => {
    const durationSeconds = activeDurationSeconds ?? durationFromPhrases(phrases);
    return {
      durationSeconds,
      words: countPhraseWords(phrases),
      tokens: tokenCount
    };
  }, [activeDurationSeconds, phrases, tokenCount]);
  const hasFinishedSession = Boolean(activeSession && savedPath && !isLive);
  const sessionGroups = useMemo(() => groupSessions(sessions), [sessions]);
  const visiblePhrases = useMemo(() => {
    if (transcriptLatencyMode === "fast") {
      return phrases;
    }
    return phrases.filter((phrase) =>
      phraseReadyForSlowMode(phrase, adaptations, activeLeftLanguage, leftLanguageSelection, sourceB)
    );
  }, [activeLeftLanguage, adaptations, leftLanguageSelection, phrases, sourceB, transcriptLatencyMode]);
  const visiblePhraseGroups = useMemo(() => {
    return groupDisplayPhrases(visiblePhrases);
  }, [visiblePhrases]);

  function setAdaptationsSynced(
    next:
      | Record<string, PhraseAdaptation>
      | ((current: Record<string, PhraseAdaptation>) => Record<string, PhraseAdaptation>)
  ) {
    setAdaptations((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      adaptationsRef.current = resolved;
      return resolved;
    });
  }

  function setActiveSessionSynced(next: string) {
    activeSessionRef.current = next;
    setActiveSession(next);
  }

  function persistAdaptation(key: string, adaptation: PhraseAdaptation) {
    const sessionName = activeSessionRef.current;
    if (!sessionName || !key || adaptation.status !== "ready") {
      return;
    }
    void saveSessionAdaptation({ sessionName, key, adaptation, userId }).catch(() => {
      // Persistence failure should not block live conversation rendering.
    });
  }

  function setProviderSignalsSynced(next: ProviderSignals | ((current: ProviderSignals) => ProviderSignals)) {
    const current = providerSignalsRef.current;
    providerSignalsRef.current = typeof next === "function" ? next(current) : next;
  }

  function clearProviderSignals() {
    setProviderSignalsSynced({ transcripts: [], translations: [] });
  }

  function clearRealtimeCaptionDrafts() {
    realtimeCaptionDraftsRef.current = {
      english_to_target: null,
      target_to_english: null
    };
  }

  function resetAdaptations() {
    setAdaptationsSynced({});
    adaptationRequestsRef.current.clear();
  }

  function scrollFeedToBottomSoon() {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      const feed = feedRef.current;
      if (!feed || !shouldFollowFeedRef.current) {
        return;
      }
      feed.scrollTo({
        top: feed.scrollHeight,
        behavior: "smooth"
      });
    });
  }

  function setPhrasesAndFollow(next: Phrase[], options: { requestAdaptations?: boolean } = {}) {
    setPhrases(next);
    scrollFeedToBottomSoon();
    if (options.requestAdaptations !== false) {
      requestAdaptationsFor(next);
    }
    maybeAutoSpeakPhrases(next, adaptationsRef.current);
  }

  function upsertRealtimePhrase(phrase: Phrase) {
    setPhrases((current) => {
      const existingIndex = current.findIndex((item) => item.id === phrase.id);
      const next = existingIndex === -1
        ? [...current, phrase]
        : current.map((item) => (item.id === phrase.id ? phrase : item));
      setTokenCount(next.length);
      return next;
    });
    scrollFeedToBottomSoon();
  }

  function realtimeLanguagesForDirection(direction: RealtimeDirection) {
    const targetLanguage = englishOverdubTargetLanguage(sourceALanguages, sourceB);
    return direction === "english_to_target"
      ? { sourceLanguage: ENGLISH_LANGUAGE, targetLanguage }
      : { sourceLanguage: targetLanguage, targetLanguage: ENGLISH_LANGUAGE };
  }

  function ensureRealtimeCaptionDraft(direction: RealtimeDirection) {
    const existing = realtimeCaptionDraftsRef.current[direction];
    if (existing) {
      return existing;
    }
    const languages = realtimeLanguagesForDirection(direction);
    const draft: RealtimeCaptionDraft = {
      id: `realtime-${direction}-${Date.now()}-${realtimePhraseSequenceRef.current}`,
      input: "",
      output: "",
      sourceLanguage: languages.sourceLanguage,
      targetLanguage: languages.targetLanguage,
      startedAt: Date.now()
    };
    realtimePhraseSequenceRef.current += 1;
    realtimeCaptionDraftsRef.current[direction] = draft;
    return draft;
  }

  function realtimeDraftToPhrase(draft: RealtimeCaptionDraft, isFinal: boolean): Phrase {
    return {
      id: draft.id,
      speaker: draft.sourceLanguage === ENGLISH_LANGUAGE ? "typed" : "realtime-listener",
      speaker_label: draft.sourceLanguage === ENGLISH_LANGUAGE ? "You" : "Them",
      source_lang: draft.sourceLanguage,
      texts: {
        [draft.sourceLanguage]: draft.input.trim(),
        [draft.targetLanguage]: draft.output.trim()
      },
      is_final: isFinal,
      time: Math.max(0, Math.round((Date.now() - draft.startedAt) / 1000))
    };
  }

  function appendRealtimeCaptionDelta(
    direction: RealtimeDirection,
    field: "input" | "output",
    delta: string,
    render: boolean
  ) {
    const draft = ensureRealtimeCaptionDraft(direction);
    draft[field] += delta;
    if (render) {
      upsertRealtimePhrase(realtimeDraftToPhrase(draft, false));
    }
  }

  function finalizeRealtimeCaption(direction: RealtimeDirection) {
    const draft = realtimeCaptionDraftsRef.current[direction];
    if (!draft) {
      return;
    }
    if (draft.input.trim() || draft.output.trim()) {
      upsertRealtimePhrase(realtimeDraftToPhrase(draft, true));
    }
    realtimeCaptionDraftsRef.current[direction] = null;
  }

  function startDurationTimer(startedAt: number) {
    stopDurationTimer();
    durationTimerRef.current = window.setInterval(() => {
      setActiveDurationSeconds(Math.max(1, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);
  }

  function stopDurationTimer() {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }

  function changeDeepLFormality(value: DeepLFormality) {
    setDeepLFormality(value);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEEPL_FORMALITY_STORAGE_KEY, value);
    }
  }

  function changeTtsMode(mode: TtsMode) {
    setTtsMode(mode);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(TTS_MODE_STORAGE_KEY, mode);
      } catch {
        // localStorage unavailable
      }
    }
  }

  function setTtsStatusFor(key: string, value: TtsPlaybackState | null) {
    if (!key) return;
    setTtsStatus((current) => {
      if (value === null) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      if (current[key] === value) return current;
      return { ...current, [key]: value };
    });
  }

  async function speakPhraseText(key: string, text: string, languageCode: string) {
    const cleanText = (text || "").replace(/\s+/g, " ").trim();
    if (!cleanText) return;
    const language = (languageCode || "").trim().toLowerCase() || ttsSpeakLanguage;
    setTtsStatusFor(key, "loading");
    try {
      const previous = ttsAudioRef.current;
      if (previous) previous.stop();
      const profileVoice = travelerProfile.tts_voice_id?.trim();
      // Profile voice is curated for Japanese; use it only when speaking Japanese.
      const requestVoice = language === "ja" && profileVoice ? profileVoice : undefined;
      const result = await generateTts({
        text: cleanText,
        target_language: language,
        voice_id: requestVoice
      }, userId);
      // Route through a local WebRTC loopback so the browser's AEC (already
      // engaged on the mic stream via echoCancellation: true) subtracts the
      // TTS audio from the captured mic signal. See lib/tts-playback.ts.
      const playback = await playTtsThroughAec(
        `data:${result.mime_type};base64,${result.audio_base64}`
      );
      ttsAudioRef.current = playback;
      setTtsStatusFor(key, "playing");
      playback.done.then(() => {
        if (ttsAudioRef.current === playback) {
          ttsAudioRef.current = null;
        }
        setTtsStatusFor(key, null);
      });
    } catch {
      setTtsStatusFor(key, "error");
    }
  }

  function ttsKeyForPhrase(phrase: Phrase, language: string): string {
    return `tts:${phrase.id}:${language}`;
  }

  function maybeAutoSpeakPhrases(
    phrasesToCheck: Phrase[],
    adaptationsSnapshot: Record<string, PhraseAdaptation>
  ) {
    if (ttsModeRef.current !== "auto") return;
    const language = ttsSpeakLanguage;
    if (!language) return;
    const latency = ttsLatencyRef.current;
    for (const phrase of phrasesToCheck) {
      if (!phraseSpeakReady(phrase, adaptationsSnapshot, language, latency)) continue;
      const text = phraseTargetText(phrase, language, adaptationsSnapshot);
      if (!text.trim()) continue;
      const key = ttsKeyForPhrase(phrase, language);
      if (ttsSpokenKeysRef.current.has(key)) continue;
      ttsSpokenKeysRef.current.add(key);
      void speakPhraseText(key, text, language);
    }
  }

  function requestAdaptationsFor(phrasesToInspect: Phrase[], targetLanguage = activeLeftLanguage) {
    const phrasesForRewrite = phrasesToInspect;

    for (const phrase of phrasesForRewrite) {
      const sourceLang = phrase.source_lang || firstNonEnglishTextLanguage(phrase);
      const sourceText = sourceLang ? phrase.texts[sourceLang]?.trim() : "";
      if (!sourceLang || !sourceText || !phrase.is_final) {
        continue;
      }
      const neededTargets = dedupeList([sourceB, targetLanguage]).filter((target) => target && target !== sourceLang);
      for (const target of neededTargets) {
        if (sourceLang === ENGLISH_LANGUAGE && target === targetLanguage && target !== ENGLISH_LANGUAGE) {
          continue;
        }
        if (phrase.texts[target]?.trim()) {
          continue;
        }
        const translationKey = adaptationKey(phrase, target);
        if (!translationKey || adaptationsRef.current[translationKey] || adaptationRequestsRef.current.has(translationKey)) {
          continue;
        }
        adaptationRequestsRef.current.add(translationKey);
        setAdaptationsSynced((current) => ({
          ...current,
          [translationKey]: {
            source_rewrite: "",
            target_translation: current[translationKey]?.target_translation || "",
            status: "loading"
          }
        }));
        translatePhrase({
          source_language: sourceLang,
          target_language: target,
          source_text: sourceText,
          draft_translation: "",
          rewrite_context: {
            tone: contextBundle.rewriteTone,
            recent_dialogue: recentDialogueForRewrite(phrasesForRewrite, adaptationsRef.current, translationKey, target)
          }
        }, userId)
          .then((result) => {
            const nextAdaptation = {
              source_rewrite: adaptationsRef.current[translationKey]?.source_rewrite || "",
              target_translation: result.target_translation,
              status: "ready" as const
            };
            persistAdaptation(translationKey, nextAdaptation);
            setAdaptationsSynced((current) => ({
              ...current,
              [translationKey]: nextAdaptation
            }));
            maybeAutoSpeakPhrases([phrase], adaptationsRef.current);
          })
          .catch(() => {
            setAdaptationsSynced((current) => ({
              ...current,
              [translationKey]: {
                source_rewrite: current[translationKey]?.source_rewrite || "",
                target_translation: current[translationKey]?.target_translation || "",
                status: "error"
              }
            }));
          });
      }

      const key = adaptationKey(phrase, targetLanguage);
      if (
        !key ||
        adaptationsRef.current[key] ||
        adaptationRequestsRef.current.has(key) ||
        sourceLang !== ENGLISH_LANGUAGE ||
        targetLanguage === ENGLISH_LANGUAGE ||
        !phrase.is_final
      ) {
        continue;
      }
      const draftTranslation = phrase.texts[targetLanguage]?.trim();
      if (!sourceText) {
        continue;
      }
      adaptationRequestsRef.current.add(key);
      const baseRewriteContext = {
        tone: contextBundle.rewriteTone,
        recent_dialogue: recentDialogueForRewrite(phrasesForRewrite, adaptationsRef.current, key, targetLanguage)
      };
      translatePhrase({
        source_language: ENGLISH_LANGUAGE,
        target_language: targetLanguage,
        source_text: sourceText,
        draft_translation: draftTranslation,
        rewrite_context: baseRewriteContext
      }, userId)
        .then((result) => {
          const nextAdaptation = {
            source_rewrite: adaptationsRef.current[key]?.source_rewrite || "",
            target_translation: result.target_translation,
            status: "ready" as const
          };
          persistAdaptation(key, nextAdaptation);
          setAdaptationsSynced((current) => ({
            ...current,
            [key]: nextAdaptation
          }));
          maybeAutoSpeakPhrases([phrase], adaptationsRef.current);
        })
        .catch(() => {
          // Keep Soniox's provisional translation if the fast DeepL pass misses.
        });
      window.setTimeout(() => {
        const signals = providerSignalsRef.current;
        setAdaptationsSynced((current) => ({
          ...current,
          [key]: {
            source_rewrite: current[key]?.source_rewrite || "",
            target_translation: current[key]?.target_translation || "",
            status: "loading"
          }
        }));
        adaptPhrase({
          source_language: ENGLISH_LANGUAGE,
          target_language: targetLanguage,
          source_text: sourceText,
          draft_translation: draftTranslation,
          rewrite_context: {
            ...baseRewriteContext,
            transcription_candidates: [sourceText, ...signals.transcripts.slice(-4)],
            translation_candidates: [
              ...(draftTranslation ? [draftTranslation] : []),
              ...signals.translations.slice(-4)
            ]
          }
        }, userId)
          .then((result) => {
            const nextAdaptation = { ...result, status: "ready" as const };
            persistAdaptation(key, nextAdaptation);
            setAdaptationsSynced((current) => ({
              ...current,
              [key]: nextAdaptation
            }));
          })
          .catch(() => {
            setAdaptationsSynced((current) => ({
              ...current,
              [key]: {
                source_rewrite: current[key]?.source_rewrite || "",
                target_translation: current[key]?.target_translation || "",
                status: "error"
              }
            }));
          });
      }, 350);
    }
  }

  async function start(forceRealtime = openAIRealtimeEnabled) {
    cancelAutoImprove();
    const resumeSessionName = activeSessionRef.current;
    const isResuming = Boolean(resumeSessionName);
    setError("");
    setRediarizeStatus("");
    setTranslationStatus("");
    setReviewStatus("");
    clearProviderSignals();
    clearRealtimeCaptionDrafts();
    if (!isResuming) {
      setSavedPath("");
      setActiveSessionSynced("");
      setActiveSessionTitle("New chat");
      setSpeakerDrafts({});
      setEditingSpeaker(null);
      setSpeakerEditorDraft(null);
      setPhrases([]);
      resetAdaptations();
      setTokenCount(0);
      setActiveDurationSeconds(0);
      startDurationTimer(Date.now());
    } else {
      // Resume: keep existing transcript, adaptations, title, and token count.
      // Continue the duration timer from where it left off so the displayed
      // length keeps accumulating instead of restarting at zero.
      const elapsedSeconds = activeDurationSeconds ?? durationFromPhrases(phrases) ?? 0;
      startDurationTimer(Date.now() - Math.max(0, elapsedSeconds) * 1000);
    }
    shouldFollowFeedRef.current = true;
    setStatus("requesting microphone");

    try {
      if (forceRealtime) {
        await startRealtimeOverdub();
        await startRealtimeTranscriptBridge(resumeSessionName);
        return;
      }
      const { startPcmRecorder } = await import("@/lib/audio");
      const recorder = await startPcmRecorder((chunk) => {
        const socket = wsRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(chunk);
        }
      });
      recorderRef.current = recorder;

      setStatus("connecting");
      const socket = new WebSocket(websocketUrl(userId));
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "start",
            session_name: resumeSessionName,
            user_id: userId,
            source_languages: [...sourceALanguages, sourceB],
            target_language: sourceB,
            expected_speaker_count: expectedSpeakerCount ? Number(expectedSpeakerCount) : null,
            expected_speaker_names: [],
            enable_openai_realtime: forceRealtime,
            context: contextBundle.soniox
          })
        );
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as TranscriptEvent;
        handleServerEvent(message);
      };

      socket.onerror = () => {
        setError("WebSocket connection failed. Is the FastAPI backend running on port 8000?");
        setStatus("error");
        cleanup();
      };

      socket.onclose = () => {
        if (status !== "stopping") {
          setStatus((current) => (current === "error" ? "error" : "stopped"));
        }
        cleanup();
      };
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not start microphone capture.");
      setStatus("error");
      cleanup();
    }
  }

  function changeRealtimeEnabled(enabled: boolean) {
    setOpenAIRealtimeEnabled(enabled);
  }

  async function startRealtimeOverdub() {
    setActiveSessionTitle("Realtime overdub");
    setStatus("connecting");
    micCaptureEnabledRef.current = micCaptureEnabled;

    const directions: RealtimeDirection[] = [];
    if (englishToTargetOverdubEnabled) {
      directions.push("english_to_target");
    }
    if (targetToEnglishOverdubEnabled) {
      directions.push("target_to_english");
    }
    if (directions.length === 0) {
      directions.push("english_to_target");
      setEnglishToTargetOverdubEnabled(true);
    }

    for (const direction of directions) {
      await startRealtimeDirection(direction);
    }
    setStatus("listening");
  }

  async function startRealtimeTranscriptBridge(resumeSessionName = "") {
    realtimeTranscriptBridgeActiveRef.current = true;
    sonioxRealtimePhraseCountRef.current = 0;
    const { startPcmRecorder } = await import("@/lib/audio");
    const recorder = await startPcmRecorder((chunk) => {
      const socket = wsRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(chunk);
      }
    }, {
      autoGainControl: true,
      echoCancellation: true,
      noiseSuppression: true
    });
    recorderRef.current = recorder;

    const socket = new WebSocket(websocketUrl(userId));
    socket.binaryType = "arraybuffer";
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "start",
          session_name: resumeSessionName,
          user_id: userId,
          source_languages: [...sourceALanguages, sourceB],
          target_language: sourceB,
          expected_speaker_count: expectedSpeakerCount ? Number(expectedSpeakerCount) : null,
          expected_speaker_names: [],
          enable_openai_realtime: false,
          context: contextBundle.soniox
        })
      );
    };

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as TranscriptEvent;
      handleServerEvent(message);
    };

    socket.onerror = () => {
      setError("Realtime transcript stream failed. Is the FastAPI backend running on port 8000?");
      setStatus("error");
      cleanup();
    };

    socket.onclose = () => {
      realtimeTranscriptBridgeActiveRef.current = false;
      if (status !== "stopping") {
        setStatus((current) => (current === "error" ? "error" : "stopped"));
      }
      cleanup();
    };
  }

  async function startRealtimeDirection(direction: RealtimeDirection) {
    if (realtimeSessionsRef.current[direction]) {
      return;
    }
    const targetLanguage = direction === "english_to_target"
      ? englishOverdubTargetLanguage(sourceALanguages, sourceB)
      : ENGLISH_LANGUAGE;
    const secret = await createRealtimeTranslationSession({ target_language: targetLanguage }, userId);
    const clientSecret = secret.value || secret.client_secret?.value;
    if (!clientSecret) {
      throw new Error("OpenAI realtime session response did not include a client secret.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    stream.getAudioTracks().forEach((track) => {
      track.enabled = micCaptureEnabledRef.current;
    });

    const pc = new RTCPeerConnection();
    pc.addTrack(stream.getAudioTracks()[0], stream);

    const audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    pc.ontrack = ({ streams }) => {
      audio.srcObject = streams[0];
      void audio.play().catch(() => {
        setError("Browser blocked translated audio playback. Click the page and try again.");
      });
    };

    const events = pc.createDataChannel("oai-events");
    events.onmessage = ({ data }) => {
      handleRealtimeTranslationEvent(direction, data);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/translations/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp"
      },
      body: offer.sdp || ""
    });
    if (!sdpResponse.ok) {
      throw new Error(await sdpResponse.text());
    }
    await pc.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text()
    });

    realtimeSessionsRef.current[direction] = {
      audio,
      pc,
      setMicEnabled: (enabled: boolean) => {
        stream.getAudioTracks().forEach((track) => {
          track.enabled = enabled;
        });
      },
      stop: () => {
        stream.getTracks().forEach((track) => track.stop());
        audio.pause();
        audio.srcObject = null;
        pc.close();
      },
      stream
    };
  }

  function handleRealtimeTranslationEvent(direction: RealtimeDirection, rawData: string) {
    let event: { type?: string; delta?: string; text?: string; transcript?: string; error?: unknown };
    try {
      event = JSON.parse(rawData);
    } catch {
      return;
    }
    const eventType = event.type || "";
    const delta = typeof event.delta === "string"
      ? event.delta
      : typeof event.text === "string"
        ? event.text
        : typeof event.transcript === "string"
          ? event.transcript
          : "";
    const isInputTranscriptDelta = eventType === "session.input_transcript.delta"
      || eventType.endsWith(".input_transcript.delta")
      || eventType.includes("input_audio_transcription.delta");
    const isOutputTranscriptDelta = eventType === "session.output_transcript.delta"
      || eventType.endsWith(".output_transcript.delta")
      || eventType.includes("response.audio_transcript.delta");
    const transcriptBridgeHasPhrases = sonioxRealtimePhraseCountRef.current > 0;
    const shouldRenderRealtimeCaption = !realtimeTranscriptBridgeActiveRef.current || !transcriptBridgeHasPhrases;
    if (isInputTranscriptDelta && delta) {
      appendRealtimeCaptionDelta(direction, "input", delta, shouldRenderRealtimeCaption);
      setProviderSignalsSynced((current) => ({
        ...current,
        transcripts: dedupeTail([...current.transcripts, delta], 12)
      }));
      return;
    }
    if (isOutputTranscriptDelta && delta) {
      const existingDraft = realtimeCaptionDraftsRef.current[direction];
      appendRealtimeCaptionDelta(
        direction,
        "output",
        delta,
        shouldRenderRealtimeCaption && (!realtimeTranscriptBridgeActiveRef.current || Boolean(existingDraft?.input.trim()))
      );
      setProviderSignalsSynced((current) => ({
        ...current,
        translations: dedupeTail([...current.translations, delta], 12)
      }));
      return;
    }
    if (eventType === "session.output_transcript.done" || eventType.endsWith(".output_transcript.done")) {
      finalizeRealtimeCaption(direction);
      return;
    }
    if (eventType === "error") {
      setError(`OpenAI realtime ${directionLabel(direction)} failed: ${String(event.error || "unknown error")}`);
    }
  }

  async function refreshSessions() {
    try {
      const desired = Math.max(INITIAL_SESSION_LIMIT, sessions.length);
      const result = await fetchSessions({ limit: desired, userId });
      setSessions(result.sessions);
      setSessionTotal(result.total);
    } catch {
      // The main health/language load already exposes backend connection errors.
    }
  }

  async function loadMoreSessions() {
    if (loadingMoreSessions || sessions.length >= sessionTotal) {
      return;
    }
    setLoadingMoreSessions(true);
    try {
      const result = await fetchSessions({
        limit: SESSION_PAGE_SIZE,
        offset: sessions.length,
        userId,
      });
      setSessions((current) => {
        const seen = new Set(current.map((session) => session.name));
        const next = result.sessions.filter((session) => !seen.has(session.name));
        return next.length ? [...current, ...next] : current;
      });
      setSessionTotal(result.total);
    } catch {
      // Leave what we have; the sentinel will retry on next intersection.
    } finally {
      setLoadingMoreSessions(false);
    }
  }

  async function loadSession(name: string) {
    if (isLive) {
      return;
    }
    setError("");
    setLoadingSession(name);
    try {
      const detail = sessionDetailCacheRef.current[name] || await fetchSessionDetail(name, userId);
      sessionDetailCacheRef.current[name] = detail;
      if (!detail.session) {
        throw new Error("Session not found.");
      }
      const sourceLanguages = detail.session.source_languages || [sourceA, sourceB];
      const loadedTarget = detail.session.target_language || sourceLanguages[1] || sourceB;
      const loadedSources = sourceLanguages.filter((code) => code && code !== loadedTarget);
      setActiveSessionSynced(detail.session.name);
      setActiveSessionTitle(detail.session.title || "New chat");
      setSourceALanguages(loadedSources.length > 0 ? loadedSources : [sourceA]);
      setSourceB(loadedTarget);
      setContext(stripProfileBlock(stripRegisterBlock(detail.session.context || "")));
      setExpectedSpeakerCount(
        detail.session.expected_speaker_count ? String(detail.session.expected_speaker_count) : "6"
      );
      adaptationRequestsRef.current.clear();
      setAdaptationsSynced(detail.adaptations || {});
      setPhrasesAndFollow(detail.phrases || [], { requestAdaptations: false });
      clearProviderSignals();
      setTokenCount(detail.session.tokens?.length || detail.phrases?.length || 0);
      setActiveDurationSeconds(detail.session.duration_seconds ?? durationFromPhrases(detail.phrases || []));
      stopDurationTimer();
      setSavedPath(detail.session.artifact?.path || "");
      setRediarizeStatus("");
      setTranslationStatus("");
      setReviewStatus("");
      setSpeakerDrafts({});
      setEditingSpeaker(null);
      setSpeakerEditorDraft(null);
      shouldFollowFeedRef.current = true;
      setStatus("stopped");
      setSessionsOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load session.");
    } finally {
      setLoadingSession("");
    }
  }

  async function renameSessionTitle(name: string, title: string) {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      return;
    }
    try {
      const result = await renameSavedSession(name, cleanTitle, userId);
      setSessions((current) =>
        current.map((session) => (session.name === result.name ? { ...session, title: result.title } : session))
      );
      if (activeSession === result.name) {
        setActiveSessionTitle(result.title);
      }
      const cached = sessionDetailCacheRef.current[result.name];
      if (cached?.session) {
        cached.session.title = result.title;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not rename chat.");
    }
  }

  async function deleteSessionByName(name: string) {
    if (isLive && activeSession === name) {
      setError("Stop the current session before deleting it.");
      return;
    }
    try {
      const result = await deleteSavedSession(name, userId);
      delete sessionDetailCacheRef.current[result.name];
      setSessions((current) => current.filter((session) => session.name !== result.name));
      if (activeSession === result.name) {
        newSession();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete chat.");
    }
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next)); } catch {}
      return next;
    });
  }

  function newSession() {
    if (isLive) {
      return;
    }
    setSavedPath("");
    setActiveSessionSynced("");
    setActiveSessionTitle("");
    setRediarizeStatus("");
    setTranslationStatus("");
    setReviewStatus("");
    setSpeakerDrafts({});
    setEditingSpeaker(null);
    setSpeakerEditorDraft(null);
    setPhrases([]);
    resetAdaptations();
    clearProviderSignals();
    setTokenCount(0);
    setActiveDurationSeconds(null);
    stopDurationTimer();
    setExpectedSpeakerCount("2");
    setContext("");
    setSessionPlaceContext(DEFAULT_SESSION_PLACE_CONTEXT);
    shouldFollowFeedRef.current = true;
    setStatus("idle");
    setSessionsOpen(false);
  }

  function toggleSourceLanguage(code: string) {
    if (isLive || code === sourceB) {
      return;
    }
    setSourceALanguages((current) => {
      const next = current.includes(code)
        ? current.filter((language) => language !== code)
        : [...current, code];
      return next.length > 0 ? next : current;
    });
  }

  function changeTargetLanguage(code: string) {
    if (isLive) {
      return;
    }
    setSourceB(code);
    setSourceALanguages((current) => {
      const withoutTarget = current.filter((language) => language !== code);
      return withoutTarget.length > 0
        ? withoutTarget
        : [code === "en" ? "ja" : "en"];
    });
  }

  function changeLeftLanguageSelection(value: LeftLanguageSelection) {
    setLeftLanguageSelection(value);
    const targetLanguage = resolveLeftLanguageSelection(value, leftLanguageOptions, sourceALanguages, sourceB);
    requestAdaptationsFor(phrases, targetLanguage);
  }

  function submitTypedText() {
    const text = typedText.trim();
    if (!text) {
      return;
    }
    const phrase: Phrase = {
      id: `typed-${Date.now()}`,
      speaker: "typed",
      speaker_label: "You",
      source_lang: ENGLISH_LANGUAGE,
      texts: { [ENGLISH_LANGUAGE]: text },
      is_final: true,
      time: activeDurationSeconds
    };
    setTypedText("");
    setPhrasesAndFollow([...phrases, phrase]);
  }

  function changeAudiencePreset(presetId: string) {
    setAudiencePreset(presetId);
  }

  function appendContextExample(example: string) {
    setContext((current) => mergeLineText(current, [example]));
  }

  function handleServerEvent(message: TranscriptEvent) {
    if (message.type === "status") {
      setStatus(message.status === "listening" ? "listening" : "stopped");
      return;
    }
    if (message.type === "session") {
      setActiveSessionSynced(message.session.name);
      const incomingTitle = (message.session.title || "").trim();
      // On resume, the backend re-emits "New chat" before the saved title is
      // restored — don't clobber a real title we already have on screen.
      if (incomingTitle && incomingTitle.toLowerCase() !== "new chat") {
        setActiveSessionTitle(incomingTitle);
      } else if (!activeSessionTitle.trim()) {
        setActiveSessionTitle("New chat");
      }
      setTokenCount(message.session.token_count);
      return;
    }
    if (message.type === "transcript") {
      if (openAIRealtimeEnabled) {
        sonioxRealtimePhraseCountRef.current = message.phrases.length;
        if (message.phrases.length === 0) {
          // Soniox bridge emits empty transcripts while OpenAI captions are in flight.
          // Ignore those updates so local realtime phrases are not wiped.
          return;
        }
        clearRealtimeCaptionDrafts();
      }
      setPhrasesAndFollow(message.phrases);
      setTokenCount(message.final_token_count);
      return;
    }
    if (message.type === "provider_update") {
      if (message.kind === "transcript" && message.text) {
        setProviderSignalsSynced((current) => ({
          ...current,
          transcripts: dedupeTail([...current.transcripts, message.text], 12)
        }));
      }
      if (message.kind === "translation" && message.text) {
        setProviderSignalsSynced((current) => ({
          ...current,
          translations: dedupeTail([...current.translations, message.text], 12)
        }));
      }
      return;
    }
    if (message.type === "openai_realtime_audio") {
      audioPlayerRef.current?.playBase64Pcm16(message.audio, message.sample_rate);
      return;
    }
    if (message.type === "saved") {
      setActiveSessionSynced(message.session);
      const savedTitle = String(message.title || "").trim();
      if (savedTitle && savedTitle.toLowerCase() !== "new chat") {
        setActiveSessionTitle(savedTitle);
      } else if (!activeSessionTitle.trim()) {
        setActiveSessionTitle("New chat");
      }
      setSavedPath(message.path);
      setPhrasesAndFollow(message.phrases);
      clearProviderSignals();
      setTokenCount(message.token_count);
      setActiveDurationSeconds(durationFromPhrases(message.phrases));
      stopDurationTimer();
      refreshSessions();
      return;
    }
    if (message.type === "session_renamed") {
      const newTitle = String(message.title || "").trim();
      if (!newTitle) {
        return;
      }
      setSessions((current) =>
        current.map((session) => (session.name === message.session ? { ...session, title: newTitle } : session))
      );
      if (activeSession === message.session) {
        setActiveSessionTitle(newTitle);
      }
      const cached = sessionDetailCacheRef.current[message.session];
      if (cached?.session) {
        cached.session.title = newTitle;
      }
      return;
    }
    if (message.type === "error") {
      setError(message.message);
      setStatus("error");
      cleanup();
    }
  }

  function stop() {
    setStatus("stopping");
    const sessionToImprove = activeSessionRef.current;
    if (openAIRealtimeEnabled) {
      cleanup();
      setStatus("stopped");
      scheduleAutoImprove(sessionToImprove);
      return;
    }
    recorderRef.current?.stop();
    recorderRef.current = null;
    try {
      wsRef.current?.send(JSON.stringify({ type: "stop" }));
    } catch {
      // The close path below handles already-closed sockets.
    }
    if (stopFallbackTimerRef.current) {
      clearTimeout(stopFallbackTimerRef.current);
    }
    stopFallbackTimerRef.current = window.setTimeout(() => {
      setStatus((current) => {
        if (current === "stopping") {
          cleanup();
          return "stopped";
        }
        return current;
      });
    }, 45_000);
    scheduleAutoImprove(sessionToImprove);
  }

  function toggleMicCapture() {
    const enabled = !micCaptureEnabledRef.current;
    micCaptureEnabledRef.current = enabled;
    setMicCaptureEnabled(enabled);
    Object.values(realtimeSessionsRef.current).forEach((session) => {
      session?.setMicEnabled(enabled);
    });
  }

  function toggleRealtimeDirection(direction: RealtimeDirection) {
    const currentlyEnabled = direction === "english_to_target"
      ? englishToTargetOverdubEnabled
      : targetToEnglishOverdubEnabled;
    const nextEnabled = !currentlyEnabled;
    if (direction === "english_to_target") {
      setEnglishToTargetOverdubEnabled(nextEnabled);
    } else {
      setTargetToEnglishOverdubEnabled(nextEnabled);
    }

    if (!isLive || !openAIRealtimeEnabled) {
      return;
    }
    if (nextEnabled) {
      void startRealtimeDirection(direction).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : `Could not start ${directionLabel(direction)}.`);
        if (direction === "english_to_target") {
          setEnglishToTargetOverdubEnabled(false);
        } else {
          setTargetToEnglishOverdubEnabled(false);
        }
      });
      return;
    }

    finalizeRealtimeCaption(direction);
    realtimeSessionsRef.current[direction]?.stop();
    realtimeSessionsRef.current[direction] = null;
  }

  // Silent, fire-and-forget improve. Runs in the background after a chat stops.
  // Backend only overwrites artifacts on success; failures leave the chat untouched.
  // No UI state is mutated — the polished transcript appears the next time the session is loaded.
  async function runAutoImproveSilently(sessionName: string) {
    if (!sessionName) return;
    try {
      await rediarizeSession(sessionName, userId);
      await retranslateSession(sessionName, userId);
      // Drop any cached detail so the next load fetches the freshly polished version.
      delete sessionDetailCacheRef.current[sessionName];
    } catch {
      // Best-effort: swallow errors. Original chat is preserved by the backend.
    }
  }

  function scheduleAutoImprove(sessionName: string) {
    cancelAutoImprove();
    if (!sessionName) return;
    if (!travelerProfile.auto_improve) return;
    autoImproveTimerRef.current = window.setTimeout(() => {
      autoImproveTimerRef.current = null;
      void runAutoImproveSilently(sessionName);
    }, AUTO_IMPROVE_DELAY_MS);
  }

  function cancelAutoImprove() {
    if (autoImproveTimerRef.current !== null) {
      clearTimeout(autoImproveTimerRef.current);
      autoImproveTimerRef.current = null;
    }
  }

  function updateSpeakerDraft(speakerId: string, patch: Partial<SpeakerDraft>) {
    setSpeakerDrafts((current) => ({
      ...current,
      [speakerId]: {
        mergeInto: current[speakerId]?.mergeInto || speakerId,
        label: current[speakerId]?.label || "",
        ...patch
      }
    }));
  }

  function openSpeakerEditor(speakerId: string, label: string) {
    const existing = speakerDrafts[speakerId];
    const fullName = existing?.label.trim() || speakerEditableName(label, speakerId);
    setEditingSpeaker(speakerId);
    setSpeakerEditorDraft({
      speakerId,
      fullName,
      initials: existing?.initials?.trim() || initialsFromSpeakerName(fullName, speakerId)
    });
  }

  function closeSpeakerEditor() {
    setEditingSpeaker(null);
    setSpeakerEditorDraft(null);
  }

  function saveSpeakerEditor() {
    if (!speakerEditorDraft) {
      return;
    }
    const fullName = speakerEditorDraft.fullName.trim();
    const label = fullName || fallbackSpeakerLabel(speakerEditorDraft.speakerId);
    const initials = normalizeInitials(speakerEditorDraft.initials) || initialsFromSpeakerName(label, speakerEditorDraft.speakerId);
    updateSpeakerDraft(speakerEditorDraft.speakerId, { initials, label });
    closeSpeakerEditor();
  }

  function cleanup() {
    stopDurationTimer();
    if (stopFallbackTimerRef.current) {
      clearTimeout(stopFallbackTimerRef.current);
      stopFallbackTimerRef.current = null;
    }
    recorderRef.current?.stop();
    recorderRef.current = null;
    audioPlayerRef.current?.stop();
    audioPlayerRef.current = null;
    stopRealtimeSessions();
    realtimeTranscriptBridgeActiveRef.current = false;
    sonioxRealtimePhraseCountRef.current = 0;
    if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
      wsRef.current.close();
    }
    wsRef.current = null;
  }

  function stopRealtimeSessions() {
    for (const direction of Object.keys(realtimeSessionsRef.current) as RealtimeDirection[]) {
      finalizeRealtimeCaption(direction);
      realtimeSessionsRef.current[direction]?.stop();
      realtimeSessionsRef.current[direction] = null;
    }
  }

  function handleFeedScroll() {
    const feed = feedRef.current;
    if (!feed) {
      return;
    }
    shouldFollowFeedRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
  }

  return (
    <main className="appShell">
      <section className={`workspace ${sidebarCollapsed ? "sidebarCollapsed" : ""}`}>
        <button
          aria-label="Close sessions"
          className={`sessionBackdrop ${sessionsOpen ? "open" : ""}`}
          onClick={() => setSessionsOpen(false)}
          type="button"
        />
        <SessionSidebar
          activeSession={activeSession}
          activeSessionTitle={activeSessionTitle}
          allGroups={sessionGroups}
          isCollapsed={sidebarCollapsed}
          isOpen={sessionsOpen}
          loadingMore={loadingMoreSessions}
          loadingSession={loadingSession}
          onClose={() => setSessionsOpen(false)}
          onDelete={deleteSessionByName}
          onLoad={loadSession}
          onLoadMore={loadMoreSessions}
          onNew={newSession}
          onRename={renameSessionTitle}
          onToggleCollapsed={toggleSidebarCollapsed}
          total={sessionTotal}
          userName={userName}
          userId={userId}
        />

        <section className={`transcriptPanel ${showOnboarding ? "setupMode" : ""}`} aria-label="Live transcript">
          <div className="transcriptHeader">
            <div className="transcriptTitleRow">
              <button
                aria-label="Open sessions"
                className="menuButton transcriptMenuButton"
                onClick={() => setSessionsOpen(true)}
                type="button"
              >
                <span />
                <span />
                <span />
              </button>
              {showOnboarding ? (
                <div className="headerLanguagePicker" aria-label="Transcript languages">
                  <LanguagePicker
                    disabled={isLive}
                    languageMap={languageMap}
                    languages={orderedLanguages}
                    onSourceToggle={toggleSourceLanguage}
                    onTargetChange={changeTargetLanguage}
                    sourceLanguages={sourceALanguages}
                    targetLanguage={sourceB}
                  />
                </div>
              ) : (
                <HeaderLanguagePill
                  languageMap={languageMap}
                  sourceLanguages={sourceALanguages}
                  targetLanguage={sourceB}
                  leftLanguageOptions={leftLanguageOptions}
                  leftLanguageSelection={leftLanguageSelection}
                  onLeftLanguageChange={changeLeftLanguageSelection}
                />
              )}
            </div>
            {!showOnboarding && !openAIRealtimeEnabled ? (
              <div className="transcriptMeta">
                {supportsRomanization(activeLeftLanguage) ? (
                  <DualLabelToggle
                    leftLabel="script"
                    rightLabel="romaji"
                    rightSelected={showRomaji}
                    onChange={setShowRomaji}
                    title="Script shows original characters. Romaji shows only the phonetic romanization."
                  />
                ) : null}
                <DualLabelToggle
                  leftLabel="fast"
                  rightLabel="slow"
                  rightSelected={transcriptLatencyMode === "slow"}
                  onChange={(slow) => setTranscriptLatencyMode(slow ? "slow" : "fast")}
                  title="Slow mode waits for the AI to polish the wording and translation before showing the bubble. Fast skips the polish step."
                />
                <DualLabelToggle
                  leftLabel="original"
                  rightLabel="enhanced"
                  rightSelected={showEnhancedEnglish}
                  onChange={setShowEnhancedEnglish}
                  title="Enhanced shows the AI-polished English so the translation reads naturally. Original shows the verbatim transcript."
                />
                <DualLabelToggle
                  leftLabel="push"
                  rightLabel="autospeak"
                  rightSelected={ttsMode === "auto"}
                  onChange={(autospeak) => changeTtsMode(autospeak ? "auto" : "push")}
                  title="Autospeak reads every finalized translation out loud automatically. Push keeps it manual — tap the voice icon on a bubble to play it."
                />
              </div>
            ) : null}
          </div>
          {showOnboarding ? (
            <ConversationOnboarding
              audiencePreset={audiencePreset}
              canStart={canStart && hasLanguagePair}
              context={context}
              disabled={isLive}
              error={error}
              expectedSpeakerCount={expectedSpeakerCount}
              onAudienceChange={changeAudiencePreset}
              onContextChange={setContext}
              onContextExample={appendContextExample}
              onRealtimeChange={changeRealtimeEnabled}
              onSpeakerCountChange={setExpectedSpeakerCount}
              onStart={() => start(openAIRealtimeEnabled)}
              openAIRealtimeEnabled={openAIRealtimeEnabled}
              preset={selectedPreset}
            />
          ) : (
            <>
              {error ? <FeedbackBanner message={error} /> : null}
              <div className="feed" onScroll={handleFeedScroll} ref={feedRef}>
                {phrases.length === 0 ? (
                  <LiveCanvas
                    isLive={isLive}
                    micCaptureEnabled={micCaptureEnabled}
                    openAIRealtimeEnabled={openAIRealtimeEnabled}
                    sourceLanguages={sourceALanguages}
                    status={status}
                    targetLanguage={sourceB}
                    languageMap={languageMap}
                  />
                ) : visiblePhraseGroups.length === 0 ? (
                  <div className="emptyState">
                    <strong>Waiting for corrections...</strong>
                  </div>
                ) : (
                  visiblePhraseGroups.map((phraseGroup) => (
                    <PhraseCard
                      key={phraseGroup[0]?.id || ""}
                      adaptations={adaptations}
                      activeLeftLanguage={activeLeftLanguage}
                      editingSpeaker={editingSpeaker}
                      latencyMode={transcriptLatencyMode}
                      leftLanguageSelection={leftLanguageSelection}
                      languageMap={languageMap}
                      onEditSpeaker={openSpeakerEditor}
                      onSpeak={speakPhraseText}
                      phrases={phraseGroup}
                      speakLanguage={ttsSpeakLanguage}
                      speakerDrafts={speakerDrafts}
                      showEnhancedEnglish={showEnhancedEnglish}
                      showRomaji={showRomaji}
                      targetLanguage={sourceB}
                      ttsStatus={ttsStatus}
                    />
                  ))
                )}
              </div>
              {speakerEditorDraft ? (
                <SpeakerNameDialog
                  draft={speakerEditorDraft}
                  onCancel={closeSpeakerEditor}
                  onChange={setSpeakerEditorDraft}
                  onSave={saveSpeakerEditor}
                />
              ) : null}
              <ControlsStrip
                canStart={canStart && hasLanguagePair}
                durationLabel={formatTranscriptStats(transcriptStats)}
                englishTargetLabel={languageShortLabel(englishOverdubTargetLanguage(sourceALanguages, sourceB), languageMap)}
                englishToTargetOverdubEnabled={englishToTargetOverdubEnabled}
                isLive={isLive}
                micCaptureEnabled={micCaptureEnabled}
                onStart={() => start(openAIRealtimeEnabled)}
                onStop={stop}
                onToggleEnglishToTarget={() => toggleRealtimeDirection("english_to_target")}
                onToggleMicCapture={toggleMicCapture}
                onToggleTargetToEnglish={() => toggleRealtimeDirection("target_to_english")}
                openAIRealtimeEnabled={openAIRealtimeEnabled}
                targetToEnglishOverdubEnabled={targetToEnglishOverdubEnabled}
              />
              <ComposerBar
                onSubmit={submitTypedText}
                text={typedText}
                onTextChange={setTypedText}
              />
            </>
          )}
        </section>
      </section>
    </main>
  );
}

function ComposerBar({
  onSubmit,
  onTextChange,
  text
}: {
  onSubmit: () => void;
  onTextChange: (value: string) => void;
  text: string;
}) {
  return (
    <form
      className="composerBar"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        aria-label="Type a phrase"
        className="composerInput"
        onChange={(event) => onTextChange(event.target.value)}
        placeholder="Type a phrase to translate..."
        value={text}
      />
      <button className="sendButton" disabled={!text.trim()} type="submit">
        Send
      </button>
    </form>
  );
}

function ControlsStrip({
  canStart,
  durationLabel,
  englishTargetLabel,
  englishToTargetOverdubEnabled,
  isLive,
  micCaptureEnabled,
  onStart,
  onStop,
  onToggleEnglishToTarget,
  onToggleMicCapture,
  onToggleTargetToEnglish,
  openAIRealtimeEnabled,
  targetToEnglishOverdubEnabled
}: {
  canStart: boolean;
  durationLabel: string;
  englishTargetLabel: string;
  englishToTargetOverdubEnabled: boolean;
  isLive: boolean;
  micCaptureEnabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleEnglishToTarget: () => void;
  onToggleMicCapture: () => void;
  onToggleTargetToEnglish: () => void;
  openAIRealtimeEnabled: boolean;
  targetToEnglishOverdubEnabled: boolean;
}) {
  return (
    <div className="controlsStrip" aria-label="Session controls">
      <button
        aria-label={isLive ? "Stop session" : "Start session"}
        className={`stripTransportButton ${isLive ? "recording" : ""}`}
        disabled={!isLive && !canStart}
        onClick={isLive ? onStop : onStart}
        type="button"
      >
        <span aria-hidden="true" className="stripTransportGlyph">{isLive ? "■" : "▶"}</span>
        <span>{isLive ? "Stop" : "Start"}</span>
      </button>
      {openAIRealtimeEnabled && isLive ? (
        <div className="controlsStripToggles">
          <MuteButton
            label="mic"
            enabled={micCaptureEnabled}
            icon={<MicIcon />}
            onToggle={onToggleMicCapture}
          />
          <MuteButton
            label={`voice ${englishTargetLabel}`}
            enabled={englishToTargetOverdubEnabled}
            icon={<VoiceIcon />}
            onToggle={onToggleEnglishToTarget}
          />
          <MuteButton
            label="voice EN"
            enabled={targetToEnglishOverdubEnabled}
            icon={<VoiceIcon />}
            onToggle={onToggleTargetToEnglish}
          />
        </div>
      ) : null}
      <span className="controlsStripDuration" aria-label="Conversation duration">{durationLabel}</span>
    </div>
  );
}

function MuteButton({
  enabled,
  icon,
  label,
  onToggle,
  disabled = false
}: {
  enabled: boolean;
  icon: ReactNode;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={`${enabled ? "Mute" : "Unmute"} ${label}`}
      aria-pressed={!enabled}
      className={`muteButton ${enabled ? "" : "muted"}`}
      disabled={disabled}
      onClick={onToggle}
      title={`${enabled ? "Mute" : "Unmute"} ${label}`}
      type="button"
    >
      <span className="muteButtonIcon" aria-hidden="true">{icon}</span>
      <span className="muteButtonLabel">{label}</span>
    </button>
  );
}

function VoiceIcon() {
  return (
    <svg aria-hidden="true" className="controlIcon" viewBox="0 0 24 24">
      <rect x="3" y="10" width="2.4" height="4" rx="1" />
      <rect x="7.2" y="7" width="2.4" height="10" rx="1" />
      <rect x="11.4" y="4" width="2.4" height="16" rx="1" />
      <rect x="15.6" y="7" width="2.4" height="10" rx="1" />
      <rect x="19.8" y="10" width="2.4" height="4" rx="1" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" className="controlIcon" viewBox="0 0 24 24">
      <path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v3" />
      <path d="M9 20h6" />
    </svg>
  );
}

function ConversationOnboarding({
  audiencePreset,
  canStart,
  context,
  disabled,
  error,
  expectedSpeakerCount,
  onAudienceChange,
  onContextChange,
  onContextExample,
  onRealtimeChange,
  onSpeakerCountChange,
  onStart,
  openAIRealtimeEnabled,
  preset
}: {
  audiencePreset: string;
  canStart: boolean;
  context: string;
  disabled: boolean;
  error: string;
  expectedSpeakerCount: string;
  onAudienceChange: (presetId: string) => void;
  onContextChange: (value: string) => void;
  onContextExample: (example: string) => void;
  onRealtimeChange: (enabled: boolean) => void;
  onSpeakerCountChange: (count: string) => void;
  onStart: () => void;
  openAIRealtimeEnabled: boolean;
  preset: typeof AUDIENCE_PRESETS[number];
}) {
  return (
    <section className="chatHero" aria-label="Start conversation">
      <div className="chatHeroInner">
        <h2 className="chatHeroHeadline">Ready when you are.</h2>
        <button
          aria-label="Start session"
          className="chatHeroMic"
          disabled={!canStart}
          onClick={onStart}
          type="button"
        >
          <HeroMicIcon />
        </button>
        <div className="chatHeroEngine" role="group" aria-label="Translation engine">
          <DualLabelToggle
            leftLabel="standard"
            rightLabel="gpt realtime"
            rightSelected={openAIRealtimeEnabled}
            onChange={onRealtimeChange}
            disabled={disabled}
            title="GPT realtime: sub-second voice translation via the OpenAI realtime API. Higher cost, lower latency. Standard uses the transcribe+translate pipeline. Cannot be changed once the session starts."
          />
        </div>
        {openAIRealtimeEnabled ? null : (
          <>
            <p className="chatHeroSubhead">Who are you speaking to?</p>
            <div className="chatHeroChips" role="group" aria-label="Who are you speaking to?">
              {AUDIENCE_PRESETS.map((option) => (
                <button
                  aria-pressed={audiencePreset === option.id}
                  className={`chatHeroChip ${audiencePreset === option.id ? "active" : ""}`}
                  disabled={disabled}
                  key={option.id}
                  onClick={() => onAudienceChange(option.id)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="chatHeroSpeakers" role="group" aria-label="Expected speakers">
              <span className="chatHeroSpeakersLabel">Speakers</span>
              {SPEAKER_COUNT_OPTIONS.map((count) => (
                <button
                  aria-pressed={expectedSpeakerCount === count}
                  className={`chatHeroSpeakerOption ${expectedSpeakerCount === count ? "active" : ""}`}
                  disabled={disabled}
                  key={count}
                  onClick={() => onSpeakerCountChange(count)}
                  type="button"
                >
                  {count === "6" ? "6+" : count}
                </button>
              ))}
            </div>
          </>
        )}
        {error ? <div className="errorBox chatHeroError">{error}</div> : null}
      </div>
      {/*<details className="advancedSetup">
        <summary>Add a note (optional)</summary>
        <div className="startFields contextFields">
          <label className="contextField">
            Useful detail for this conversation
            <textarea
              value={context}
              onChange={(event) => onContextChange(event.target.value)}
              disabled={disabled}
              placeholder="e.g. reservation name, an allergy, a phrase to say gently"
            />
            <span className="hint">Names, allergies, places, or anything else the translator should keep in mind.</span>
          </label>
          <div className="contextExampleRow" aria-label="Context examples">
            {NOTE_EXAMPLES.map((example) => (
              <button
                className="contextExampleButton"
                disabled={disabled}
                key={example}
                onClick={() => onContextExample(example)}
                type="button"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </details>*/}
    </section>
  );
}

function HeroMicIcon() {
  return (
    <svg aria-hidden="true" className="chatHeroMicIcon" viewBox="0 0 24 24">
      <path d="M12 3a3.2 3.2 0 0 0-3.2 3.2v6a3.2 3.2 0 1 0 6.4 0v-6A3.2 3.2 0 0 0 12 3Z" />
      <path d="M5.5 11.2a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.7v3.1" />
      <path d="M9 20.8h6" />
    </svg>
  );
}

function DualLabelToggle({
  leftLabel,
  rightLabel,
  rightSelected,
  onChange,
  disabled = false,
  title
}: {
  leftLabel: string;
  rightLabel: string;
  rightSelected: boolean;
  onChange: (rightSelected: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div
      className="appleSwitch dualLabel"
      role="group"
      aria-label={`${leftLabel} or ${rightLabel}`}
      title={title}
    >
      <button
        aria-pressed={!rightSelected}
        className={`appleSwitchOption ${rightSelected ? "" : "selected"}`}
        disabled={disabled}
        onClick={() => onChange(false)}
        type="button"
      >
        {leftLabel}
      </button>
      <button
        aria-label={`Toggle ${leftLabel} / ${rightLabel}`}
        className="appleSwitchTrack"
        data-checked={rightSelected ? "true" : "false"}
        disabled={disabled}
        onClick={() => onChange(!rightSelected)}
        type="button"
      >
        <span />
      </button>
      <button
        aria-pressed={rightSelected}
        className={`appleSwitchOption ${rightSelected ? "selected" : ""}`}
        disabled={disabled}
        onClick={() => onChange(true)}
        type="button"
      >
        {rightLabel}
      </button>
    </div>
  );
}

function HeaderLanguagePill({
  languageMap,
  sourceLanguages,
  targetLanguage,
  leftLanguageOptions,
  leftLanguageSelection,
  onLeftLanguageChange
}: {
  languageMap: Map<string, Language>;
  sourceLanguages: string[];
  targetLanguage: string;
  leftLanguageOptions: Array<{ code: string; flag: string; name: string }>;
  leftLanguageSelection: LeftLanguageSelection;
  onLeftLanguageChange: (value: LeftLanguageSelection) => void;
}) {
  const cycleOptions: LeftLanguageSelection[] = ["all", ...leftLanguageOptions.map((l) => l.code)];
  const canCycle = cycleOptions.length > 1;
  const currentIndex = Math.max(0, cycleOptions.indexOf(leftLanguageSelection));
  const sourceDisplay = leftPillDisplay(leftLanguageSelection, leftLanguageOptions, sourceLanguages, languageMap);
  const target = languageMap.get(targetLanguage);
  const targetCode = (target?.code || targetLanguage || "en").slice(0, 2).toUpperCase();
  const targetFlag = target?.flag || "🏳";
  const targetName = target?.name || targetCode;

  function advance() {
    if (!canCycle) return;
    const next = cycleOptions[(currentIndex + 1) % cycleOptions.length];
    onLeftLanguageChange(next!);
  }

  return (
    <h2 className="transcriptTitle headerLanguagePill" aria-label={`${sourceDisplay.name} to ${targetName}`}>
      <button
        type="button"
        className={`headerLanguagePillChip headerLanguagePillChip--interactive${canCycle ? "" : " is-static"}`}
        onClick={advance}
        disabled={!canCycle}
        aria-label={`Source display: ${sourceDisplay.name}. ${canCycle ? "Click to switch." : ""}`}
        title={canCycle ? `${sourceDisplay.name} — click to switch` : sourceDisplay.name}
      >
        <span className="headerLanguagePillFlag" aria-hidden>{sourceDisplay.flag}</span>
        <span className="headerLanguagePillCode">{sourceDisplay.code}</span>
      </button>
      <span className="headerLanguagePillArrow" aria-hidden>→</span>
      <span
        className="headerLanguagePillChip"
        aria-label={`Target language: ${targetName}`}
        title={targetName}
      >
        <span className="headerLanguagePillFlag" aria-hidden>{targetFlag}</span>
        <span className="headerLanguagePillCode">{targetCode}</span>
      </span>
    </h2>
  );
}

function leftPillDisplay(
  selection: LeftLanguageSelection,
  options: Array<{ code: string; flag: string; name: string }>,
  sourceLanguages: string[],
  languageMap: Map<string, Language>
): { flag: string; code: string; name: string } {
  if (selection === "all") {
    const count = options.length || sourceLanguages.length;
    return { flag: "🌐", code: "ALL", name: count > 1 ? `All languages (${count})` : "All languages" };
  }
  const match = options.find((opt) => opt.code === selection)
    || (() => {
      const lang = languageMap.get(selection);
      return lang ? { code: lang.code, flag: lang.flag, name: lang.name } : null;
    })();
  if (match) {
    return { flag: match.flag, code: match.code.slice(0, 2).toUpperCase(), name: match.name };
  }
  const fallback = sourceLanguages[0] || "";
  const lang = languageMap.get(fallback);
  return {
    flag: lang?.flag || "🏳",
    code: (lang?.code || fallback || "??").slice(0, 2).toUpperCase(),
    name: lang?.name || fallback || "Source"
  };
}

function FeedbackBanner({ message }: { message: string }) {
  return <div className="errorBox" role="alert">{friendlyErrorMessage(message)}</div>;
}

function LiveCanvas({
  isLive,
  languageMap,
  micCaptureEnabled,
  openAIRealtimeEnabled,
  sourceLanguages,
  status,
  targetLanguage
}: {
  isLive: boolean;
  languageMap: Map<string, Language>;
  micCaptureEnabled: boolean;
  openAIRealtimeEnabled: boolean;
  sourceLanguages: string[];
  status: AppStatus;
  targetLanguage: string;
}) {
  const shortTitle = transcriptShortTitle(sourceLanguages, targetLanguage, languageMap);
  const fullTitle = transcriptTitle(sourceLanguages, targetLanguage, languageMap);
  const liveHeadline = micCaptureEnabled ? (
    <>Listening<span className="listeningDots" aria-hidden="true" /></>
  ) : (
    "Microphone paused"
  );
  const headline = isLive ? liveHeadline : "Ready to listen";
  const detail = isLive
    ? openAIRealtimeEnabled
      ? "Realtime overdub is on. Speak naturally and subtitles will appear here."
      : "Live transcription is running. Translated phrases will appear here."
    : "Start a session when you are ready. Source speech and translation will stay together in this chat.";

  return (
    <section className="liveCanvas" aria-label="Conversation status">
      <div className="liveCanvasHeader">
        <span className={`liveDot ${isLive && micCaptureEnabled ? "active" : ""}`} aria-hidden="true" />
        <div>
          <strong>{headline}</strong>
          <span>{statusLabel(status)}</span>
        </div>
      </div>
      <div className="liveWave" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="liveDirection">
        <span>{shortTitle}</span>
        <small>{fullTitle}</small>
      </div>
      <p>{detail}</p>
    </section>
  );
}

function SessionSidebar({
  activeSession,
  activeSessionTitle,
  allGroups,
  isCollapsed,
  isOpen,
  loadingMore,
  loadingSession,
  onClose,
  onDelete,
  onLoad,
  onLoadMore,
  onNew,
  onRename,
  onToggleCollapsed,
  total,
  userName,
  userId
}: {
  activeSession: string;
  activeSessionTitle: string;
  allGroups: SessionGroup[];
  isCollapsed: boolean;
  isOpen: boolean;
  loadingMore: boolean;
  loadingSession: string;
  onClose: () => void;
  onDelete: (name: string) => Promise<void>;
  onLoad: (name: string) => void;
  onLoadMore: () => Promise<void> | void;
  onNew: () => void;
  onRename: (name: string, title: string) => Promise<void>;
  onToggleCollapsed: () => void;
  total: number;
  userName: string;
  userId?: string;
}) {
  const [openMenuSession, setOpenMenuSession] = useState("");
  const [renamingSession, setRenamingSession] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteSession, setConfirmDeleteSession] = useState("");
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const groups = allGroups;
  const visibleCount = countGroupedSessions(groups);
  const hasMore = total > visibleCount;
  const skeletonCount = hasMore ? Math.min(6, Math.max(1, total - visibleCount)) : 0;

  // Callback ref: when the sentinel attaches, wire up IntersectionObserver against
  // the scroll container. React 19 honors the returned cleanup when the ref detaches
  // or when deps change.
  function attachLoadMoreSentinel(node: HTMLDivElement | null) {
    if (!node || !listEl || !hasMore || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void onLoadMore();
        }
      },
      { root: listEl, rootMargin: "200px 0px", threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }

  async function saveRename(session: SessionSummary) {
    await onRename(session.name, renameDraft);
    setOpenMenuSession("");
    setRenamingSession("");
    setRenameDraft("");
  }

  async function eraseSession(session: SessionSummary) {
    await onDelete(session.name);
    setOpenMenuSession("");
    setRenamingSession("");
    setRenameDraft("");
    setConfirmDeleteSession("");
  }

  if (isCollapsed && !isOpen) {
    return (
      <aside className="sessionPanel collapsed" aria-label="Sessions">
        <div className="collapsedRail">
          <button aria-label="Open sidebar" className="collapsedRailButton" onClick={onToggleCollapsed} title="Open sidebar" type="button">
            <SidebarExpandIcon />
          </button>
          <button aria-label="New chat" className="collapsedRailButton" onClick={onNew} title="New chat" type="button">
            <NewChatIcon />
          </button>
          <button aria-label="Recents" className="collapsedRailButton" onClick={onToggleCollapsed} title="Recents" type="button">
            <RecentsIcon />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`sessionPanel ${isOpen ? "open" : ""}`} aria-label="Sessions">
      <div className="sessionPanelHeader">
        <Link aria-label="cottonoha, home" className="sidebarBrand" href="/" prefetch={false}>
          <BrandMark compact />
          <strong>cottonoha</strong>
        </Link>
        <div className="sessionHeaderActions">
          <button aria-label="Collapse sidebar" className="sidebarCollapseButton" onClick={onToggleCollapsed} title="Collapse sidebar" type="button">
            <SidebarCollapseIcon />
          </button>
          <button aria-label="Close sessions" className="drawerCloseButton" onClick={onClose} type="button">
            ×
          </button>
        </div>
      </div>

      <div className="sessionList" ref={setListEl}>
        <button aria-label="Start a new chat" className="sessionButton newChatButton" onClick={onNew} type="button">
          <NewChatIcon />
          <span className="sessionTitle">New chat</span>
        </button>
        {activeSession && !groups.some((group) => group.sessions.some((session) => session.name === activeSession)) ? (
          <section className="sessionGroup">
            <h3>Current</h3>
            <div className="sessionButton active currentSessionRow">
              <span className="sessionTitle">{activeSessionTitle || "New chat"}</span>
            </div>
          </section>
        ) : null}
        {groups.length === 0 && !activeSession ? (
          <div className="sessionEmpty">
            <p className="sessionEmptyTitle">Your first translation will show up here.</p>
            <button className="sessionEmptyExample" onClick={onNew} type="button">
              <NewChatIcon />
              <span>Start a translation</span>
            </button>
          </div>
        ) : (
          groups.map((group) => {
            const rows = group.sessions.map((session) => {
                const menuOpen = openMenuSession === session.name;
                const isRenaming = renamingSession === session.name;
                return (
                  <div className="sessionRow" key={session.name}>
                    <button
                      className={`sessionButton sessionOpenButton ${activeSession === session.name ? "active" : ""}`}
                      disabled={Boolean(loadingSession)}
                      onClick={() => onLoad(session.name)}
                      type="button"
                    >
                      <span className="sessionTitle">{session.title || session.name}</span>
                      {loadingSession === session.name ? <span className="sessionMeta">loading</span> : null}
                    </button>
                    <button
                      aria-expanded={menuOpen}
                      aria-haspopup="menu"
                      aria-label={`Chat options for ${session.title || session.name}`}
                      className="sessionMenuButton"
                      onClick={() => {
                        const nextOpen = menuOpen ? "" : session.name;
                        setOpenMenuSession(nextOpen);
                        setRenamingSession("");
                        setConfirmDeleteSession("");
                        setRenameDraft(session.title || session.name);
                      }}
                      type="button"
                    >
                      <KebabIcon />
                    </button>
                    {menuOpen ? (
                      <div className="sessionMenu" role="menu">
                        {isRenaming ? (
                          <form
                            className="sessionRenameForm"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveRename(session);
                            }}
                          >
                            <input
                              aria-label="Chat name"
                              autoFocus
                              onChange={(event) => setRenameDraft(event.target.value)}
                              value={renameDraft}
                            />
                            <div className="sessionMenuActions">
                              <button className="sessionMenuAction" type="submit">
                                Save
                              </button>
                              <button
                                className="sessionMenuAction"
                                onClick={() => {
                                  setRenamingSession("");
                                  setRenameDraft(session.title || session.name);
                                }}
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : confirmDeleteSession === session.name ? (
                          <div className="sessionDeleteConfirm">
                            <span className="sessionDeleteConfirmLabel">Delete chat?</span>
                            <div className="sessionMenuActions">
                              <button className="sessionMenuAction danger" onClick={() => void eraseSession(session)} type="button">
                                Delete
                              </button>
                              <button className="sessionMenuAction" onClick={() => setConfirmDeleteSession("")} type="button">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="sessionMenuActions">
                              <button
                                className="sessionMenuAction"
                                onClick={() => {
                                  setRenamingSession(session.name);
                                  setRenameDraft(session.title || session.name);
                                }}
                                type="button"
                              >
                                <PencilIcon />
                                <span>Rename</span>
                              </button>
                              <button className="sessionMenuAction danger" onClick={() => setConfirmDeleteSession(session.name)} type="button">
                                <TrashIcon />
                                <span>Delete</span>
                              </button>
                            </div>
                            <div className="sessionMenuMeta">
                              {formatSessionUpdated(session.updated)}
                              <span aria-hidden="true">·</span>
                              {formatDuration(session.duration_seconds)}
                            </div>
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              });
            if (group.collapsedByDefault) {
              return (
                <details className="sessionGroup sessionGroupCollapsible" key={group.label}>
                  <summary>{group.label}</summary>
                  {rows}
                </details>
              );
            }
            return (
              <section className="sessionGroup" key={group.label}>
                <h3>{group.label}</h3>
                {rows}
              </section>
            );
          })
        )}
        {hasMore ? (
          <div className="sessionSkeletonGroup" aria-hidden="true">
            {Array.from({ length: skeletonCount }).map((_, index) => (
              <div className="sessionSkeletonRow" key={`skeleton-${index}`}>
                <span className="sessionSkeletonBar" />
              </div>
            ))}
          </div>
        ) : null}
        {hasMore ? (
          <div
            aria-hidden="true"
            className="sessionLoadSentinel"
            ref={attachLoadMoreSentinel}
            role="presentation"
          >
            {loadingMore ? <span className="sessionLoadSpinner" /> : null}
          </div>
        ) : null}
      </div>

      <div className="sidebarBottom">
        <ProfileMenu userName={userName} userId={userId} />
      </div>
    </aside>
  );
}

const DRAWER_CHANGE_EVENT = "cottonoha:drawer-change";

function subscribeDrawer(notify: () => void): () => void {
  window.addEventListener("popstate", notify);
  window.addEventListener(DRAWER_CHANGE_EVENT, notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener(DRAWER_CHANGE_EVENT, notify);
  };
}

function snapshotDrawer(): boolean {
  return new URLSearchParams(window.location.search).get("sidebar") === "open";
}

function useDrawerState(): [boolean, (next: boolean) => void] {
  const open = useSyncExternalStore(subscribeDrawer, snapshotDrawer, () => false);

  function setOpen(next: boolean) {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    const isOpenInUrl = query.get("sidebar") === "open";
    if (next && !isOpenInUrl) {
      query.set("sidebar", "open");
      window.history.pushState(null, "", `${window.location.pathname}?${query.toString()}`);
    } else if (!next && isOpenInUrl) {
      query.delete("sidebar");
      const qs = query.toString();
      window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    } else {
      return;
    }
    // pushState/replaceState don't fire popstate, so emit our own event for the subscriber.
    window.dispatchEvent(new Event(DRAWER_CHANGE_EVENT));
  }

  return [open, setOpen];
}

function KebabIcon() {
  return (
    <svg aria-hidden="true" className="kebabIcon" viewBox="0 0 16 16">
      <circle cx="3" cy="8" r="1.5" fill="currentColor" />
      <circle cx="8" cy="8" r="1.5" fill="currentColor" />
      <circle cx="13" cy="8" r="1.5" fill="currentColor" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" className="menuActionIcon" viewBox="0 0 16 16">
      <path
        d="M11.4 2.6a1.4 1.4 0 0 1 2 2L5.6 12.4 3 13l.6-2.6 7.8-7.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="menuActionIcon" viewBox="0 0 16 16">
      <path
        d="M3.5 4.5h9M6.5 4.5V3.2c0-.4.3-.7.7-.7h1.6c.4 0 .7.3.7.7v1.3M5 4.5l.6 8.1c0 .5.4.9.9.9h3c.5 0 .9-.4.9-.9L11 4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function LanguagePicker({
  disabled,
  languageMap,
  languages,
  onSourceToggle,
  onTargetChange,
  sourceLanguages,
  targetLanguage
}: {
  disabled: boolean;
  languageMap: Map<string, Language>;
  languages: Language[];
  onSourceToggle: (code: string) => void;
  onTargetChange: (code: string) => void;
  sourceLanguages: string[];
  targetLanguage: string;
}) {
  const [openMenu, setOpenMenu] = useState<"source" | "target" | "">("");
  const [query, setQuery] = useState("");
  const [sourceDraft, setSourceDraft] = useState(sourceLanguages);
  const [targetDraft, setTargetDraft] = useState(targetLanguage);
  const triggerRef = useRef<HTMLElement | null>(null);
  const sheetCleanupRef = useRef<(() => void) | null>(null);

  const filteredLanguages = languages.filter((language) => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return `${language.code} ${language.name}`.toLowerCase().includes(needle);
  });

  function closeSheet() {
    setOpenMenu("");
    sheetCleanupRef.current?.();
    sheetCleanupRef.current = null;
    triggerRef.current?.focus();
  }

  function openSheet(menu: "source" | "target", event: React.MouseEvent<HTMLButtonElement>) {
    if (disabled) {
      return;
    }
    triggerRef.current = event.currentTarget;
    setSourceDraft(sourceLanguages);
    setTargetDraft(targetLanguage);
    setQuery("");
    setOpenMenu(menu);

    // Side effects owned by this user action — explicit setup + teardown via the cleanup ref.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSheet();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    sheetCleanupRef.current?.();
    sheetCleanupRef.current = () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }

  function toggleDraftSource(code: string) {
    if (code === targetLanguage) {
      return;
    }
    setSourceDraft((current) => {
      const next = current.includes(code)
        ? current.filter((language) => language !== code)
        : [...current, code];
      return next.length > 0 ? next : current;
    });
  }

  function clearDraftSource() {
    setSourceDraft((current) => current.slice(0, 1));
  }

  function applySheet() {
    if (openMenu === "source") {
      for (const language of languages) {
        const selected = sourceDraft.includes(language.code);
        const current = sourceLanguages.includes(language.code);
        if (selected !== current && language.code !== targetLanguage) {
          onSourceToggle(language.code);
        }
      }
    }
    if (openMenu === "target" && targetDraft !== targetLanguage) {
      onTargetChange(targetDraft);
    }
    closeSheet();
  }

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      applySheet();
      return;
    }
    if (event.key === " " && query.trim().length > 0) {
      const top = filteredLanguages.find((language) =>
        openMenu === "source" ? language.code !== targetLanguage : true
      );
      if (!top) {
        return;
      }
      event.preventDefault();
      if (openMenu === "source") {
        toggleDraftSource(top.code);
      } else {
        setTargetDraft(top.code);
      }
      setQuery("");
    }
  }

  const sheetTitle = openMenu === "source" ? "Spoken languages" : "Translate to";
  const activeSourceLabels = sourceDraft.map((code) => languageLabel(languageMap, code));
  const activeTargetLabel = languageLabel(languageMap, targetDraft);

  return (
    <>
      <button className="languageMenuButton" disabled={disabled} onClick={(event) => openSheet("source", event)} type="button">
        <span>
          <span>Spoken</span>
          <strong>{sourceLanguages.map((code) => languageLabel(languageMap, code)).join(", ")}</strong>
        </span>
      </button>
      <button className="languageMenuButton" disabled={disabled} onClick={(event) => openSheet("target", event)} type="button">
        <span>
          <span>Translate to</span>
          <strong>{languageLabel(languageMap, targetLanguage)}</strong>
        </span>
      </button>
      {openMenu ? (
        <div
          className="languageSheetBackdrop"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSheet();
          }}
        >
          <section className="languageSheet" aria-label={sheetTitle} aria-modal="true" role="dialog">
            <div className="languageSheetHeader">
              <div>
                <p className="panelKicker">{openMenu === "source" ? "Spoken" : "Target"}</p>
                <h3>{sheetTitle}</h3>
              </div>
              <button aria-label="Close language picker" className="languageSheetClose" onClick={closeSheet} type="button">
                ×
              </button>
            </div>
            <input
              aria-label="Search languages"
              autoFocus
              className="languageSearchInput"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search languages — Space to add, Enter to confirm"
              value={query}
            />
            <div className="languageSelectedChips" aria-label="Selected languages">
              {openMenu === "source"
                ? sourceDraft.map((code) => {
                    const label = languageLabel(languageMap, code);
                    const canRemove = sourceDraft.length > 1;
                    return (
                      <span className="languageSelectedChip" key={code}>
                        <span>{label}</span>
                        {canRemove ? (
                          <button
                            aria-label={`Remove ${label}`}
                            className="languageSelectedChipRemove"
                            onClick={() => toggleDraftSource(code)}
                            title="Remove"
                            type="button"
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    );
                  })
                : <span className="languageSelectedChip">{activeTargetLabel}</span>}
            </div>
            <div className="languageSheetList">
              {filteredLanguages.map((language) => {
                const checked = openMenu === "source"
                  ? sourceDraft.includes(language.code)
                  : targetDraft === language.code;
                const unavailable = openMenu === "source" && language.code === targetLanguage;
                return (
                  <label className="languageOption" key={language.code}>
                    <input
                      checked={checked}
                      disabled={unavailable}
                      name={openMenu === "target" ? "target-language-draft" : undefined}
                      onChange={() => {
                        if (openMenu === "source") {
                          toggleDraftSource(language.code);
                        } else {
                          setTargetDraft(language.code);
                        }
                      }}
                      type={openMenu === "source" ? "checkbox" : "radio"}
                    />
                    <span>{language.flag} {language.name}</span>
                  </label>
                );
              })}
            </div>
            <div className="languageSheetFooter">
              {openMenu === "source" ? (
                <button className="secondaryButton" onClick={clearDraftSource} type="button">
                  Clear
                </button>
              ) : (
                <button className="secondaryButton" onClick={closeSheet} type="button">
                  Cancel
                </button>
              )}
              <button className="primaryButton" onClick={applySheet} type="button">
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brandMark ${compact ? "compact" : ""}`} aria-hidden="true">
      <Image alt="" height={34} src="/favicon.svg" width={34} />
    </span>
  );
}

function NewChatIcon() {
  return (
    <svg aria-hidden="true" className="newChatIcon" viewBox="0 0 18 18">
      <path d="M7.5 3H4.25A1.75 1.75 0 0 0 2.5 4.75v9A1.75 1.75 0 0 0 4.25 15.5h9a1.75 1.75 0 0 0 1.75-1.75V10.5" />
      <path d="M8 10.25 13.9 4.35a1.2 1.2 0 0 1 1.7 1.7L9.7 11.95l-2.25.55L8 10.25Z" />
    </svg>
  );
}

function SidebarCollapseIcon() {
  return (
    <svg aria-hidden="true" className="sidebarToggleIcon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="5" height="14" rx="1" opacity="0.45" />
      <path d="M12 6l-3 3 3 3" />
    </svg>
  );
}

function SidebarExpandIcon() {
  return (
    <svg aria-hidden="true" className="sidebarToggleIcon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="11" y="2" width="5" height="14" rx="1" opacity="0.45" />
      <path d="M6 6l3 3-3 3" />
    </svg>
  );
}

function RecentsIcon() {
  return (
    <svg aria-hidden="true" className="sidebarToggleIcon" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="7" />
      <path d="M9 5.5V9l2.5 2.5" />
    </svg>
  );
}

function SpeakerNameDialog({
  draft,
  onCancel,
  onChange,
  onSave
}: {
  draft: SpeakerEditorDraft;
  onCancel: () => void;
  onChange: (draft: SpeakerEditorDraft) => void;
  onSave: () => void;
}) {
  return (
    <div className="speakerDialogBackdrop" role="presentation">
      <div aria-modal="true" className="speakerDialog" role="dialog">
        <div className="speakerDialogHeader">
          <p className="panelKicker">speaker</p>
          <h3>Name this person</h3>
        </div>
        <label className="contextField">
          Full name
          <input
            autoFocus
            onChange={(event) => {
              const fullName = event.target.value;
              onChange({
                ...draft,
                fullName,
                initials: initialsFromSpeakerName(fullName, draft.speakerId)
              });
            }}
            placeholder={fallbackSpeakerLabel(draft.speakerId)}
            value={draft.fullName}
          />
        </label>
        <label className="contextField speakerInitialsField">
          Initials
          <input
            maxLength={3}
            onChange={(event) => onChange({ ...draft, initials: normalizeInitials(event.target.value) })}
            value={draft.initials}
          />
        </label>
        <div className="speakerDialogActions">
          <button className="secondaryButton compactButton" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primaryButton compactButton" onClick={onSave} type="button">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function languageLabel(languageMap: Map<string, Language>, code: string): string {
  const language = languageMap.get(code);
  return language ? `${language.flag} ${language.name}` : code.toUpperCase();
}

function transcriptTitle(sourceLanguages: string[], targetLanguage: string, languageMap: Map<string, Language>): string {
  const spoken = sourceLanguages.map((code) => compactLanguageLabel(languageMap, code)).join(", ");
  const target = compactLanguageLabel(languageMap, targetLanguage);
  return `${spoken || "Spoken"} → ${target}`;
}

function transcriptShortTitle(sourceLanguages: string[], targetLanguage: string, languageMap: Map<string, Language>): string {
  const spoken = sourceLanguages.map((code) => languageShortLabel(code, languageMap)).join(", ");
  const target = languageShortLabel(targetLanguage, languageMap);
  return `${spoken || "SRC"} → ${target}`;
}

function compactLanguageLabel(languageMap: Map<string, Language>, code: string): string {
  const language = languageMap.get(code);
  return language ? `${language.flag} ${language.name}` : code.toUpperCase();
}

function collectLeftLanguageOptions(
  configuredSources: string[],
  phrases: Phrase[],
  targetLanguage: string,
  languageMap: Map<string, Language>
): Array<{ code: string; flag: string; name: string }> {
  const codes: string[] = [];
  function add(code: string | null | undefined) {
    const clean = (code || "").trim().toLowerCase();
    if (!clean || clean === ENGLISH_LANGUAGE || clean === targetLanguage || codes.includes(clean)) {
      return;
    }
    codes.push(clean);
  }
  configuredSources.forEach(add);
  for (const phrase of phrases) {
    add(phrase.source_lang);
    for (const code of Object.keys(phrase.texts)) {
      add(code);
    }
  }
  return codes.map((code) => {
    const language = languageMap.get(code);
    return {
      code,
      flag: language?.flag || "🌐",
      name: language?.name || code.toUpperCase()
    };
  });
}

function resolveLeftLanguageSelection(
  selection: LeftLanguageSelection,
  options: Array<{ code: string }>,
  configuredSources: string[],
  targetLanguage: string
): string {
  if (selection !== "all" && options.some((option) => option.code === selection)) {
    return selection;
  }
  const configured = configuredSources.find((code) => code !== ENGLISH_LANGUAGE && code !== targetLanguage);
  if (configured) {
    return configured;
  }
  return options[0]?.code || "ja";
}

function phraseReadyForSlowMode(
  phrase: Phrase,
  adaptations: Record<string, PhraseAdaptation>,
  leftTargetLanguage: string,
  leftSelection: LeftLanguageSelection,
  rightTargetLanguage: string
): boolean {
  const sourceLanguage = phrase.source_lang || firstNonEnglishTextLanguage(phrase);
  if (!sourceLanguage) {
    return true;
  }
  const requiredTargets = dedupeList([
    sourceLanguage === rightTargetLanguage ? leftTargetLanguage : rightTargetLanguage,
    leftSelection === "all" || sourceLanguage === leftTargetLanguage ? "" : leftTargetLanguage
  ]).filter((target) => target && target !== sourceLanguage && !phrase.texts[target]?.trim());
  for (const target of requiredTargets) {
    const adaptation = adaptations[adaptationKey(phrase, target)];
    if (adaptation?.status !== "ready" && adaptation?.status !== "error") {
      return false;
    }
  }
  return true;
}

function groupDisplayPhrases(phrases: Phrase[]): Phrase[][] {
  const groups: Phrase[][] = [];
  for (const phrase of phrases) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    if (current && previous && shouldShareDisplayBubble(previous, phrase)) {
      current.push(phrase);
    } else {
      groups.push([phrase]);
    }
  }
  return groups;
}

function shouldShareDisplayBubble(previous: Phrase, next: Phrase): boolean {
  if (speakerKey(previous.speaker) !== speakerKey(next.speaker)) {
    return false;
  }
  if (displaySourceLanguage(previous) !== displaySourceLanguage(next)) {
    return false;
  }
  const previousSeconds = phraseSeconds(previous);
  const nextSeconds = phraseSeconds(next);
  if (previousSeconds === null || nextSeconds === null) {
    return true;
  }
  return Math.max(0, nextSeconds - previousSeconds) <= DISPLAY_GROUP_PAUSE_SECONDS;
}

function displaySourceLanguage(phrase: Phrase): string {
  return phrase.source_lang || firstNonEnglishTextLanguage(phrase) || "";
}

function phraseSeconds(phrase: Phrase): number | null {
  if (typeof phrase.time === "number") {
    return phrase.time > 10_000 ? phrase.time / 1000 : phrase.time;
  }
  if (typeof phrase.time === "string") {
    const value = Number.parseFloat(phrase.time);
    if (Number.isFinite(value)) {
      return value > 10_000 ? value / 1000 : value;
    }
  }
  return null;
}

function dedupeList(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function recentDialogueForRewrite(
  phrases: Phrase[],
  adaptations: Record<string, PhraseAdaptation>,
  currentKey: string,
  targetLanguage: string
): Array<{ speaker: string; english?: string; target?: string; target_language: string }> {
  const turns: Array<{ speaker: string; english?: string; target?: string; target_language: string }> = [];
  for (const phrase of phrases) {
    const key = adaptationKey(phrase, targetLanguage);
    if (key === currentKey) {
      break;
    }
    const adaptation = adaptations[key];
    const english = phrase.texts.en?.trim();
    const target = phrase.texts[targetLanguage]?.trim();
    const adaptedEnglish = adaptation?.status === "ready" && adaptation.source_rewrite
      ? adaptation.source_rewrite
      : english;
    if (adaptedEnglish || target) {
      turns.push({
        speaker: phrase.speaker_label || "Unknown",
        english: adaptedEnglish,
        target,
        target_language: targetLanguage
      });
    }
  }
  return turns.slice(-10);
}

function formatTranscriptStats(stats: { durationSeconds: number | null }): string {
  return formatDuration(stats.durationSeconds);
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) {
    return "0s";
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m${String(rest).padStart(2, "0")}s`;
  }
  return `${rest}s`;
}

function durationFromPhrases(phrases: Phrase[]): number | null {
  let maxSeconds = 0;
  for (const phrase of phrases) {
    const value = phrase.time;
    if (typeof value === "number") {
      maxSeconds = Math.max(maxSeconds, value > 10_000 ? value / 1000 : value);
    }
  }
  return maxSeconds > 0 ? Math.round(maxSeconds) : null;
}

function countPhraseWords(phrases: Phrase[]): number {
  return phrases.reduce((count, phrase) => {
    const sourceText = phrase.source_lang ? phrase.texts[phrase.source_lang] : "";
    const text = sourceText || Object.values(phrase.texts).find(Boolean) || "";
    return count + countWords(text);
  }, 0);
}

function countWords(text: string): number {
  const latinWords = text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g)?.length || 0;
  const kanaKanjiRuns = text.match(/[\u3040-\u30ff\u3400-\u9fff]+/g)?.length || 0;
  return latinWords + kanaKanjiRuns;
}

function buildContextBundle(
  baseContext: string,
  presetId: string,
  deeplFormality: DeepLFormality,
  profile: TravelerProfile,
  placeContext: SessionPlaceContext,
  languageScope: string[]
): ContextBundle {
  const now = new Date();
  const hour = now.getHours();
  const timeContext = hour < 5 ? "late night" : hour < 11 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const preset = getAudiencePreset(presetId);
  const intent = preset.intent;
  const includeJapaneseContext = languageScope.includes("ja");
  const effectiveFormality = effectiveDeepLFormality(deeplFormality, preset);
  const inferredPoi = placeContext.poi_type.trim() || inferPoiType(intent);
  const locationEntries = locationGeneralEntries(placeContext.location_context);
  const general = compactGeneral([
    { key: "domain", value: includeJapaneseContext ? "Travel conversation in Japan" : "Travel conversation" },
    { key: "session_intent", value: intent },
    { key: "setting", value: inferredPoi },
    { key: "local_time", value: timeContext },
    { key: "date", value: now.toISOString().slice(0, 10) },
    placeContext.location_hint ? { key: "location", value: placeContext.location_hint } : null,
    profileWesternFullName(profile) ? { key: "traveler_name", value: profileWesternFullName(profile) } : null,
    includeJapaneseContext && profile.first_name_katakana.trim()
      ? { key: "traveler_first_name_katakana", value: profile.first_name_katakana.trim() }
      : null,
    includeJapaneseContext && profile.last_name_katakana.trim()
      ? { key: "traveler_last_name_katakana", value: profile.last_name_katakana.trim() }
      : null,
    includeJapaneseContext && profileKatakanaFullDisplay(profile)
      ? { key: "traveler_name_katakana", value: profileKatakanaFullDisplay(profile) }
      : null,
    profile.age ? { key: "traveler_age", value: profile.age } : null,
    profile.hotel ? { key: "hotel", value: profile.hotel } : null,
    profile.travel_party ? { key: "travel_party", value: profile.travel_party } : null,
    profile.allergies ? { key: "dietary_restrictions", value: profile.allergies } : null,
    profile.spice_level ? { key: "spice_preference", value: profile.spice_level } : null,
    profile.mobility ? { key: "mobility_or_luggage", value: profile.mobility } : null,
    ...locationEntries
  ]);
  const terms = rankedTerms([
    ...splitListText(profileWesternFullName(profile)),
    ...splitListText(profile.first_name_katakana),
    ...splitListText(profile.last_name_katakana),
    ...splitListText(profileKatakanaFullDisplay(profile)),
    ...splitListText(profile.hotel),
    ...splitListText(profile.travel_party),
    ...splitListText(profile.allergies),
    ...splitListText(profile.mobility),
    ...splitListText(profile.saved_places),
    ...splitListText(profile.nearby_places),
    ...splitListText(placeContext.places),
    ...splitListText(placeContext.terms),
    ...(includeJapaneseContext ? baseTermsForIntent(intent, inferredPoi) : [])
  ]);
  const translationTerms = dedupeTranslationTerms([
    ...parseTranslationTerms(placeContext.translation_preferences),
    ...(includeJapaneseContext ? baseTranslationTermsForIntent(intent, inferredPoi) : [])
  ]).slice(0, 20);
  const text = [
    stripProfileBlock(stripRegisterBlock(baseContext)).trim(),
  ].filter(Boolean).join("\n");
  const soniox: SonioxStructuredContext = {
    general,
    terms,
    translation_terms: translationTerms,
    text
  };
  return {
    soniox,
    rewriteTone: {
      purpose: "Adapt what the English speaker said into socially natural wording for downstream live translation.",
      audience: preset.label,
      register: preset.register,
      behavior: preset.behavior,
      deepl_formality: effectiveFormality,
      session_intent: intent,
      setting: inferredPoi,
      traveler_profile: {
        name: profileWesternFullName(profile),
        given_name_katakana: profile.first_name_katakana.trim() || undefined,
        family_name_katakana: profile.last_name_katakana.trim() || undefined,
        name_katakana: profileKatakanaFullDisplay(profile) || undefined,
        age: profile.age,
        hotel: profile.hotel,
        travel_party: profile.travel_party,
        dietary_restrictions: profile.allergies,
        spice_preference: profile.spice_level,
        mobility_or_luggage: profile.mobility
      },
      user_notes: stripProfileBlock(stripRegisterBlock(baseContext)).trim(),
      rule: "Rewrite for spoken tone and relationship. Keep it concise. Preserve meaning, but do not translate literally."
    }
  };
}

function mergeListText(current: string, additions: string[]): string {
  const values = [
    ...current.split(/[,;\n]/).map((value) => value.trim()),
    ...additions
  ].filter(Boolean);
  return Array.from(new Set(values)).join(", ");
}

function mergeLineText(current: string, additions: string[]): string {
  const values = [
    ...current.split(/\n/).map((value) => value.trim()),
    ...additions
  ].filter(Boolean);
  return Array.from(new Set(values)).join("\n");
}

function splitListText(value?: string): string[] {
  return (value || "").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
}

function compactGeneral(entries: Array<ContextGeneralEntry | null>): ContextGeneralEntry[] {
  const seen = new Set<string>();
  const result: ContextGeneralEntry[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    const key = entry.key.trim();
    const value = entry.value.trim();
    const id = `${key}:${value}`;
    if (!key || !value || seen.has(id)) continue;
    seen.add(id);
    result.push({ key, value });
  }
  return result.slice(0, 15);
}

function locationGeneralEntries(value: string): ContextGeneralEntry[] {
  return value.split(/\n/).map((line) => line.trim()).filter(Boolean).slice(0, 8).map((line) => {
    if (line.startsWith("Nearby POI:")) {
      return { key: "nearby_place", value: line.replace("Nearby POI:", "").trim() };
    }
    if (line.startsWith("Nearby address:")) {
      return { key: "nearby_address", value: line.replace("Nearby address:", "").trim() };
    }
    return { key: "location_note", value: line };
  });
}

function rankedTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    const term = value.trim();
    if (!term || term.length < 2 || GENERIC_TERMS.has(term.toLowerCase()) || seen.has(term.toLowerCase())) {
      continue;
    }
    seen.add(term.toLowerCase());
    terms.push(term);
  }
  return terms.slice(0, 40);
}

function parseTranslationTerms(value?: string): ContextTranslationTerm[] {
  return (value || "").split(/[;\n]/).map((raw) => {
    const [source, target] = raw.split(/\s*(?:->|=>|→)\s*/);
    return source && target ? { source: source.trim(), target: target.trim() } : null;
  }).filter((item): item is ContextTranslationTerm => Boolean(item));
}

function dedupeTranslationTerms(values: ContextTranslationTerm[]): ContextTranslationTerm[] {
  const seen = new Set<string>();
  const result: ContextTranslationTerm[] = [];
  for (const value of values) {
    const source = value.source.trim();
    const target = value.target.trim();
    const id = `${source.toLowerCase()}->${target.toLowerCase()}`;
    if (!source || !target || seen.has(id)) continue;
    seen.add(id);
    result.push({ source, target });
  }
  return result;
}

function baseTermsForIntent(intent: SessionIntent, poi: string): string[] {
  const signal = `${intent} ${poi}`;
  if (signal.includes("train") || signal.includes("station")) return ["改札", "乗り換え", "終電", "ホーム", "乗り場", "出口"];
  if (signal.includes("restaurant")) return ["予約", "お会計", "アレルギー", "卵", "小麦", "ナッツ"];
  if (signal.includes("hotel")) return ["予約名", "荷物預かり", "チェックイン", "チェックアウト"];
  if (signal.includes("shrine") || signal.includes("temple")) return ["御朱印", "お守り", "おみくじ", "鳥居"];
  return [];
}

function baseTranslationTermsForIntent(intent: SessionIntent, poi: string): ContextTranslationTerm[] {
  const signal = `${intent} ${poi}`;
  if (signal.includes("train") || signal.includes("station")) {
    return [
      { source: "platform", target: "ホーム / 乗り場" },
      { source: "ticket gate", target: "改札" },
      { source: "last train", target: "終電" }
    ];
  }
  if (signal.includes("restaurant")) {
    return [
      { source: "check/bill", target: "お会計" },
      { source: "no meat/fish broth", target: "肉や魚の出汁もなし" }
    ];
  }
  if (signal.includes("hotel")) return [{ source: "leave luggage", target: "荷物を預ける" }];
  if (signal.includes("shrine") || signal.includes("temple")) {
    return [
      { source: "goshuin", target: "御朱印" },
      { source: "amulet", target: "お守り" }
    ];
  }
  return [];
}

function getAudiencePreset(presetId: string): typeof AUDIENCE_PRESETS[number] {
  return AUDIENCE_PRESETS.find((item) => item.id === presetId) || AUDIENCE_PRESETS[0];
}

function effectiveDeepLFormality(
  value: DeepLFormality,
  preset: typeof AUDIENCE_PRESETS[number]
): Exclude<DeepLFormality, "auto"> {
  return value === "auto" ? preset.deeplFormality : value;
}

function formalityLabel(value: Exclude<DeepLFormality, "auto">): string {
  if (value === "more") return "polite";
  if (value === "less") return "plain";
  return "default";
}

function normalizeSourceLanguagesForTarget(sourceLanguages: string[], targetLanguage: string): string[] {
  const sources = Array.from(new Set(sourceLanguages.filter((code) => code && code !== targetLanguage)));
  if (sources.length > 0) {
    return sources;
  }
  return [targetLanguage === "en" ? "ja" : "en"];
}

function englishOverdubTargetLanguage(sourceLanguages: string[], targetLanguage: string): string {
  if (targetLanguage && targetLanguage !== ENGLISH_LANGUAGE) {
    return targetLanguage;
  }
  return sourceLanguages.find((code) => code && code !== ENGLISH_LANGUAGE) || "ja";
}

function languageShortLabel(code: string, languageMap: Map<string, Language>): string {
  return languageMap.get(code)?.code.toUpperCase() || code.toUpperCase();
}

function directionLabel(direction: RealtimeDirection): string {
  return direction === "english_to_target" ? "English to target" : "target to English";
}

function statusLabel(status: AppStatus): string {
  if (status === "requesting microphone") return "Waiting for microphone permission";
  if (status === "connecting") return "Connecting";
  if (status === "listening") return "Live";
  if (status === "stopping") return "Stopping";
  if (status === "stopped") return "Stopped";
  if (status === "error") return "Needs attention";
  return "Idle";
}

function friendlyErrorMessage(message: string): string {
  const value = message.trim();
  if (!value) {
    return "";
  }
  if (/not supported/i.test(value)) {
    return "Realtime is not available in this browser or backend configuration. Try Chrome, allow microphone access, and confirm the backend has OpenAI realtime credentials.";
  }
  if (/permission|denied|notallowed/i.test(value)) {
    return "Microphone permission was blocked. Enable microphone access in your browser settings, then start again.";
  }
  if (/client secret|OpenAI realtime/i.test(value)) {
    return `${value} Check OPENAI_API_KEY and the realtime session endpoint on the backend.`;
  }
  if (/WebSocket|FastAPI|backend/i.test(value)) {
    return `${value} Confirm the backend is running and reachable, then try again.`;
  }
  return value;
}

function formatSessionUpdated(updated: string | null | undefined): string {
  if (!updated) {
    return "Recent";
  }
  const date = new Date(updated);
  if (Number.isNaN(date.getTime())) {
    return "Recent";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function inferPoiType(intent: SessionIntent): string {
  if (intent === "restaurant") return "restaurant";
  if (intent === "train") return "train station";
  if (intent === "family") return "family or in-law home";
  if (intent === "shopping") return "shop";
  if (intent === "doctor") return "clinic or hospital";
  return "travel conversation";
}

function stripProfileBlock(value: string): string {
  const start = value.indexOf("[Traveler profile]");
  const end = value.indexOf("[/Traveler profile]");
  if (start === -1 || end === -1 || end < start) return value;
  return `${value.slice(0, start)}${value.slice(end + "[/Traveler profile]".length)}`.trim();
}

function stripRegisterBlock(value: string): string {
  const start = value.indexOf(REGISTER_BLOCK_START);
  const end = value.indexOf(REGISTER_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    return value;
  }
  return `${value.slice(0, start)}${value.slice(end + REGISTER_BLOCK_END.length)}`.trim();
}

function isDeepLFormality(value: string | null): value is DeepLFormality {
  return value === "auto" || value === "more" || value === "less" || value === "default";
}

function dedupeTail(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values.slice().reverse()) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.unshift(clean);
    if (result.length >= limit) break;
  }
  return result;
}

const MONTH_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart.getTime() - 24 * 60 * 60 * 1000;
  const sevenDaysStart = todayStart.getTime() - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysStart = todayStart.getTime() - 30 * 24 * 60 * 60 * 1000;

  const fixedOrder: string[] = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days"];
  const buckets = new Map<string, SessionSummary[]>();
  const monthLabels: string[] = [];

  for (const session of [...sessions].sort((a, b) => sessionUpdatedMs(b) - sessionUpdatedMs(a))) {
    const updated = session.updated ? new Date(session.updated).getTime() : 0;
    let label: string;
    if (updated >= todayStart.getTime()) {
      label = "Today";
    } else if (updated >= yesterdayStart) {
      label = "Yesterday";
    } else if (updated >= sevenDaysStart) {
      label = "Previous 7 days";
    } else if (updated >= thirtyDaysStart) {
      label = "Previous 30 days";
    } else {
      label = MONTH_FORMATTER.format(new Date(updated || Date.now()));
      if (!monthLabels.includes(label)) monthLabels.push(label);
    }
    buckets.set(label, [...(buckets.get(label) || []), session]);
  }

  const ordered: SessionGroup[] = [];
  for (const label of fixedOrder) {
    const rows = buckets.get(label);
    if (rows && rows.length > 0) ordered.push({ label, sessions: rows });
  }
  for (const label of monthLabels) {
    const rows = buckets.get(label);
    if (rows && rows.length > 0) ordered.push({ label, sessions: rows, collapsedByDefault: true });
  }
  return ordered;
}

function sessionUpdatedMs(session: SessionSummary): number {
  if (!session.updated) {
    return 0;
  }
  const updated = new Date(session.updated).getTime();
  return Number.isFinite(updated) ? updated : 0;
}

function limitSessionGroups(groups: SessionGroup[], limit: number): SessionGroup[] {
  let remaining = limit;
  const visible: SessionGroup[] = [];
  for (const group of groups) {
    if (remaining <= 0) {
      break;
    }
    const sessions = group.sessions.slice(0, remaining);
    if (sessions.length > 0) {
      visible.push({ label: group.label, sessions });
      remaining -= sessions.length;
    }
  }
  return visible;
}

function countGroupedSessions(groups: SessionGroup[]): number {
  return groups.reduce((count, group) => count + group.sessions.length, 0);
}
