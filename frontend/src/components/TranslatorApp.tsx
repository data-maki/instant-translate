"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
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
  saveSpeakerReview,
  SessionSummary,
  SpeakerReviewRow,
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

const DEFAULT_AUDIENCE_PRESET = "older-stranger";
const REGISTER_BLOCK_START = "[Japanese register preset]";
const REGISTER_BLOCK_END = "[/Japanese register preset]";

type HiddenRegister =
  | "casual_intimate"
  | "polite_neutral"
  | "polite_neutral_soft"
  | "polite_professional"
  | "upward_polite_professional"
  | "downward_polite_clear"
  | "external_formal_business"
  | "polished_professional"
  | "public_institution_polite"
  | "host_guest_respect"
  | "uchi_soto_business";

type SessionIntent = "restaurant" | "train" | "family" | "shopping" | "doctor" | "custom";
type DeepLFormality = "auto" | "more" | "less" | "default";

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
    id: "tourism-staff",
    emoji: "🛍️",
    label: "Shops & hotels",
    intent: "shopping",
    deeplFormality: "more",
    tone: "Polite customer Japanese",
    register: "polite_neutral",
    behavior:
      "Speak as a customer: polite, simple requests with desu/masu. No need to mirror service keigo; keep it practical for shops, restaurants, hotels, and travel."
  },
  {
    id: "restaurant-staff",
    emoji: "🍜",
    label: "Restaurant staff",
    intent: "restaurant",
    deeplFormality: "more",
    tone: "Polite customer Japanese",
    register: "polite_neutral",
    behavior:
      "Speak as a restaurant customer: polite, clear, and practical. Use simple desu/masu requests and make allergies or payment requests explicit."
  },
  {
    id: "station-staff",
    emoji: "🚉",
    label: "Station staff",
    intent: "train",
    deeplFormality: "more",
    tone: "Polite practical Japanese",
    register: "polite_neutral",
    behavior:
      "Speak as a traveler asking station or transport staff for help. Use short polite requests and favor clear words for route, platform, ticket gate, and last train."
  },
  {
    id: "stranger",
    emoji: "👋",
    label: "New person",
    intent: "custom",
    deeplFormality: "more",
    tone: "Safe polite Japanese",
    register: "polite_neutral",
    behavior:
      "Use safe spoken desu/masu. Avoid plain-form directness, imperatives, and anata. Use simple polite requests like shite moraemasu ka or dekimasu ka."
  },
  {
    id: "older-stranger",
    emoji: "👵",
    label: "Older stranger",
    intent: "custom",
    deeplFormality: "more",
    tone: "Soft polite Japanese",
    register: "polite_neutral_soft",
    behavior:
      "Use desu/masu with extra softness. Prefer cushions like sumimasen, yoroshikereba, and shite itadakemasu ka. Avoid heavy ceremonial keigo unless the situation becomes formal."
  },
  {
    id: "host-guest",
    emoji: "🏠",
    label: "Host or guest",
    intent: "family",
    deeplFormality: "more",
    tone: "Warm respectful Japanese",
    register: "host_guest_respect",
    behavior:
      "Use hospitality-oriented formulas. If hosting, elevate the guest and show care/gratitude. If visiting, sound appreciative and humble."
  },
  {
    id: "public-institution",
    emoji: "🏛️",
    label: "Police & gov",
    intent: "doctor",
    deeplFormality: "more",
    tone: "Precise polite Japanese",
    register: "public_institution_polite",
    behavior:
      "Use polite, precise, complete phrases. Avoid casual vagueness. Good for immigration, banks, hospitals, police, and public counters."
  },
  {
    id: "close-friend",
    emoji: "😊",
    label: "Close friend",
    intent: "custom",
    deeplFormality: "less",
    tone: "Friendly plain Japanese",
    register: "casual_intimate",
    behavior:
      "Use friendly plain form, natural contractions, and light teasing only when the source supports it. Keep it direct and relaxed. Avoid desu/masu, sama, and heavy keigo unless intentionally joking or formal."
  },
  {
    id: "spouse-partner",
    emoji: "💍",
    label: "Spouse / partner",
    intent: "family",
    deeplFormality: "less",
    tone: "Warm intimate Japanese",
    register: "casual_intimate",
    behavior:
      "Use intimate, warm plain form. Sound close and caring rather than buddy-like or customer-service polite. Prefer soft directness, affectionate nuance, and natural household phrasing."
  },
  {
    id: "family",
    emoji: "👪",
    label: "Family / in-laws",
    intent: "family",
    deeplFormality: "more",
    tone: "Warm family Japanese",
    register: "casual_intimate",
    behavior:
      "Use warm family speech. Plain form is natural for close family; add polite softness for in-laws, elders, or family members who are not very close."
  },
  {
    id: "coworker",
    emoji: "💼",
    label: "Coworker",
    intent: "custom",
    deeplFormality: "more",
    tone: "Professional spoken Japanese",
    register: "polite_professional",
    behavior:
      "Use professional spoken Japanese, not full keigo. Prefer onegai dekimasu ka, kakunin shite moraemasu ka, and concise work phrasing."
  },
  {
    id: "boss-professor",
    emoji: "🎓",
    label: "Boss / teacher",
    intent: "custom",
    deeplFormality: "more",
    tone: "Respectful professional Japanese",
    register: "upward_polite_professional",
    behavior:
      "Use desu/masu plus respectful request forms such as go-kakunin itadakemasu ka. Avoid overlong keigo chains; voice should be respectful but still speakable."
  },
  {
    id: "employee-student",
    emoji: "🧭",
    label: "Employee / student",
    intent: "custom",
    deeplFormality: "more",
    tone: "Clear respectful Japanese",
    register: "downward_polite_clear",
    behavior:
      "Use clear, respectful instructions without being deferential. Prefer shite kudasai, onegai shimasu, or shite moraemasu ka. Avoid barking or overly humble forms."
  },
  {
    id: "client-customer",
    emoji: "🤝",
    label: "Client / customer",
    intent: "custom",
    deeplFormality: "more",
    tone: "Formal business Japanese",
    register: "external_formal_business",
    behavior:
      "Use respectful language for the listener and humble framing for self/company. Prefer osoreirimasu ga and itadakemasu ka. Voice should be formal but less ornate than email."
  },
  {
    id: "investor-partner",
    emoji: "📈",
    label: "Investor / partner",
    intent: "custom",
    deeplFormality: "more",
    tone: "Polished professional Japanese",
    register: "polished_professional",
    behavior:
      "Use polished, concise professional Japanese. Be respectful and competent, not servile. Prefer go-iken o itadakemasu ka and clear business phrasing."
  },
  {
    id: "other-company",
    emoji: "🏢",
    label: "External company",
    intent: "custom",
    deeplFormality: "more",
    tone: "Uchi/soto business Japanese",
    register: "uchi_soto_business",
    behavior:
      "Apply uchi/soto for external business. Humble your own company/team, elevate their side, use heisha/onsha, avoid san for your own boss, and use sama for people on their side."
  }
];

const PRIMARY_AUDIENCE_PRESET_COUNT = 5;
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
  mergeInto: string;
  label: string;
};

type SpeakerSummary = {
  id: string;
  label: string;
  count: number;
  sample: string;
};

type SessionGroup = {
  label: string;
  sessions: SessionSummary[];
};

const SPEAKER_COLORS = [
  "#2f6f55",
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
  const [sourceALanguages, setSourceALanguages] = useState(initialSourceLanguages);
  const [sourceB, setSourceB] = useState(initialTargetLanguage);
  const [expectedSpeakerCount, setExpectedSpeakerCount] = useState("2");
  const [audiencePreset, setAudiencePreset] = useState(DEFAULT_AUDIENCE_PRESET);
  const [audienceExpanded, setAudienceExpanded] = useState(false);
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
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>(initialSessions);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
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
  const statusLabel = status === "requesting microphone" ? "mic access" : status;
  const hasLanguagePair = sourceALanguages.length > 0 && !sourceALanguages.includes(sourceB);
  const hasSessionStatus = Boolean(activeSession || savedPath || rediarizeStatus || translationStatus || reviewStatus);

  const languageMap = useMemo(() => {
    return new Map(languages.map((language) => [language.code, language]));
  }, [languages]);

  const orderedLanguages = useMemo(() => {
    const core = languages.filter((language) => language.priority === "core");
    const rest = languages.filter((language) => language.priority !== "core");
    return [...core, ...rest];
  }, [languages]);

  const speakerSummaries = useMemo(() => summarizeSpeakers(phrases), [phrases]);
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
    const compacted = compactPhrases(phrases);
    return selectedSpeaker
      ? compacted.filter((phrase) => speakerKey(phrase.speaker) === selectedSpeaker)
      : compacted;
  }, [phrases, selectedSpeaker]);

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

  function selectSpeaker(speakerId: string | null) {
    setSelectedSpeaker(speakerId);
    scrollFeedToBottomSoon();
  }

  function requestAdaptationsFor(phrasesToInspect: Phrase[]) {
    const compacted = compactPhrases(phrasesToInspect);
    const phrasesForRewrite = selectedSpeaker
      ? compacted.filter((phrase) => speakerKey(phrase.speaker) === selectedSpeaker)
      : compacted;

    for (const phrase of phrasesForRewrite) {
      const key = adaptationKey(phrase);
      if (
        !key ||
        adaptationsRef.current[key] ||
        adaptationRequestsRef.current.has(key) ||
        phrase.source_lang !== "en" ||
        !phrase.is_final
      ) {
        continue;
      }
      const sourceText = phrase.texts.en?.trim();
      const draftTranslation = phrase.texts.ja?.trim();
      if (!sourceText) {
        continue;
      }
      adaptationRequestsRef.current.add(key);
      const baseRewriteContext = {
        tone: contextBundle.rewriteTone,
        recent_dialogue: recentDialogueForRewrite(phrasesForRewrite, adaptationsRef.current, key)
      };
      translatePhrase({
        source_language: "en",
        target_language: "ja",
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
          // Keep Soniox's provisional Japanese if the fast DeepL pass misses.
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
          source_language: "en",
          target_language: "ja",
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
    selectSpeaker(null);
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
      selectSpeaker(null);
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
    selectSpeaker(null);
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

  async function saveReview() {
    if (!activeSession || speakerSummaries.length === 0) {
      return;
    }
    setError("");
    setSavingReview(true);
    setReviewStatus("Saving speaker labels...");
    try {
      const rows: SpeakerReviewRow[] = speakerSummaries.map((speaker) => ({
        speaker: speaker.id,
        merge_into: speakerDrafts[speaker.id]?.mergeInto || speaker.id,
        label: speakerDrafts[speaker.id]?.label.trim() || undefined
      }));
      const result = await saveSpeakerReview(activeSession, rows);
      selectSpeaker(null);
      resetAdaptations();
      setPhrasesAndFollow(result.phrases);
      setTokenCount(result.token_count);
      setSavedPath(result.path);
      setReviewStatus(`Saved ${result.speaker_count} speaker${result.speaker_count === 1 ? "" : "s"}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save speaker labels.");
      setReviewStatus("");
    } finally {
      setSavingReview(false);
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
      <header className="topBar">
        <button
          aria-label="Open sessions"
          className="menuButton"
          onClick={() => setSessionsOpen(true)}
          type="button"
        >
          <span />
          <span />
          <span />
        </button>
        <div className="identity">
          <div className="brandLockup">
            <BrandMark />
            <div>
              <h1>cottonoha</h1>
            </div>
          </div>
        </div>
        <div className="connectionPill">
          <span className={`dot ${status === "listening" ? "live" : ""}`} aria-hidden="true" />
          {statusLabel}
        </div>
        <Link className="topLink" href="/profile">Profile</Link>
      </header>

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
          onToggleExpanded={() => setSessionsExpanded((current) => !current)}
          total={sessions.length}
        />

        <section className={`transcriptPanel ${phrases.length === 0 ? "setupMode" : ""}`} aria-label="Live transcript">
          <div className="transcriptHeader">
            <div>
              <p className="panelKicker">conversation</p>
              <h2>Live transcript</h2>
            </div>
            <span className="tokenCount">{formatTranscriptStats(transcriptStats)}</span>
          </div>
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
          <section className="startPanel" aria-label="Start conversation">
            <div className="startPanelHeader">
              <div>
                <p className="panelKicker">new conversation</p>
                <h3>{activeSessionTitle || "Start a session"}</h3>
              </div>
            </div>

            <div className="quickStartFields">
              <AudiencePicker
                disabled={isLive}
                expanded={audienceExpanded}
                onChange={changeAudiencePreset}
                onToggleExpanded={() => setAudienceExpanded((current) => !current)}
                value={audiencePreset}
              />
              <SpeakerCountPicker
                disabled={isLive}
                onChange={setExpectedSpeakerCount}
                value={expectedSpeakerCount}
              />
              <div className="gpsField">
                <button className="secondaryButton" onClick={injectCurrentLocation} disabled={isLive} type="button">
                  Use current location
                </button>
                {geoStatus ? <span className="hint">{geoStatus}</span> : null}
              </div>
            </div>
            <ToneSummary deeplFormality={deeplFormality} preset={selectedPreset} />
            <ProfileSummary profile={travelerProfile} />
            <div className="startPanelFooter">
              {hasFinishedSession ? (
                <button className="secondaryButton" onClick={improveSpeakersAndTranslations} disabled={postProcessing}>
                  {improvingAll ? "Improving transcript..." : "Improve transcript"}
                </button>
              ) : null}
              {isLive ? (
                <button className="secondaryButton" onClick={stop}>
                  Stop
                </button>
              ) : (
                <button className="primaryButton" onClick={start} disabled={!canStart || !hasLanguagePair}>
                  Start session
                </button>
              )}
            </div>
            <details className="advancedSetup">
              <summary>Tone override and optional note</summary>
              <div className="startFields">
                <DeepLFormalityPicker disabled={isLive} onChange={changeDeepLFormality} value={deeplFormality} />
              </div>
              <div className="startFields contextFields">
                <label className="contextField">
                  Useful detail for this conversation
                  <textarea
                    value={context}
                    onChange={(event) => setContext(event.target.value)}
                    disabled={isLive}
                    placeholder="Only add something special, like a reservation name, a thing you are buying, a medical concern, or a phrase you want to say gently."
                  />
                </label>
                <div className="contextExampleRow" aria-label="Context examples">
                  {NOTE_EXAMPLES.map((example) => (
                    <button
                      className="contextExampleButton"
                      disabled={isLive}
                      key={example}
                      onClick={() => appendContextExample(example)}
                      type="button"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </details>
            

            {hasSessionStatus ? (
              <div className="statusBox inlineStatus">
                {activeSessionTitle ? <strong>{activeSessionTitle}</strong> : null}
                {savedPath ? <span>Saved: {savedPath}</span> : null}
                {rediarizeStatus ? <span>{rediarizeStatus}</span> : null}
                {translationStatus ? <span>{translationStatus}</span> : null}
                {reviewStatus ? <span>{reviewStatus}</span> : null}
              </div>
            ) : null}

            {error ? <div className="errorBox">{error}</div> : null}
          </section>
          {speakerSummaries.length > 0 ? (
            <SpeakerReviewPanel
              drafts={speakerDrafts}
              expectedNames={[]}
              liveMode={isLive}
              onSave={saveReview}
              onSelect={selectSpeaker}
              onUpdate={updateSpeakerDraft}
              saving={savingReview}
              selectedSpeaker={selectedSpeaker}
              speakers={speakerSummaries}
            />
          ) : null}
          <div className="feed" onScroll={handleFeedScroll} ref={feedRef}>
            {phrases.length === 0 ? (
              <div className="emptyState" aria-hidden="true" />
            ) : (
              displayedPhrases.map((phrase) => (
                <PhraseCard
                  key={phrase.id}
                  adaptation={adaptations[adaptationKey(phrase)]}
                  phrase={phrase}
                  columns={phraseColumns(phrase, sourceALanguages, sourceB)}
                />
              ))
            )}
          </div>
        </section>
      </section>
    </main>
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
  onToggleExpanded,
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
  onToggleExpanded: () => void;
  total: number;
}) {
  return (
    <aside className={`sessionPanel ${isOpen ? "open" : ""}`} aria-label="Sessions">
      <div className="sessionPanelHeader">
        <div>
          <p className="panelKicker">sessions</p>
          <h2>History</h2>
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
        {activeSession && !groups.some((group) => group.sessions.some((session) => session.name === activeSession)) ? (
          <section className="sessionGroup">
            <h3>Current</h3>
            <button className="sessionButton active" disabled type="button">
              <strong>{activeSessionTitle || "New chat"}</strong>
              <span>{formatDuration(activeDurationSeconds)} · recording</span>
            </button>
          </section>
        ) : null}
        {groups.length === 0 && !activeSession ? (
          <p className="hint">Past conversations will appear here after recording.</p>
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
                  <strong>{session.title || session.name}</strong>
                  <span>
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

function ProfileSummary({ profile }: { profile: TravelerProfile }) {
  const signals = [
    profileWesternFullName(profile) ? "name" : "",
    profile.age ? "age" : "",
    profile.hotel ? "hotel" : "",
    profile.travel_party ? "party" : "",
    profile.allergies ? "diet" : "",
    profile.spice_level ? "spice" : "",
    profile.mobility ? "mobility" : ""
  ].filter(Boolean);
  return (
    <section className="profileSummary" aria-label="Traveler profile">
      <div>
        <p className="panelKicker">profile</p>
        <strong>{signals.length ? `${signals.length} reusable preference${signals.length === 1 ? "" : "s"} loaded` : "No reusable preferences yet"}</strong>
      </div>
      <Link className="filterButton profileLink" href="/profile">Edit profile</Link>
    </section>
  );
}

function ToneSummary({ deeplFormality, preset }: { deeplFormality: DeepLFormality; preset: typeof AUDIENCE_PRESETS[number] }) {
  const effective = effectiveDeepLFormality(deeplFormality, preset);
  return (
    <section className="toneSummary" aria-label="Japanese tone">
      <div>
        <p className="panelKicker">Tone</p>
        <strong>{preset.tone}</strong>
      </div>
      <span>DeepL: {formalityLabel(effective)}</span>
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
  expanded,
  onChange,
  onToggleExpanded,
  value
}: {
  disabled: boolean;
  expanded: boolean;
  onChange: (presetId: string) => void;
  onToggleExpanded: () => void;
  value: string;
}) {
  const primary = AUDIENCE_PRESETS.slice(0, PRIMARY_AUDIENCE_PRESET_COUNT);
  const secondary = AUDIENCE_PRESETS.slice(PRIMARY_AUDIENCE_PRESET_COUNT);

  return (
    <fieldset className="audiencePicker">
      <legend>Who are you speaking to?</legend>
      <div className="audienceOptions">
        {primary.map((preset) => (
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
      {expanded ? (
        <div className="audienceOptions secondary">
          {secondary.map((preset) => (
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
      ) : null}
      <button className="filterButton audienceMore" onClick={onToggleExpanded} type="button">
        {expanded ? "Show common only" : "More situations"}
      </button>
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
      <svg viewBox="0 0 64 64" role="img">
        <path className="markStem" d="M32 52V29" />
        <path className="markLeaf left" d="M30 41C18 39 12 31 14 20c12 1 19 8 18 20" />
        <path className="markLeaf right" d="M34 43c12-2 18-10 16-21-12 2-18 9-17 20" />
        <circle className="markCotton" cx="25" cy="22" r="10" />
        <circle className="markCotton" cx="38" cy="20" r="11" />
        <circle className="markCotton" cx="33" cy="33" r="12" />
      </svg>
    </span>
  );
}

function SpeakerReviewPanel({
  drafts,
  expectedNames,
  liveMode,
  onSave,
  onSelect,
  onUpdate,
  saving,
  selectedSpeaker,
  speakers
}: {
  drafts: Record<string, SpeakerDraft>;
  expectedNames: string[];
  liveMode: boolean;
  onSave: () => void;
  onSelect: (speakerId: string | null) => void;
  onUpdate: (speakerId: string, patch: Partial<SpeakerDraft>) => void;
  saving: boolean;
  selectedSpeaker: string | null;
  speakers: SpeakerSummary[];
}) {
  const datalistId = "expected-speaker-names";

  return (
    <section className={`speakerReview ${liveMode ? "liveMode" : ""}`} aria-label="Speaker review">
      <div className="speakerReviewHeader">
        <div>
          <p className="panelKicker">speaker review</p>
          <h3>{liveMode ? "Name speakers" : "Label and merge"}</h3>
        </div>
        {!liveMode ? (
          <div className="speakerReviewActions">
            <button
              className={`filterButton ${selectedSpeaker === null ? "active" : ""}`}
              onClick={() => onSelect(null)}
              type="button"
            >
              All
            </button>
            <button className="primaryButton compactButton" disabled={saving} onClick={onSave} type="button">
              {saving ? "Saving..." : "Save speakers"}
            </button>
          </div>
        ) : null}
      </div>

      {expectedNames.length > 0 ? (
        <datalist id={datalistId}>
          {expectedNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}

      <div className="speakerRows">
        {speakers.map((speaker) => {
          const draft = drafts[speaker.id] || { mergeInto: speaker.id, label: "" };
          const style = { "--speaker-color": speakerColor(speaker.id) } as CSSProperties;
          return (
            <div
              className={`speakerRow ${liveMode ? "liveMode" : ""} ${selectedSpeaker === speaker.id ? "selected" : ""}`}
              key={speaker.id}
              style={style}
            >
              {liveMode ? (
                <div className="speakerJump speakerBadge">
                  <strong>{draft.label.trim() || speaker.label}</strong>
                  <span>{speaker.count} turn{speaker.count === 1 ? "" : "s"}</span>
                </div>
              ) : (
                <button className="speakerJump" onClick={() => onSelect(speaker.id)} type="button">
                  <strong>{draft.label.trim() || speaker.label}</strong>
                  <span>{speaker.count} turn{speaker.count === 1 ? "" : "s"}</span>
                </button>
              )}
              <label>
                Name
                <input
                  list={expectedNames.length > 0 ? datalistId : undefined}
                  onChange={(event) => onUpdate(speaker.id, { label: event.target.value })}
                  placeholder={speaker.label}
                  value={draft.label}
                />
              </label>
              {!liveMode ? (
                <>
                  <label>
                    Merge into
                    <select
                      onChange={(event) => onUpdate(speaker.id, { mergeInto: event.target.value })}
                      value={draft.mergeInto}
                    >
                      {speakers.map((target) => (
                        <option key={target.id} value={target.id}>
                          {drafts[target.id]?.label.trim() || target.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="speakerSample">{speaker.sample}</p>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PhraseCard({ adaptation, phrase, columns }: { adaptation?: PhraseAdaptation; phrase: Phrase; columns: string[] }) {
  const color = speakerColor(speakerKey(phrase.speaker));
  const style = { "--speaker-color": color } as CSSProperties;

  return (
    <article className="phrase" style={style}>
      <div className="phraseLines">
        {columns.map((code) => {
          const text = phrase.texts[code] || "";
          const displayText = code === "ja" && adaptation?.target_translation ? adaptation.target_translation : text;
          const isSource = code === phrase.source_lang;
          return (
            <div className={`lineBox ${isSource ? "sourceLine" : ""}`} key={code}>
              <span className={`lineText ${code === "ja" ? "japanese" : ""} ${code === "ja" && adaptation?.target_translation ? "improvedLine" : ""}`}>
                {displayText || "..."}
              </span>
              {code === "en" && adaptation?.source_rewrite && adaptation.source_rewrite !== text ? (
                <span className="adaptedLine">{adaptation.source_rewrite}</span>
              ) : null}
              {code === "en" && adaptation?.status === "loading" ? <span className="romaji">Adapting...</span> : null}
              {code === "ja" && phrase.romaji_ja && !adaptation?.target_translation ? <span className="romaji">{phrase.romaji_ja}</span> : null}
            </div>
          );
        })}
      </div>
    </article>
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

function summarizeSpeakers(phrases: Phrase[]): SpeakerSummary[] {
  const summaries = new Map<string, SpeakerSummary>();
  for (const phrase of phrases) {
    const id = speakerKey(phrase.speaker);
    if (!id) {
      continue;
    }
    const existing = summaries.get(id);
    if (existing) {
      existing.count += 1;
      if (!existing.sample) {
        existing.sample = phraseSnippet(phrase);
      }
    } else {
      summaries.set(id, {
        id,
        label: phrase.speaker_label || `Speaker ${id}`,
        count: 1,
        sample: phraseSnippet(phrase)
      });
    }
  }
  return Array.from(summaries.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function speakerKey(speaker: number | string | null): string {
  if (speaker === null || speaker === undefined) {
    return "";
  }
  return String(speaker);
}

function phraseSnippet(phrase: Phrase): string {
  const text = Object.values(phrase.texts).find((value) => value.trim());
  return text ? text.trim().slice(0, 120) : "";
}

function speakerColor(id: string): string {
  if (!id) {
    return "#315f45";
  }
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  }
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length];
}

function languageLabel(languageMap: Map<string, Language>, code: string): string {
  const language = languageMap.get(code);
  return language ? `${language.flag} ${language.name}` : code.toUpperCase();
}

function phraseColumns(phrase: Phrase, sourceLanguages: string[], targetLanguage: string): string[] {
  const columns = [
    ...sourceLanguages.filter((code) => code === phrase.source_lang || phrase.texts[code]),
    targetLanguage
  ];
  return Array.from(new Set(columns));
}

function adaptationKey(phrase: Phrase): string {
  const source = phrase.source_lang ? phrase.texts[phrase.source_lang]?.trim() : "";
  return source ? `${phrase.id}:${source}` : "";
}

function recentDialogueForRewrite(
  phrases: Phrase[],
  adaptations: Record<string, PhraseAdaptation>,
  currentKey: string
): Array<{ speaker: string; english?: string; japanese?: string }> {
  const turns: Array<{ speaker: string; english?: string; japanese?: string }> = [];
  for (const phrase of phrases) {
    const key = adaptationKey(phrase);
    if (key === currentKey) {
      break;
    }
    const adaptation = adaptations[key];
    const english = phrase.texts.en?.trim();
    const japanese = phrase.texts.ja?.trim();
    const adaptedEnglish = adaptation?.status === "ready" && adaptation.source_rewrite
      ? adaptation.source_rewrite
      : english;
    if (adaptedEnglish || japanese) {
      turns.push({
        speaker: phrase.speaker_label || "Unknown",
        english: adaptedEnglish,
        japanese
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
      purpose: "Adapt what the English speaker said into socially natural Japanese for this live conversation.",
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
      rule: "Rewrite for spoken Japanese tone and relationship. Keep it concise. Preserve meaning, but do not translate literally."
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

  for (const session of sessions) {
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
