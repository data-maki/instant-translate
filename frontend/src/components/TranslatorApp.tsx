"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { SignOutButton } from "@/components/SignOutButton";
import {
  adaptPhrase,
  createRealtimeTranslationSession,
  deleteSession as deleteSavedSession,
  fetchPlacesContext,
  fetchSessionDetail,
  fetchSessions,
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
  DEFAULT_PROFILE,
  loadTravelerProfile,
  profileKatakanaFullDisplay,
  profileWesternFullName,
  TravelerProfile
} from "@/lib/profile";

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
const ENGLISH_LANGUAGE = "en";

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

type PhraseAdaptation = {
  source_rewrite: string;
  target_translation?: string;
  status: "loading" | "ready" | "error";
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
const DISPLAY_GROUP_PAUSE_SECONDS = 10;
const INITIAL_SESSION_LIMIT = 8;
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
};

const SPEAKER_COLORS = [
  "#BC002D",
  "#b45f2a",
  "#315f9c",
  "#8a4f9f",
  "#b23b53",
  "#5d6f2f",
  "#2f7f86",
  "#9a6a1f"
];

export type TranslatorAppProps = {
  initialLanguages?: Language[];
  initialLoadError?: string;
  initialSessionTotal?: number;
  initialSessions?: SessionSummary[];
  initialSourceLanguages?: string[];
  initialTargetLanguage?: string;
};

export function TranslatorApp({
  initialLanguages = [],
  initialLoadError = "",
  initialSessionTotal,
  initialSessions = [],
  initialSourceLanguages = ["ja"],
  initialTargetLanguage = "en"
}: TranslatorAppProps) {
  const [languages] = useState<Language[]>(initialLanguages);
  const [sourceALanguages, setSourceALanguages] = useState(() =>
    normalizeSourceLanguagesForTarget(initialSourceLanguages, initialTargetLanguage)
  );
  const [sourceB, setSourceB] = useState(initialTargetLanguage);
  const [expectedSpeakerCount, setExpectedSpeakerCount] = useState("2");
  const [audiencePreset, setAudiencePreset] = useState(DEFAULT_AUDIENCE_PRESET);
  const [deeplFormality, setDeepLFormality] = useState<DeepLFormality>("auto");
  const [context, setContext] = useState("");
  const [travelerProfile, setTravelerProfile] = useState<TravelerProfile>(DEFAULT_PROFILE);
  const [sessionPlaceContext, setSessionPlaceContext] = useState<SessionPlaceContext>(DEFAULT_SESSION_PLACE_CONTEXT);
  const [geoStatus, setGeoStatus] = useState("");
  const selectedPreset = getAudiencePreset(audiencePreset);
  const sessionIntent = selectedPreset.intent;
  const contextBundle = useMemo(
    () => buildContextBundle(context, audiencePreset, deeplFormality, travelerProfile, sessionPlaceContext),
    [context, audiencePreset, deeplFormality, travelerProfile, sessionPlaceContext]
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
  const [openAIRealtimeEnabled, setOpenAIRealtimeEnabled] = useState(false);
  const [transcriptLatencyMode, setTranscriptLatencyMode] = useState<TranscriptLatencyMode>("fast");
  const [leftLanguageSelection, setLeftLanguageSelection] = useState<LeftLanguageSelection>("all");
  const [typedText, setTypedText] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>(initialSessions);
  const [sessionTotal, setSessionTotal] = useState(initialSessionTotal ?? initialSessions.length);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [loadingSession, setLoadingSession] = useState("");
  const [micCaptureEnabled, setMicCaptureEnabled] = useState(true);
  const [englishToTargetOverdubEnabled, setEnglishToTargetOverdubEnabled] = useState(true);
  const [targetToEnglishOverdubEnabled, setTargetToEnglishOverdubEnabled] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const audioPlayerRef = useRef<PcmAudioPlayer | null>(null);
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
  const visibleSessionGroups = useMemo(() => {
    if (sessionsExpanded) {
      return sessionGroups;
    }
    return limitSessionGroups(sessionGroups, 8);
  }, [sessionGroups, sessionsExpanded]);
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedFormality = window.localStorage.getItem(DEEPL_FORMALITY_STORAGE_KEY);
      if (isDeepLFormality(savedFormality)) {
        setDeepLFormality(savedFormality);
      }
      setTravelerProfile(loadTravelerProfile());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
    void saveSessionAdaptation({ sessionName, key, adaptation }).catch(() => {
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
        })
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
      })
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
        })
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
    setError("");
    setSavedPath("");
    setActiveSessionSynced("");
    setActiveSessionTitle("New chat");
    setRediarizeStatus("");
    setTranslationStatus("");
    setReviewStatus("");
    setSpeakerDrafts({});
    setEditingSpeaker(null);
    setSpeakerEditorDraft(null);
    setPhrases([]);
    resetAdaptations();
    clearProviderSignals();
    clearRealtimeCaptionDrafts();
    setTokenCount(0);
    setActiveDurationSeconds(0);
    startDurationTimer(Date.now());
    shouldFollowFeedRef.current = true;
    setStatus("requesting microphone");

    try {
      if (forceRealtime) {
        await startRealtimeOverdub();
        await startRealtimeTranscriptBridge();
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
      const socket = new WebSocket(websocketUrl());
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            type: "start",
            session_name: "",
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
    if (enabled && showOnboarding && canStart && hasLanguagePair) {
      void start(true);
    }
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

  async function startRealtimeTranscriptBridge() {
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

    const socket = new WebSocket(websocketUrl());
    socket.binaryType = "arraybuffer";
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "start",
          session_name: "",
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
    const secret = await createRealtimeTranslationSession({ target_language: targetLanguage });
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
      const result = await fetchSessions({ limit: sessionsExpanded ? undefined : INITIAL_SESSION_LIMIT });
      setSessions(result.sessions);
      setSessionTotal(result.total);
    } catch {
      // The main health/language load already exposes backend connection errors.
    }
  }

  async function toggleSessionsExpanded() {
    if (!sessionsExpanded && sessions.length < sessionTotal) {
      try {
        const result = await fetchSessions();
        setSessions(result.sessions);
        setSessionTotal(result.total);
      } catch {
        // Keep the compact list if the history refresh fails.
      }
    }
    setSessionsExpanded((current) => !current);
  }

  async function loadSession(name: string) {
    if (isLive) {
      return;
    }
    setError("");
    setLoadingSession(name);
    try {
      const detail = sessionDetailCacheRef.current[name] || await fetchSessionDetail(name);
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
      const result = await renameSavedSession(name, cleanTitle);
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
      const result = await deleteSavedSession(name);
      delete sessionDetailCacheRef.current[result.name];
      setSessions((current) => current.filter((session) => session.name !== result.name));
      if (activeSession === result.name) {
        newSession();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete chat.");
    }
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
    setGeoStatus("");
    shouldFollowFeedRef.current = true;
    setStatus("idle");
    setSessionsOpen(false);
  }

  function injectCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("Location unavailable in this browser.");
      return;
    }
    setGeoStatus("Fetching location...");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude.toFixed(5);
        const lng = position.coords.longitude.toFixed(5);
        setSessionPlaceContext((current) => ({ ...current, location_hint: `${lat}, ${lng}` }));
        setGeoStatus("Location added. Loading nearby places...");
        try {
          const placesContext = await fetchPlacesContext({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            intent: sessionIntent,
            poi_type: sessionPlaceContext.poi_type
          });
          setSessionPlaceContext((current) => ({
            ...current,
            location_hint: `${lat}, ${lng}`,
            location_context: mergeLineText(current.location_context, placesContext.general),
            places: mergeListText(current.places, placesContext.places),
            terms: mergeListText(current.terms, placesContext.terms),
            translation_preferences: mergeListText(current.translation_preferences, placesContext.translation_terms)
          }));
          setGeoStatus(placesContext.places.length ? "Nearby places added." : "Location added; no nearby places found.");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not load nearby places.";
          setGeoStatus(message);
        }
      },
      () => setGeoStatus("Location permission blocked. Enable it in browser settings or continue without location."),
      { enableHighAccuracy: false, timeout: 8000 }
    );
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
      setActiveSessionTitle(message.session.title || "New chat");
      setTokenCount(message.session.token_count);
      return;
    }
    if (message.type === "transcript") {
      if (openAIRealtimeEnabled) {
        sonioxRealtimePhraseCountRef.current = message.phrases.length;
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
      setActiveSessionTitle(message.title || "New chat");
      setSavedPath(message.path);
      setPhrasesAndFollow(message.phrases);
      clearProviderSignals();
      setTokenCount(message.token_count);
      setActiveDurationSeconds(durationFromPhrases(message.phrases));
      stopDurationTimer();
      refreshSessions();
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
    if (openAIRealtimeEnabled) {
      cleanup();
      setStatus("stopped");
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

  async function improveSpeakersAndTranslations() {
    if (!activeSession) {
      return;
    }
    setError("");
    setImprovingAll(true);
    setRediarizing(true);
    setTranslating(false);
    setRediarizeStatus("Improving speakers...");
    setTranslationStatus("");
    try {
      const speakerResult = await rediarizeSession(activeSession);
      resetAdaptations();
      setPhrasesAndFollow(speakerResult.phrases);
      setTokenCount(speakerResult.token_count);
      setSavedPath(speakerResult.path);
      setRediarizeStatus(`Improved: ${speakerResult.speaker_count} speakers`);

      setRediarizing(false);
      setTranslating(true);
      setTranslationStatus("Improving translations...");
      const translationResult = await retranslateSession(activeSession);
      resetAdaptations();
      setPhrasesAndFollow(translationResult.phrases);
      setTokenCount(translationResult.token_count);
      setSavedPath(translationResult.path);
      setTranslationStatus(`Improved: ${translationResult.translation_count} translations`);
      setReviewStatus("Ready for speaker review");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not improve transcript.");
    } finally {
      setRediarizing(false);
      setTranslating(false);
      setImprovingAll(false);
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
      <section className="workspace">
        <button
          aria-label="Close sessions"
          className={`sessionBackdrop ${sessionsOpen ? "open" : ""}`}
          onClick={() => setSessionsOpen(false)}
          type="button"
        />
        <SessionSidebar
          activeSession={activeSession}
          activeSessionTitle={activeSessionTitle}
          expanded={sessionsExpanded}
          groups={visibleSessionGroups}
          hasMore={sessionTotal > countGroupedSessions(visibleSessionGroups)}
          isOpen={sessionsOpen}
          loadingSession={loadingSession}
          onClose={() => setSessionsOpen(false)}
          onDelete={deleteSessionByName}
          onLoad={loadSession}
          onNew={newSession}
          onRename={renameSessionTitle}
          onToggleExpanded={() => void toggleSessionsExpanded()}
          total={sessionTotal}
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
              <TranscriptTitle languageMap={languageMap} sourceLanguages={sourceALanguages} targetLanguage={sourceB} />
            </div>
            <div className="transcriptMeta">
              <label
                className={`realtimeToggle ${openAIRealtimeEnabled ? "active" : ""}`}
                title="Use GPT realtime translation candidates"
              >
                <input
                  checked={openAIRealtimeEnabled}
                  disabled={isLive}
                  onChange={(event) => changeRealtimeEnabled(event.target.checked)}
                  type="checkbox"
                />
                <span className="realtimeSwitch" aria-hidden="true">
                  <span />
                </span>
                <span>GPT realtime</span>
              </label>
              <span className="tokenCount">{formatTranscriptStats(transcriptStats)}</span>
              {postProcessing && (reviewStatus || translationStatus || rediarizeStatus) ? (
                <span className="compactStatus">{reviewStatus || translationStatus || rediarizeStatus}</span>
              ) : null}
              {hasFinishedSession ? (
                <button className="secondaryButton compactButton" disabled={postProcessing} onClick={improveSpeakersAndTranslations} type="button">
                  {postProcessing ? "Improving..." : "Improve"}
                </button>
              ) : null}
            </div>
          </div>
          {showOnboarding ? (
            <div className="languageRail" aria-label="Transcript languages">
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
          ) : null}
          {showOnboarding && openAIRealtimeEnabled ? (
            <RealtimeStartPanel
              canStart={canStart && hasLanguagePair}
              disabled={isLive}
              error={error}
              onStart={() => start(true)}
            />
          ) : showOnboarding ? (
            <ConversationOnboarding
              audiencePreset={audiencePreset}
              canStart={canStart && hasLanguagePair}
              context={context}
              deeplFormality={deeplFormality}
              disabled={isLive}
              error={error}
              expectedSpeakerCount={expectedSpeakerCount}
              geoStatus={geoStatus}
              onAudienceChange={changeAudiencePreset}
              onContextChange={setContext}
              onContextExample={appendContextExample}
              onDeepLFormalityChange={changeDeepLFormality}
              onLocation={injectCurrentLocation}
              onSpeakerCountChange={setExpectedSpeakerCount}
              onStart={() => start(false)}
              preset={selectedPreset}
            />
          ) : error ? (
            <FeedbackBanner message={error} />
          ) : null}
          {phrases.length > 0 && !openAIRealtimeEnabled ? (
            <ChatDisplayToggle
              enhanced={showEnhancedEnglish}
              latencyMode={transcriptLatencyMode}
              leftLanguageOptions={leftLanguageOptions}
              leftLanguageSelection={leftLanguageSelection}
              onEnhancedChange={setShowEnhancedEnglish}
              onLeftLanguageChange={changeLeftLanguageSelection}
              onLatencyModeChange={setTranscriptLatencyMode}
            />
          ) : null}
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
                  leftLanguageSelection={leftLanguageSelection}
                  languageMap={languageMap}
                  onEditSpeaker={openSpeakerEditor}
                  phrases={phraseGroup}
                  speakerDrafts={speakerDrafts}
                  showEnhancedEnglish={showEnhancedEnglish}
                  targetLanguage={sourceB}
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
          {!showOnboarding ? (
            <ComposerBar
              canStart={canStart && hasLanguagePair}
              englishTargetLabel={languageShortLabel(englishOverdubTargetLanguage(sourceALanguages, sourceB), languageMap)}
              englishToTargetOverdubEnabled={englishToTargetOverdubEnabled}
              isLive={isLive}
              micCaptureEnabled={micCaptureEnabled}
              onStart={() => start(openAIRealtimeEnabled)}
              onStop={stop}
              onSubmit={submitTypedText}
              onToggleEnglishToTarget={() => toggleRealtimeDirection("english_to_target")}
              onToggleMicCapture={toggleMicCapture}
              onToggleTargetToEnglish={() => toggleRealtimeDirection("target_to_english")}
              openAIRealtimeEnabled={openAIRealtimeEnabled}
              targetToEnglishOverdubEnabled={targetToEnglishOverdubEnabled}
              text={typedText}
              onTextChange={setTypedText}
            />
          ) : null}
        </section>
      </section>
    </main>
  );
}

function ChatDisplayToggle({
  enhanced,
  latencyMode,
  leftLanguageOptions,
  leftLanguageSelection,
  onEnhancedChange,
  onLeftLanguageChange,
  onLatencyModeChange
}: {
  enhanced: boolean;
  latencyMode: TranscriptLatencyMode;
  leftLanguageOptions: Array<{ code: string; flag: string; name: string }>;
  leftLanguageSelection: LeftLanguageSelection;
  onEnhancedChange: (value: boolean) => void;
  onLeftLanguageChange: (value: LeftLanguageSelection) => void;
  onLatencyModeChange: (value: TranscriptLatencyMode) => void;
}) {
  return (
    <div className="chatDisplayBar" aria-label="Chat display mode">
      <div className="leftLanguageToggle" role="group" aria-label="Left-side language">
        <button
          aria-pressed={leftLanguageSelection === "all"}
          className={leftLanguageSelection === "all" ? "active" : ""}
          onClick={() => onLeftLanguageChange("all")}
          title="Show all detected languages"
          type="button"
        >
          🌐
        </button>
        {leftLanguageOptions.map((language) => (
          <button
            aria-pressed={leftLanguageSelection === language.code}
            className={leftLanguageSelection === language.code ? "active" : ""}
            key={language.code}
            onClick={() => onLeftLanguageChange(language.code)}
            title={language.name}
            type="button"
          >
            {language.flag}
          </button>
        ))}
      </div>
      <div className="chatDisplayActions">
      <div className="englishModeToggle" role="group" aria-label="Transcript speed">
        <button
          aria-pressed={latencyMode === "fast"}
          className={latencyMode === "fast" ? "active" : ""}
          onClick={() => onLatencyModeChange("fast")}
          title="Fast mode"
          type="button"
        >
          🐇
        </button>
        <button
          aria-pressed={latencyMode === "slow"}
          className={latencyMode === "slow" ? "active" : ""}
          onClick={() => onLatencyModeChange("slow")}
          title="Slow mode"
          type="button"
        >
          🐢
        </button>
      </div>
      <div className="englishModeToggle" role="group" aria-label="English wording">
        <button
          aria-pressed={!enhanced}
          className={!enhanced ? "active" : ""}
          onClick={() => onEnhancedChange(false)}
          title="Original English"
          type="button"
        >
          📝
        </button>
        <button
          aria-pressed={enhanced}
          className={enhanced ? "active" : ""}
          onClick={() => onEnhancedChange(true)}
          title="Enhanced English"
          type="button"
        >
          ✨
        </button>
      </div>
      </div>
    </div>
  );
}

function ComposerBar({
  canStart,
  englishTargetLabel,
  englishToTargetOverdubEnabled,
  isLive,
  micCaptureEnabled,
  onStart,
  onStop,
  onSubmit,
  onToggleEnglishToTarget,
  onToggleMicCapture,
  onToggleTargetToEnglish,
  onTextChange,
  openAIRealtimeEnabled,
  targetToEnglishOverdubEnabled,
  text
}: {
  canStart: boolean;
  englishTargetLabel: string;
  englishToTargetOverdubEnabled: boolean;
  isLive: boolean;
  micCaptureEnabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onSubmit: () => void;
  onToggleEnglishToTarget: () => void;
  onToggleMicCapture: () => void;
  onToggleTargetToEnglish: () => void;
  onTextChange: (value: string) => void;
  openAIRealtimeEnabled: boolean;
  targetToEnglishOverdubEnabled: boolean;
  text: string;
}) {
  if (isLive && openAIRealtimeEnabled) {
    return (
      <div className="realtimeControlBar" aria-label="Realtime controls">
        <button
          aria-label={`Toggle English to ${englishTargetLabel} speaker overdub`}
          aria-pressed={englishToTargetOverdubEnabled}
          className={`realtimeControlButton ${englishToTargetOverdubEnabled ? "active" : ""}`}
          onClick={onToggleEnglishToTarget}
          title={`English to ${englishTargetLabel}`}
          type="button"
        >
          <SpeakerIcon />
          <span>EN → {englishTargetLabel}</span>
        </button>
        <button
          aria-label={micCaptureEnabled ? "Pause microphone capture" : "Resume microphone capture"}
          aria-pressed={micCaptureEnabled}
          className={`realtimeMicButton ${micCaptureEnabled ? "active" : ""}`}
          onClick={onToggleMicCapture}
          title={micCaptureEnabled ? "Pause microphone" : "Resume microphone"}
          type="button"
        >
          <MicIcon />
        </button>
        <button
          aria-label={`Toggle ${englishTargetLabel} to English speaker overdub`}
          aria-pressed={targetToEnglishOverdubEnabled}
          className={`realtimeControlButton ${targetToEnglishOverdubEnabled ? "active" : ""}`}
          onClick={onToggleTargetToEnglish}
          title={`${englishTargetLabel} to English`}
          type="button"
        >
          <span>{englishTargetLabel} → EN</span>
          <SpeakerIcon />
        </button>
        <button className="transportButton realtimeStopButton recording" onClick={onStop} type="button">
          Stop
        </button>
      </div>
    );
  }

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
        placeholder="Type something to translate..."
        value={text}
      />
      <button className="sendButton" disabled={!text.trim()} type="submit">
        Send
      </button>
      <button
        aria-label={isLive ? "Stop transcription" : "Start transcription"}
        className={`transportButton ${isLive ? "recording" : ""}`}
        disabled={!isLive && !canStart}
        onClick={isLive ? onStop : onStart}
        type="button"
      >
        {isLive ? "■" : "▶"}
      </button>
    </form>
  );
}

function SpeakerIcon() {
  return (
    <svg aria-hidden="true" className="controlIcon" viewBox="0 0 24 24">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M16 8c1.2 1 1.8 2.4 1.8 4s-.6 3-1.8 4" />
      <path d="M18.8 5.5A9 9 0 0 1 21 12a9 9 0 0 1-2.2 6.5" />
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
  deeplFormality,
  disabled,
  error,
  expectedSpeakerCount,
  geoStatus,
  onAudienceChange,
  onContextChange,
  onContextExample,
  onDeepLFormalityChange,
  onLocation,
  onSpeakerCountChange,
  onStart,
  preset
}: {
  audiencePreset: string;
  canStart: boolean;
  context: string;
  deeplFormality: DeepLFormality;
  disabled: boolean;
  error: string;
  expectedSpeakerCount: string;
  geoStatus: string;
  onAudienceChange: (presetId: string) => void;
  onContextChange: (value: string) => void;
  onContextExample: (example: string) => void;
  onDeepLFormalityChange: (value: DeepLFormality) => void;
  onLocation: () => void;
  onSpeakerCountChange: (count: string) => void;
  onStart: () => void;
  preset: typeof AUDIENCE_PRESETS[number];
}) {
  return (
    <section className="startPanel" aria-label="Start conversation">
      <div className="quickStartFields">
        <AudiencePicker disabled={disabled} onChange={onAudienceChange} value={audiencePreset} />
        <SpeakerCountPicker disabled={disabled} onChange={onSpeakerCountChange} value={expectedSpeakerCount} />
        <div className="gpsField">
          <button className="secondaryButton" onClick={onLocation} disabled={disabled} type="button">
            Use current location
          </button>
          {geoStatus ? <span className="hint">{geoStatus}</span> : null}
        </div>
      </div>

      <ToneSummary deeplFormality={deeplFormality} preset={preset} />
      <details className="advancedSetup">
        <summary>Tone override and optional note</summary>
        <div className="startFields">
          <DeepLFormalityPicker disabled={disabled} onChange={onDeepLFormalityChange} value={deeplFormality} />
        </div>
        <div className="startFields contextFields">
          <label className="contextField">
            Useful detail for this conversation
            <textarea
              value={context}
              onChange={(event) => onContextChange(event.target.value)}
              disabled={disabled}
              placeholder="Only add something special, like a reservation name, a thing you are buying, a medical concern, or a phrase you want to say gently."
            />
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
      </details>

      <div className="startPanelFooter">
        <button className="primaryButton" onClick={onStart} disabled={!canStart} type="button">
          Start session
        </button>
      </div>
      {error ? <div className="errorBox">{error}</div> : null}
    </section>
  );
}

function RealtimeStartPanel({
  canStart,
  disabled,
  error,
  onStart
}: {
  canStart: boolean;
  disabled: boolean;
  error: string;
  onStart: () => void;
}) {
  return (
    <section className="startPanel realtimeStartPanel" aria-label="Start realtime conversation">
      <p className="realtimeStartHint">
        Realtime uses the selected spoken and target languages only.
      </p>
      <div className="startPanelFooter">
        <button className="primaryButton" onClick={onStart} disabled={disabled || !canStart} type="button">
          Start realtime
        </button>
      </div>
      {error ? <FeedbackBanner message={error} /> : null}
    </section>
  );
}

function TranscriptTitle({
  languageMap,
  sourceLanguages,
  targetLanguage
}: {
  languageMap: Map<string, Language>;
  sourceLanguages: string[];
  targetLanguage: string;
}) {
  return (
    <h2 className="transcriptTitle">
      <span className="transcriptTitleFull">{transcriptTitle(sourceLanguages, targetLanguage, languageMap)}</span>
      <span className="transcriptTitleCompact">
        {transcriptShortTitle(sourceLanguages, targetLanguage, languageMap)}
      </span>
    </h2>
  );
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
  const headline = isLive
    ? micCaptureEnabled
      ? "Listening"
      : "Microphone paused"
    : "Ready to listen";
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
      <div className="livePlaceholderBubbles" aria-hidden="true">
        <span />
        <span />
      </div>
      <p>{detail}</p>
    </section>
  );
}

function SessionSidebar({
  activeSession,
  activeSessionTitle,
  expanded,
  groups,
  hasMore,
  isOpen,
  loadingSession,
  onClose,
  onDelete,
  onLoad,
  onNew,
  onRename,
  onToggleExpanded,
  total
}: {
  activeSession: string;
  activeSessionTitle: string;
  expanded: boolean;
  groups: SessionGroup[];
  hasMore: boolean;
  isOpen: boolean;
  loadingSession: string;
  onClose: () => void;
  onDelete: (name: string) => Promise<void>;
  onLoad: (name: string) => void;
  onNew: () => void;
  onRename: (name: string, title: string) => Promise<void>;
  onToggleExpanded: () => void;
  total: number;
}) {
  const [openMenuSession, setOpenMenuSession] = useState("");
  const [renamingSession, setRenamingSession] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteSession, setConfirmDeleteSession] = useState("");

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

  return (
    <aside className={`sessionPanel ${isOpen ? "open" : ""}`} aria-label="Sessions">
      <div className="sessionPanelHeader">
        <div className="sidebarBrand">
          <BrandMark compact />
          <strong>cottonoha</strong>
        </div>
        <div className="sessionHeaderActions">
          <button aria-label="Close sessions" className="drawerCloseButton" onClick={onClose} type="button">
            ×
          </button>
        </div>
      </div>

      <div className="sessionList">
        <button aria-label="Start a new chat" className="sessionButton newChatButton" onClick={onNew} type="button">
          <NewChatIcon />
          <span className="sessionTitle">New chat</span>
        </button>
        <p className="sessionSectionLabel">History</p>
        {activeSession && !groups.some((group) => group.sessions.some((session) => session.name === activeSession)) ? (
          <section className="sessionGroup">
            <h3>Current</h3>
            <div className="sessionButton active currentSessionRow">
              <span className="sessionTitle">{activeSessionTitle || "New chat"}</span>
            </div>
          </section>
        ) : null}
        {groups.length === 0 && !activeSession ? (
          <p className="hint">Past conversations will appear here after a session.</p>
        ) : (
          groups.map((group) => (
            <section className="sessionGroup" key={group.label}>
              <h3>{group.label}</h3>
              {group.sessions.map((session) => {
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
                      <span aria-hidden="true">•••</span>
                    </button>
                    {menuOpen ? (
                      <div className="sessionMenu" role="menu">
                        <div className="sessionMenuMeta">
                          <span>{formatSessionUpdated(session.updated)}</span>
                          <span>Duration {formatDuration(session.duration_seconds)}</span>
                        </div>
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
                            <strong>Delete this chat?</strong>
                            <span>This removes it from history.</span>
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
                          <div className="sessionMenuActions">
                            <button
                              className="sessionMenuAction"
                              onClick={() => {
                                setRenamingSession(session.name);
                                setRenameDraft(session.title || session.name);
                              }}
                              type="button"
                            >
                              Rename
                            </button>
                            <button className="sessionMenuAction danger" onClick={() => setConfirmDeleteSession(session.name)} type="button">
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>

      {hasMore || expanded ? (
        <button className="filterButton fullWidthButton" onClick={onToggleExpanded} type="button">
          {expanded ? "Show fewer" : `Show all ${total}`}
        </button>
      ) : null}

      <div className="sidebarBottom">
        <div className="sidebarBottomActions">
          <Link className="sidebarIconButton" href="/profile" prefetch={false}>
            <ProfileIcon />
            <span>profile</span>
          </Link>
          <SignOutButton className="sidebarIconButton" />
        </div>
      </div>
    </aside>
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

  useEffect(() => {
    if (!openMenu) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [openMenu]);

  const filteredLanguages = languages.filter((language) => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    return `${language.code} ${language.name}`.toLowerCase().includes(needle);
  });

  function closeSheet() {
    setOpenMenu("");
  }

  function openSheet(menu: "source" | "target") {
    if (disabled) {
      return;
    }
    setSourceDraft(sourceLanguages);
    setTargetDraft(targetLanguage);
    setQuery("");
    setOpenMenu(menu);
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

  const sheetTitle = openMenu === "source" ? "Spoken languages" : "Translate to";
  const activeSourceLabels = sourceDraft.map((code) => languageLabel(languageMap, code));
  const activeTargetLabel = languageLabel(languageMap, targetDraft);

  return (
    <>
      <button className="languageMenuButton" disabled={disabled} onClick={() => openSheet("source")} type="button">
        <span>
          <span>Spoken</span>
          <strong>{sourceLanguages.map((code) => languageLabel(languageMap, code)).join(", ")}</strong>
        </span>
      </button>
      <button className="languageMenuButton" disabled={disabled} onClick={() => openSheet("target")} type="button">
        <span>
          <span>Translate to</span>
          <strong>{languageLabel(languageMap, targetLanguage)}</strong>
        </span>
      </button>
      {openMenu ? (
        <div className="languageSheetBackdrop" role="presentation">
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
              className="languageSearchInput"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search languages"
              value={query}
            />
            <div className="languageSelectedChips" aria-label="Selected languages">
              {openMenu === "source"
                ? activeSourceLabels.map((label) => <span key={label}>{label}</span>)
                : <span>{activeTargetLabel}</span>}
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

function ToneSummary({ deeplFormality, preset }: { deeplFormality: DeepLFormality; preset: typeof AUDIENCE_PRESETS[number] }) {
  const effective = effectiveDeepLFormality(deeplFormality, preset);
  return (
    <section className="toneSummary" aria-label="Translation tone">
      <div>
        <p className="panelKicker">Tone</p>
        <strong>{preset.tone}</strong>
      </div>
      <span>Tone: {formalityLabel(effective)}</span>
    </section>
  );
}

function SpeakerCountPicker({
  disabled,
  onChange,
  value
}: {
  disabled: boolean;
  onChange: (count: string) => void;
  value: string;
}) {
  return (
    <div className="speakerCountPicker" role="group" aria-label="Expected speakers">
      <span className="setupFieldLabel">Expected speakers</span>
      <div className="speakerCountOptions">
        {SPEAKER_COUNT_OPTIONS.map((count) => (
          <button
            aria-pressed={value === count}
            className={`speakerCountOption ${value === count ? "active" : ""}`}
            disabled={disabled}
            key={count}
            onClick={() => onChange(count)}
            type="button"
          >
            {count === "6" ? "6+" : count}
          </button>
        ))}
      </div>
    </div>
  );
}

function AudiencePicker({
  disabled,
  onChange,
  value
}: {
  disabled: boolean;
  onChange: (presetId: string) => void;
  value: string;
}) {
  return (
    <fieldset className="audiencePicker">
      <legend>Who are you speaking to?</legend>
      <div className="audienceOptions">
        {AUDIENCE_PRESETS.map((preset) => (
          <button
            aria-pressed={value === preset.id}
            className={`audienceOption ${value === preset.id ? "active" : ""}`}
            disabled={disabled}
            key={preset.id}
            onClick={() => onChange(preset.id)}
            type="button"
          >
            <span className="audienceName">{preset.label}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function DeepLFormalityPicker({
  disabled,
  onChange,
  value
}: {
  disabled: boolean;
  onChange: (value: DeepLFormality) => void;
  value: DeepLFormality;
}) {
  return (
    <label className="contextField compactSelect">
      DeepL tone override
      <select disabled={disabled} onChange={(event) => onChange(event.target.value as DeepLFormality)} value={value}>
        <option value="auto">Auto from situation</option>
        <option value="more">Polite</option>
        <option value="less">Plain</option>
        <option value="default">DeepL default</option>
      </select>
    </label>
  );
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brandMark ${compact ? "compact" : ""}`} aria-hidden="true">
      <Image alt="" height={34} src="/favicon.svg" width={34} />
    </span>
  );
}

function ProfileIcon() {
  return (
    <svg aria-hidden="true" className="sidebarIcon" viewBox="0 0 16 16">
      <circle cx="8" cy="5" r="3" />
      <path d="M3 14c.8-2.8 2.4-4 5-4s4.2 1.2 5 4" />
    </svg>
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

function PhraseCard({
  activeLeftLanguage,
  adaptations,
  editingSpeaker,
  leftLanguageSelection,
  languageMap,
  onEditSpeaker,
  phrases,
  speakerDrafts,
  showEnhancedEnglish,
  targetLanguage
}: {
  activeLeftLanguage: string;
  adaptations: Record<string, PhraseAdaptation>;
  editingSpeaker: string | null;
  leftLanguageSelection: LeftLanguageSelection;
  languageMap: Map<string, Language>;
  onEditSpeaker: (speakerId: string, label: string) => void;
  phrases: Phrase[];
  speakerDrafts: Record<string, SpeakerDraft>;
  showEnhancedEnglish: boolean;
  targetLanguage: string;
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
  const leftText = joinDisplayLines(phrases.map((item) => phraseLeftText(item, leftLanguage, targetLanguage, adaptations)));
  const targetText = joinDisplayLines(phrases.map((item) => phraseTargetText(item, targetLanguage, adaptations)));
  const hasEnhancedEnglish = phrases.some((item) => Boolean(adaptations[adaptationKey(item, activeLeftLanguage)]?.source_rewrite?.trim()));
  const shownTargetText = joinDisplayLines(
    phrases.map((item) => phraseShownTargetText(item, targetLanguage, activeLeftLanguage, adaptations, showEnhancedEnglish))
  );
  const leftLabel = languageLabel(languageMap, leftLanguage);
  const targetLabel = languageLabel(languageMap, targetLanguage);
  const leftRomaji = leftLanguage === "ja" && sourceLang === "ja"
    ? joinDisplayLines(phrases.map((item) => item.romaji_ja || ""))
    : "";
  const loading = phrases.some((item) => adaptations[adaptationKey(item, activeLeftLanguage)]?.status === "loading");

  return (
    <article className={`phrase ${isTargetSource ? "fromEnglish" : "fromOther"}`} style={style}>
      <div className="conversationLanes">
        <div className="languageLane leftLanguageLane">
          {isTargetSource ? (
            <TranslationLine code={leftLanguage} enhanced={hasEnhancedEnglish} label={leftLabel} text={leftText} />
          ) : (
            <BubbleWithSpeaker
              code={leftLanguage}
              editingSpeaker={isEditingSpeaker}
              label={leftLabel}
              onEditSpeaker={onEditSpeaker}
              romaji={leftRomaji}
              speakerId={speakerId}
              speakerInitials={speakerInitials}
              speakerLabel={speakerLabel}
              text={leftText}
            />
          )}
        </div>
        <div className="languageLane englishLane">
          {isTargetSource ? (
            <BubbleWithSpeaker
              code={targetLanguage}
              editingSpeaker={isEditingSpeaker}
              enhanced={showEnhancedEnglish && hasEnhancedEnglish}
              loading={loading}
              label={targetLabel}
              onEditSpeaker={onEditSpeaker}
              speakerId={speakerId}
              speakerInitials={speakerInitials}
              speakerLabel={speakerLabel}
              text={shownTargetText || targetText}
            />
          ) : (
            <TranslationLine code={targetLanguage} enhanced={phrases.some((item) => Boolean(adaptations[adaptationKey(item, targetLanguage)]?.target_translation))} label={targetLabel} text={targetText} />
          )}
        </div>
      </div>
    </article>
  );
}

function BubbleWithSpeaker({
  code,
  editingSpeaker,
  enhanced = false,
  label,
  loading = false,
  onEditSpeaker,
  romaji = "",
  speakerId,
  speakerInitials,
  speakerLabel,
  text
}: {
  code: string;
  editingSpeaker: boolean;
  enhanced?: boolean;
  label: string;
  loading?: boolean;
  onEditSpeaker: (speakerId: string, label: string) => void;
  romaji?: string;
  speakerId: string;
  speakerInitials: string;
  speakerLabel: string;
  text: string;
}) {
  return (
    <div className={`bubbleWithSpeaker ${editingSpeaker ? "editingSpeaker" : ""}`}>
      <SpeakerTag
        initials={speakerInitials}
        onOpen={() => onEditSpeaker(speakerId, speakerLabel)}
      />
      <div className="speechBubbleHighlight">
        <SpeechBubble code={code} enhanced={enhanced} label={label} loading={loading} romaji={romaji} text={text} />
      </div>
    </div>
  );
}

function SpeakerTag({
  initials,
  onOpen
}: {
  initials: string;
  onOpen: () => void;
}) {
  return (
    <button aria-label={`Edit speaker ${initials}`} className="speakerTag" onClick={onOpen} title={`Edit speaker ${initials}`} type="button">
      <span className="speakerTagInitials">{initials}</span>
    </button>
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

function SpeechBubble({
  code,
  enhanced = false,
  label,
  loading = false,
  romaji = "",
  text
}: {
  code: string;
  enhanced?: boolean;
  label: string;
  loading?: boolean;
  romaji?: string;
  text: string;
}) {
  const pairedJapanese = code === "ja" && romaji ? pairJapaneseRomaji(text, romaji) : [];
  return (
    <div className={`speechBubble ${code === "ja" ? "japanese" : ""} ${enhanced ? "aiEnhanced" : ""}`} dir="auto" lang={code} title={label}>
      {pairedJapanese.length ? (
        <span className="lineText japaneseLines">
          {pairedJapanese.map((line, index) => (
            <span className="japaneseLine" key={`${line.text}-${index}`}>
              <span className="japaneseOriginal">{line.text || "..."}</span>
              {line.romaji ? <span className="inlineRomaji">({line.romaji})</span> : null}
            </span>
          ))}
        </span>
      ) : (
        <span className="lineText">{text || "..."}</span>
      )}
      {loading ? <span className="romaji">Adapting...</span> : null}
      {romaji && !pairedJapanese.length ? <span className="romaji">{romaji}</span> : null}
    </div>
  );
}

function pairJapaneseRomaji(text: string, romaji: string): Array<{ text: string; romaji: string }> {
  const textLines = splitDisplayLines(text);
  const romajiLines = splitDisplayLines(romaji);
  const count = Math.max(textLines.length, romajiLines.length);
  const pairs: Array<{ text: string; romaji: string }> = [];
  for (let index = 0; index < count; index += 1) {
    pairs.push({
      text: textLines[index] || "",
      romaji: romajiLines[index] || ""
    });
  }
  return pairs;
}

function splitDisplayLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function joinDisplayLines(values: Array<string | undefined | null>): string {
  return values.map((value) => (value || "").trim()).filter(Boolean).join("\n");
}

function phraseLeftText(
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

function phraseTargetText(
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

function phraseShownTargetText(
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

function TranslationLine({ code, enhanced = false, label, text }: { code: string; enhanced?: boolean; label: string; text: string }) {
  return (
    <div className={`translationLine ${code === "ja" ? "japanese" : ""} ${enhanced ? "aiEnhanced" : ""}`} dir="auto" lang={code} title={label}>
      <span className="lineText">{text || "..."}</span>
    </div>
  );
}

function speakerKey(speaker: number | string | null): string {
  if (speaker === null || speaker === undefined) {
    return "";
  }
  return String(speaker);
}

function speakerColor(id: string): string {
  if (!id) {
    return "#BC002D";
  }
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  }
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length];
}

function fallbackSpeakerLabel(id: string): string {
  if (!id) {
    return "Speaker";
  }
  if (id === "typed") {
    return "You";
  }
  const numeric = Number(id);
  if (Number.isFinite(numeric)) {
    return `Speaker ${numeric}`;
  }
  return id;
}

function speakerEditableName(label: string, speakerId: string): string {
  const clean = label.trim();
  if (!clean || clean === fallbackSpeakerLabel(speakerId) || clean.startsWith("Speaker ")) {
    return "";
  }
  return clean;
}

function initialsFromSpeakerName(name: string, speakerId: string): string {
  const clean = name.trim();
  const numeric = Number(speakerId);
  if (!clean || clean.startsWith("Speaker ")) {
    return Number.isFinite(numeric) ? `S${numeric}` : "S";
  }
  if (speakerId === "typed" && clean === "You") {
    return "Me";
  }
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return normalizeInitials(`${parts[0]![0] || ""}${parts.at(-1)?.[0] || ""}`);
  }
  const chars = Array.from(parts[0] || clean).slice(0, 2).join("");
  return normalizeInitials(chars) || "S";
}

function normalizeInitials(value: string): string {
  return Array.from(value.trim().replace(/\s+/g, ""))
    .slice(0, 3)
    .join("")
    .toLocaleUpperCase();
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

function firstNonEnglishTextLanguage(phrase: Phrase): string {
  return Object.keys(phrase.texts).find((code) => code !== ENGLISH_LANGUAGE) || "";
}

function firstNonEnglishText(phrase: Phrase): string {
  const code = firstNonEnglishTextLanguage(phrase);
  return code ? phrase.texts[code] || "" : "";
}

function adaptationKey(phrase: Phrase, targetLanguage = ""): string {
  const sourceLanguage = phrase.source_lang || firstNonEnglishTextLanguage(phrase);
  const source = sourceLanguage ? phrase.texts[sourceLanguage]?.trim() : "";
  if (!source) {
    return "";
  }
  return targetLanguage ? `${phrase.id}:${targetLanguage}:${source}` : `${phrase.id}:${source}`;
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

function formatTranscriptStats(stats: { durationSeconds: number | null; words: number; tokens: number }): string {
  return `${formatDuration(stats.durationSeconds)}, ${stats.words} words, ${stats.tokens} tokens`;
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
  placeContext: SessionPlaceContext
): ContextBundle {
  const now = new Date();
  const hour = now.getHours();
  const timeContext = hour < 5 ? "late night" : hour < 11 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const preset = getAudiencePreset(presetId);
  const intent = preset.intent;
  const effectiveFormality = effectiveDeepLFormality(deeplFormality, preset);
  const inferredPoi = placeContext.poi_type.trim() || inferPoiType(intent);
  const locationEntries = locationGeneralEntries(placeContext.location_context);
  const general = compactGeneral([
    { key: "domain", value: "Travel conversation in Japan" },
    { key: "session_intent", value: intent },
    { key: "setting", value: inferredPoi },
    { key: "local_time", value: timeContext },
    { key: "date", value: now.toISOString().slice(0, 10) },
    placeContext.location_hint ? { key: "location", value: placeContext.location_hint } : null,
    profileWesternFullName(profile) ? { key: "traveler_name", value: profileWesternFullName(profile) } : null,
    profile.first_name_katakana.trim()
      ? { key: "traveler_first_name_katakana", value: profile.first_name_katakana.trim() }
      : null,
    profile.last_name_katakana.trim()
      ? { key: "traveler_last_name_katakana", value: profile.last_name_katakana.trim() }
      : null,
    profileKatakanaFullDisplay(profile)
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
    ...baseTermsForIntent(intent, inferredPoi)
  ]);
  const translationTerms = dedupeTranslationTerms([
    ...parseTranslationTerms(placeContext.translation_preferences),
    ...baseTranslationTermsForIntent(intent, inferredPoi)
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

function groupSessions(sessions: SessionSummary[]): SessionGroup[] {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const groups = new Map<string, SessionSummary[]>();

  for (const session of [...sessions].sort((a, b) => sessionUpdatedMs(b) - sessionUpdatedMs(a))) {
    const updated = session.updated ? new Date(session.updated).getTime() : 0;
    const label = updated >= todayStart.getTime()
      ? "Today"
      : now - updated <= 7 * 24 * 60 * 60 * 1000
        ? "Last week"
        : "Older";
    groups.set(label, [...(groups.get(label) || []), session]);
  }

  return ["Today", "Last week", "Older"]
    .map((label) => ({ label, sessions: groups.get(label) || [] }))
    .filter((group) => group.sessions.length > 0);
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
