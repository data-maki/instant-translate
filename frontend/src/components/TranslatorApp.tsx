"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import {
  adaptPhrase,
  fetchPlacesContext,
  fetchSessionDetail,
  fetchSessions,
  Language,
  Phrase,
  rediarizeSession,
  retranslateSession,
  SessionSummary,
  translatePhrase,
  TranscriptEvent,
  websocketUrl
} from "@/lib/api";
import { RecorderHandle, startPcmRecorder } from "@/lib/audio";
import {
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
  emoji: string;
  label: string;
  intent: SessionIntent;
  deeplFormality: Exclude<DeepLFormality, "auto">;
  tone: string;
  register: HiddenRegister;
  behavior: string;
}[] = [
  {
    id: "service-staff",
    emoji: "🛍️",
    label: "Staff & services",
    intent: "shopping",
    deeplFormality: "more",
    tone: "Polite customer speech",
    register: "polite_neutral",
    behavior:
      "Speak as a customer or traveler talking to staff. Use clear, polite requests; keep it practical for shops, restaurants, hotels, stations, taxis, and travel counters."
  },
  {
    id: "polite-stranger",
    emoji: "👋",
    label: "Strangers & elders",
    intent: "custom",
    deeplFormality: "more",
    tone: "Soft polite speech",
    register: "polite_neutral_soft",
    behavior:
      "Use safe spoken politeness with extra softness. Prefer gentle attention-getters, indirect requests, and non-command phrasing. Avoid blunt directness and imperatives."
  },
  {
    id: "close-people",
    emoji: "😊",
    label: "Friends & family",
    intent: "family",
    deeplFormality: "less",
    tone: "Warm casual speech",
    register: "casual_intimate",
    behavior:
      "Use warm natural speech for close people. Casual wording is normal, but keep it kind and not blunt. Add polite softness only when the note or relationship implies distance."
  },
  {
    id: "work-school",
    emoji: "💼",
    label: "Work & school",
    intent: "custom",
    deeplFormality: "more",
    tone: "Professional spoken speech",
    register: "polite_professional",
    behavior:
      "Use professional spoken wording, not stiff written-form language. Prefer concise requests, clear confirmation phrasing, and work or classroom vocabulary."
  },
  {
    id: "official-care",
    emoji: "🏛️",
    label: "Official & care",
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

const DEEPL_FORMALITY_STORAGE_KEY = "mil-decoder-deepl-formality-v1";
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
  initialSessions?: SessionSummary[];
  initialSourceLanguages?: string[];
  initialTargetLanguage?: string;
};

export function TranslatorApp({
  initialLanguages = [],
  initialLoadError = "",
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
  const [deeplFormality, setDeepLFormality] = useState<DeepLFormality>(() => {
    if (typeof window === "undefined") return "auto";
    const saved = window.localStorage.getItem(DEEPL_FORMALITY_STORAGE_KEY);
    return isDeepLFormality(saved) ? saved : "auto";
  });
  const [context, setContext] = useState("");
  const [travelerProfile] = useState<TravelerProfile>(() => loadTravelerProfile());
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
  const [transcriptLatencyMode, setTranscriptLatencyMode] = useState<TranscriptLatencyMode>("fast");
  const [leftLanguageSelection, setLeftLanguageSelection] = useState<LeftLanguageSelection>("all");
  const [typedText, setTypedText] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [sessions, setSessions] = useState<SessionSummary[]>(initialSessions);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [settingsMockOpen, setSettingsMockOpen] = useState(false);
  const [loadingSession, setLoadingSession] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowFeedRef = useRef(true);
  const adaptationRequestsRef = useRef<Set<string>>(new Set());
  const adaptationsRef = useRef<Record<string, PhraseAdaptation>>({});
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
  const displayedPhrases = useMemo(() => {
    return compactPhrases(phrases);
  }, [phrases]);
  const visiblePhrases = useMemo(() => {
    const languageFiltered = displayedPhrases.filter((phrase) => phraseMatchesLeftLanguage(phrase, leftLanguageSelection));
    if (transcriptLatencyMode === "fast") {
      return languageFiltered;
    }
    return languageFiltered.filter((phrase) => phraseReadyForSlowMode(phrase, adaptations, activeLeftLanguage));
  }, [activeLeftLanguage, adaptations, displayedPhrases, leftLanguageSelection, transcriptLatencyMode]);

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

  function setProviderSignalsSynced(next: ProviderSignals | ((current: ProviderSignals) => ProviderSignals)) {
    const current = providerSignalsRef.current;
    providerSignalsRef.current = typeof next === "function" ? next(current) : next;
  }

  function clearProviderSignals() {
    setProviderSignalsSynced({ transcripts: [], translations: [] });
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

  function setPhrasesAndFollow(next: Phrase[]) {
    setPhrases(next);
    scrollFeedToBottomSoon();
    requestAdaptationsFor(next);
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
    const phrasesForRewrite = compactPhrases(phrasesToInspect);

    for (const phrase of phrasesForRewrite) {
      const key = adaptationKey(phrase, targetLanguage);
      if (
        !key ||
        adaptationsRef.current[key] ||
        adaptationRequestsRef.current.has(key) ||
        phrase.source_lang !== ENGLISH_LANGUAGE ||
        targetLanguage === ENGLISH_LANGUAGE ||
        !phrase.is_final
      ) {
        continue;
      }
      const sourceText = phrase.texts.en?.trim();
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
          setAdaptationsSynced((current) => ({
            ...current,
            [key]: {
              source_rewrite: current[key]?.source_rewrite || "",
              target_translation: result.target_translation,
              status: current[key]?.status || "loading"
            }
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
            setAdaptationsSynced((current) => ({
              ...current,
              [key]: { ...result, status: "ready" }
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

  async function start() {
    setError("");
    setSavedPath("");
    setActiveSession("");
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
    setTokenCount(0);
    setActiveDurationSeconds(0);
    startDurationTimer(Date.now());
    shouldFollowFeedRef.current = true;
    setStatus("requesting microphone");

    try {
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

  async function refreshSessions() {
    try {
      const result = await fetchSessions();
      setSessions(result.sessions);
    } catch {
      // The main health/language load already exposes backend connection errors.
    }
  }

  async function loadSession(name: string) {
    if (isLive) {
      return;
    }
    setError("");
    setLoadingSession(name);
    try {
      const detail = await fetchSessionDetail(name);
      if (!detail.session) {
        throw new Error("Session not found.");
      }
      const sourceLanguages = detail.session.source_languages || [sourceA, sourceB];
      const loadedTarget = detail.session.target_language || sourceLanguages[1] || sourceB;
      const loadedSources = sourceLanguages.filter((code) => code && code !== loadedTarget);
      setActiveSession(detail.session.name);
      setActiveSessionTitle(detail.session.title || "New chat");
      setSourceALanguages(loadedSources.length > 0 ? loadedSources : [sourceA]);
      setSourceB(loadedTarget);
      setContext(stripProfileBlock(stripRegisterBlock(detail.session.context || "")));
      setExpectedSpeakerCount(
        detail.session.expected_speaker_count ? String(detail.session.expected_speaker_count) : "6"
      );
      resetAdaptations();
      setPhrasesAndFollow(detail.phrases || []);
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

  function newSession() {
    if (isLive) {
      return;
    }
    setSavedPath("");
    setActiveSession("");
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
      () => setGeoStatus("Could not fetch location."),
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
      setActiveSession(message.session.name);
      setActiveSessionTitle(message.session.title || "New chat");
      setTokenCount(message.session.token_count);
      return;
    }
    if (message.type === "transcript") {
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
    if (message.type === "saved") {
      setActiveSession(message.session);
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
    if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
      wsRef.current.close();
    }
    wsRef.current = null;
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
          activeDurationSeconds={activeDurationSeconds}
          activeSession={activeSession}
          activeSessionTitle={activeSessionTitle}
          expanded={sessionsExpanded}
          groups={visibleSessionGroups}
          hasMore={sessions.length > countGroupedSessions(visibleSessionGroups)}
          isOpen={sessionsOpen}
          loadingSession={loadingSession}
          onClose={() => setSessionsOpen(false)}
          onLoad={loadSession}
          onNew={newSession}
          onToggleSettings={() => setSettingsMockOpen((current) => !current)}
          onToggleExpanded={() => setSessionsExpanded((current) => !current)}
          settingsMockOpen={settingsMockOpen}
          total={sessions.length}
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
              <h2>{transcriptTitle(sourceALanguages, sourceB, languageMap)}</h2>
            </div>
            <div className="transcriptMeta">
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
          {showOnboarding ? (
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
              onStart={start}
              preset={selectedPreset}
            />
          ) : error ? (
            <div className="errorBox">{error}</div>
          ) : null}
          {phrases.length > 0 ? (
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
              <div className="emptyState" aria-hidden="true" />
            ) : visiblePhrases.length === 0 ? (
              <div className="emptyState">
                <strong>Waiting for corrections...</strong>
              </div>
            ) : (
              visiblePhrases.map((phrase) => (
                <PhraseCard
                  key={phrase.id}
                  adaptation={adaptations[adaptationKey(phrase, activeLeftLanguage)]}
                  activeLeftLanguage={activeLeftLanguage}
                  editingSpeaker={editingSpeaker}
                  languageMap={languageMap}
                  onEditSpeaker={openSpeakerEditor}
                  phrase={phrase}
                  speakerDrafts={speakerDrafts}
                  showEnhancedEnglish={showEnhancedEnglish}
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
              isLive={isLive}
              onStart={start}
              onStop={stop}
              onSubmit={submitTypedText}
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
          All
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
            {language.flag} {language.code.toUpperCase()}
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
  isLive,
  onStart,
  onStop,
  onSubmit,
  onTextChange,
  text
}: {
  canStart: boolean;
  isLive: boolean;
  onStart: () => void;
  onStop: () => void;
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
      <button
        aria-label={isLive ? "Stop transcription" : "Start transcription"}
        className={`transportButton ${isLive ? "recording" : ""}`}
        disabled={!isLive && !canStart}
        onClick={isLive ? onStop : onStart}
        type="button"
      >
        {isLive ? "■" : "▶"}
      </button>
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
    </form>
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

function SessionSidebar({
  activeDurationSeconds,
  activeSession,
  activeSessionTitle,
  expanded,
  groups,
  hasMore,
  isOpen,
  loadingSession,
  onClose,
  onLoad,
  onNew,
  onToggleSettings,
  onToggleExpanded,
  settingsMockOpen,
  total
}: {
  activeDurationSeconds: number | null;
  activeSession: string;
  activeSessionTitle: string;
  expanded: boolean;
  groups: SessionGroup[];
  hasMore: boolean;
  isOpen: boolean;
  loadingSession: string;
  onClose: () => void;
  onLoad: (name: string) => void;
  onNew: () => void;
  onToggleSettings: () => void;
  onToggleExpanded: () => void;
  settingsMockOpen: boolean;
  total: number;
}) {
  return (
    <aside className={`sessionPanel ${isOpen ? "open" : ""}`} aria-label="Sessions">
      <div className="sessionPanelHeader">
        <div className="sidebarBrand">
          <BrandMark compact />
          <strong>cottonoha</strong>
        </div>
        <div className="sessionHeaderActions">
          <button className="secondaryButton compactButton" onClick={onNew} type="button">
            New
          </button>
          <button aria-label="Close sessions" className="drawerCloseButton" onClick={onClose} type="button">
            ×
          </button>
        </div>
      </div>

      <div className="sessionList">
        <p className="sessionSectionLabel">History</p>
        {activeSession && !groups.some((group) => group.sessions.some((session) => session.name === activeSession)) ? (
          <section className="sessionGroup">
            <h3>Current</h3>
            <button className="sessionButton active" disabled type="button">
              <span className="sessionTitle">{activeSessionTitle || "New chat"}</span>
              <span className="sessionMeta">{formatDuration(activeDurationSeconds)}</span>
            </button>
          </section>
        ) : null}
        {groups.length === 0 && !activeSession ? (
          <p className="hint">Past conversations will appear here after a session.</p>
        ) : (
          groups.map((group) => (
            <section className="sessionGroup" key={group.label}>
              <h3>{group.label}</h3>
              {group.sessions.map((session) => (
                <button
                  className={`sessionButton ${activeSession === session.name ? "active" : ""}`}
                  disabled={Boolean(loadingSession)}
                  key={session.name}
                  onClick={() => onLoad(session.name)}
                  type="button"
                >
                  <span className="sessionTitle">{session.title || session.name}</span>
                  <span className="sessionMeta">
                    {formatDuration(session.duration_seconds)}
                    {loadingSession === session.name ? " · loading" : ""}
                  </span>
                </button>
              ))}
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
        {settingsMockOpen ? (
          <div className="settingsMock">
            <strong>Settings mock</strong>
            <span>Placeholder only. These controls do not change this session yet.</span>
          </div>
        ) : null}
        <div className="sidebarBottomActions">
          <button className="sidebarIconButton" onClick={onToggleSettings} type="button">
            <span aria-hidden="true">⚙️</span>
            <span>Settings</span>
          </button>
          <Link className="sidebarIconButton" href="/profile">
            <span aria-hidden="true">👤</span>
            <span>Profile</span>
          </Link>
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
  return (
    <>
      <details className="languageMenu">
        <summary>
          <span>Spoken</span>
          <strong>{sourceLanguages.map((code) => languageLabel(languageMap, code)).join(", ")}</strong>
        </summary>
        <div className="languageMenuPanel">
          {languages.map((language) => (
            <label className="languageOption" key={language.code}>
              <input
                checked={sourceLanguages.includes(language.code)}
                disabled={disabled || language.code === targetLanguage}
                onChange={() => onSourceToggle(language.code)}
                type="checkbox"
              />
              <span>{language.flag} {language.name}</span>
            </label>
          ))}
        </div>
      </details>
      <details className="languageMenu">
        <summary>
          <span>Translate to</span>
          <strong>{languageLabel(languageMap, targetLanguage)}</strong>
        </summary>
        <div className="languageMenuPanel">
          {languages.map((language) => (
            <label className="languageOption" key={language.code}>
              <input
                checked={targetLanguage === language.code}
                disabled={disabled}
                name="target-language"
                onChange={() => onTargetChange(language.code)}
                type="radio"
              />
              <span>{language.flag} {language.name}</span>
            </label>
          ))}
        </div>
      </details>
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
          <label className="audienceOption" key={preset.id}>
            <input
              checked={value === preset.id}
              disabled={disabled}
              name="audience-preset"
              onChange={() => onChange(preset.id)}
              type="radio"
            />
            <span className="audienceEmoji" aria-hidden="true">
              {preset.emoji}
            </span>
            <span className="audienceName">{preset.label}</span>
          </label>
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

function PhraseCard({
  activeLeftLanguage,
  adaptation,
  editingSpeaker,
  languageMap,
  onEditSpeaker,
  phrase,
  speakerDrafts,
  showEnhancedEnglish
}: {
  activeLeftLanguage: string;
  adaptation?: PhraseAdaptation;
  editingSpeaker: string | null;
  languageMap: Map<string, Language>;
  onEditSpeaker: (speakerId: string, label: string) => void;
  phrase: Phrase;
  speakerDrafts: Record<string, SpeakerDraft>;
  showEnhancedEnglish: boolean;
}) {
  const color = speakerColor(speakerKey(phrase.speaker));
  const style = { "--speaker-color": color } as CSSProperties;
  const speakerId = speakerKey(phrase.speaker);
  const speakerLabel = speakerDrafts[speakerId]?.label.trim() || phrase.speaker_label || fallbackSpeakerLabel(speakerId);
  const speakerInitials = speakerDrafts[speakerId]?.initials?.trim() || initialsFromSpeakerName(speakerLabel, speakerId);
  const isEditingSpeaker = Boolean(speakerId && editingSpeaker === speakerId);
  const sourceLang = phrase.source_lang || firstNonEnglishTextLanguage(phrase) || activeLeftLanguage;
  const isEnglishSource = sourceLang === ENGLISH_LANGUAGE;
  const englishText = phrase.texts.en || "";
  const leftLanguage = isEnglishSource ? activeLeftLanguage : sourceLang;
  const leftText = isEnglishSource
    ? adaptation?.target_translation || phrase.texts[leftLanguage] || firstNonEnglishText(phrase) || ""
    : phrase.texts[sourceLang] || phrase.texts[leftLanguage] || "";
  const hasEnhancedEnglish = Boolean(adaptation?.source_rewrite?.trim());
  const shownEnglish = showEnhancedEnglish && hasEnhancedEnglish ? adaptation?.source_rewrite || englishText : englishText;
  const leftLabel = languageLabel(languageMap, leftLanguage);

  return (
    <article className={`phrase ${isEnglishSource ? "fromEnglish" : "fromOther"}`} style={style}>
      <div className="conversationLanes">
        <div className="languageLane leftLanguageLane">
          {isEnglishSource ? (
            <TranslationLine code={leftLanguage} enhanced={Boolean(adaptation?.target_translation)} label={leftLabel} text={leftText} />
          ) : (
            <BubbleWithSpeaker
              code={sourceLang}
              editingSpeaker={isEditingSpeaker}
              label={leftLabel}
              onEditSpeaker={onEditSpeaker}
              romaji={sourceLang === "ja" ? phrase.romaji_ja || "" : ""}
              speakerId={speakerId}
              speakerInitials={speakerInitials}
              speakerLabel={speakerLabel}
              text={leftText}
            />
          )}
        </div>
        <div className="languageLane englishLane">
          {isEnglishSource ? (
            <BubbleWithSpeaker
              code={ENGLISH_LANGUAGE}
              editingSpeaker={isEditingSpeaker}
              enhanced={showEnhancedEnglish && hasEnhancedEnglish}
              loading={adaptation?.status === "loading"}
              label="English"
              onEditSpeaker={onEditSpeaker}
              speakerId={speakerId}
              speakerInitials={speakerInitials}
              speakerLabel={speakerLabel}
              text={shownEnglish}
            />
          ) : (
            <TranslationLine code={ENGLISH_LANGUAGE} label="English" text={shownEnglish} />
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
        label={speakerLabel}
        onOpen={() => onEditSpeaker(speakerId, speakerLabel)}
        speakerId={speakerId}
      />
      <div className="speechBubbleHighlight">
        <SpeechBubble code={code} enhanced={enhanced} label={label} loading={loading} romaji={romaji} text={text} />
      </div>
    </div>
  );
}

function SpeakerTag({
  initials,
  label,
  onOpen,
  speakerId
}: {
  initials: string;
  label: string;
  onOpen: () => void;
  speakerId: string;
}) {
  return (
    <button className="speakerTag" onClick={onOpen} title={`Edit ${label || fallbackSpeakerLabel(speakerId)}`} type="button">
      <span className="speakerTagInitials">{initials}</span>
      <span className="speakerTagLabel">{shortSpeakerLabel(label, speakerId)}</span>
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
  return (
    <div className={`speechBubble ${code === "ja" ? "japanese" : ""} ${enhanced ? "aiEnhanced" : ""}`} dir="auto" lang={code} title={label}>
      <span className="lineText">{text || "..."}</span>
      {loading ? <span className="romaji">Adapting...</span> : null}
      {romaji ? <span className="romaji">{romaji}</span> : null}
    </div>
  );
}

function TranslationLine({ code, enhanced = false, label, text }: { code: string; enhanced?: boolean; label: string; text: string }) {
  return (
    <div className={`translationLine ${code === "ja" ? "japanese" : ""} ${enhanced ? "aiEnhanced" : ""}`} dir="auto" lang={code} title={label}>
      <span className="lineText">{text || "..."}</span>
    </div>
  );
}

function compactPhrases(phrases: Phrase[]): Phrase[] {
  const compact: Phrase[] = [];
  for (const phrase of phrases) {
    const previous = compact.at(-1);
    if (
      previous
      && speakerKey(previous.speaker) === speakerKey(phrase.speaker)
      && previous.source_lang === phrase.source_lang
    ) {
      compact[compact.length - 1] = mergePhrase(previous, phrase);
    } else {
      compact.push(phrase);
    }
  }
  return compact;
}

function mergePhrase(previous: Phrase, next: Phrase): Phrase {
  const texts = { ...previous.texts };
  for (const [language, text] of Object.entries(next.texts)) {
    if (!text.trim()) {
      continue;
    }
    texts[language] = texts[language]?.trim()
      ? `${texts[language].trim()}\n${text.trim()}`
      : text;
  }
  return {
    ...next,
    id: `${previous.id}-${next.id}`,
    texts,
    romaji_ja: [previous.romaji_ja, next.romaji_ja].filter(Boolean).join("\n") || null,
    is_final: previous.is_final && next.is_final
  };
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

function shortSpeakerLabel(label: string, speakerId: string): string {
  const clean = label.trim();
  const numeric = Number(speakerId);
  if (!clean || clean.startsWith("Speaker ")) {
    return Number.isFinite(numeric) ? String(numeric) : clean || "S";
  }
  return clean;
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
    return Number.isFinite(numeric) ? String(numeric) : "S";
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

function phraseMatchesLeftLanguage(phrase: Phrase, selection: LeftLanguageSelection): boolean {
  if (selection === "all" || phrase.source_lang === ENGLISH_LANGUAGE) {
    return true;
  }
  const sourceLanguage = phrase.source_lang || firstNonEnglishTextLanguage(phrase);
  return sourceLanguage === selection || Boolean(phrase.texts[selection]);
}

function firstNonEnglishTextLanguage(phrase: Phrase): string {
  return Object.keys(phrase.texts).find((code) => code !== ENGLISH_LANGUAGE) || "";
}

function firstNonEnglishText(phrase: Phrase): string {
  const code = firstNonEnglishTextLanguage(phrase);
  return code ? phrase.texts[code] || "" : "";
}

function adaptationKey(phrase: Phrase, targetLanguage = ""): string {
  const source = phrase.source_lang ? phrase.texts[phrase.source_lang]?.trim() : "";
  if (!source) {
    return "";
  }
  return phrase.source_lang === ENGLISH_LANGUAGE && targetLanguage
    ? `${phrase.id}:${targetLanguage}:${source}`
    : `${phrase.id}:${source}`;
}

function phraseReadyForSlowMode(phrase: Phrase, adaptations: Record<string, PhraseAdaptation>, targetLanguage: string): boolean {
  if (phrase.source_lang !== ENGLISH_LANGUAGE) {
    return true;
  }
  const key = adaptationKey(phrase, targetLanguage);
  if (!key) {
    return false;
  }
  const adaptation = adaptations[key];
  return adaptation?.status === "ready" || adaptation?.status === "error";
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
