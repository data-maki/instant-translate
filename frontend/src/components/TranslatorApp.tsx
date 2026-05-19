"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchLanguages,
  fetchSessionDetail,
  fetchSessions,
  Language,
  Phrase,
  rediarizeSession,
  retranslateSession,
  saveSpeakerReview,
  SessionSummary,
  SpeakerReviewRow,
  TranscriptEvent,
  websocketUrl
} from "@/lib/api";
import { RecorderHandle, startPcmRecorder } from "@/lib/audio";

type AppStatus =
  | "idle"
  | "checking"
  | "requesting microphone"
  | "connecting"
  | "listening"
  | "stopping"
  | "stopped"
  | "error";

const BASE_CONTEXT =
  "Natural bilingual conversation in Japan. Preserve nuance, casual tone, names, places, food, family context, and culturally specific references.";
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

const AUDIENCE_PRESETS: {
  id: string;
  emoji: string;
  label: string;
  register: HiddenRegister;
  behavior: string;
}[] = [
  {
    id: "tourism-staff",
    emoji: "🛍️",
    label: "Shops & hotels",
    register: "polite_neutral",
    behavior:
      "Speak as a customer: polite, simple requests with desu/masu. No need to mirror service keigo; keep it practical for shops, restaurants, hotels, and travel."
  },
  {
    id: "stranger",
    emoji: "👋",
    label: "New person",
    register: "polite_neutral",
    behavior:
      "Use safe spoken desu/masu. Avoid plain-form directness, imperatives, and anata. Use simple polite requests like shite moraemasu ka or dekimasu ka."
  },
  {
    id: "older-stranger",
    emoji: "👵",
    label: "Older stranger",
    register: "polite_neutral_soft",
    behavior:
      "Use desu/masu with extra softness. Prefer cushions like sumimasen, yoroshikereba, and shite itadakemasu ka. Avoid heavy ceremonial keigo unless the situation becomes formal."
  },
  {
    id: "host-guest",
    emoji: "🏠",
    label: "Host or guest",
    register: "host_guest_respect",
    behavior:
      "Use hospitality-oriented formulas. If hosting, elevate the guest and show care/gratitude. If visiting, sound appreciative and humble."
  },
  {
    id: "public-institution",
    emoji: "🏛️",
    label: "Police & gov",
    register: "public_institution_polite",
    behavior:
      "Use polite, precise, complete phrases. Avoid casual vagueness. Good for immigration, banks, hospitals, police, and public counters."
  },
  {
    id: "friend-partner",
    emoji: "😊",
    label: "Friend or partner",
    register: "casual_intimate",
    behavior:
      "Use plain form, warmth, and direct natural phrasing. Avoid desu/masu overuse, sama, or heavy keigo unless the source is intentionally joking or formal."
  },
  {
    id: "family",
    emoji: "👪",
    label: "Family / in-laws",
    register: "casual_intimate",
    behavior:
      "Use warm family speech. Plain form is natural for close family; add polite softness for in-laws, elders, or family members who are not very close."
  },
  {
    id: "coworker",
    emoji: "💼",
    label: "Coworker",
    register: "polite_professional",
    behavior:
      "Use professional spoken Japanese, not full keigo. Prefer onegai dekimasu ka, kakunin shite moraemasu ka, and concise work phrasing."
  },
  {
    id: "boss-professor",
    emoji: "🎓",
    label: "Boss / teacher",
    register: "upward_polite_professional",
    behavior:
      "Use desu/masu plus respectful request forms such as go-kakunin itadakemasu ka. Avoid overlong keigo chains; voice should be respectful but still speakable."
  },
  {
    id: "employee-student",
    emoji: "🧭",
    label: "Employee / student",
    register: "downward_polite_clear",
    behavior:
      "Use clear, respectful instructions without being deferential. Prefer shite kudasai, onegai shimasu, or shite moraemasu ka. Avoid barking or overly humble forms."
  },
  {
    id: "client-customer",
    emoji: "🤝",
    label: "Client / customer",
    register: "external_formal_business",
    behavior:
      "Use respectful language for the listener and humble framing for self/company. Prefer osoreirimasu ga and itadakemasu ka. Voice should be formal but less ornate than email."
  },
  {
    id: "investor-partner",
    emoji: "📈",
    label: "Investor / partner",
    register: "polished_professional",
    behavior:
      "Use polished, concise professional Japanese. Be respectful and competent, not servile. Prefer go-iken o itadakemasu ka and clear business phrasing."
  },
  {
    id: "uchi-soto",
    emoji: "🏢",
    label: "Inside vs outside company",
    register: "uchi_soto_business",
    behavior:
      "Apply uchi/soto. To outsiders, humble your own company/team, elevate their side, use heisha/ onsha, avoid san for your own boss, and use sama for their side."
  }
];

const PRIMARY_AUDIENCE_PRESET_COUNT = 5;

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

export function TranslatorApp() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceALanguages, setSourceALanguages] = useState(["ja"]);
  const [sourceB, setSourceB] = useState("en");
  const [expectedSpeakerCount, setExpectedSpeakerCount] = useState("");
  const [audiencePreset, setAudiencePreset] = useState(DEFAULT_AUDIENCE_PRESET);
  const [audienceExpanded, setAudienceExpanded] = useState(false);
  const [context, setContext] = useState(contextWithRegister(BASE_CONTEXT, DEFAULT_AUDIENCE_PRESET));
  const [status, setStatus] = useState<AppStatus>("checking");
  const [error, setError] = useState("");
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [tokenCount, setTokenCount] = useState(0);
  const [savedPath, setSavedPath] = useState("");
  const [activeSession, setActiveSession] = useState("");
  const [activeSessionTitle, setActiveSessionTitle] = useState("");
  const [activeDurationSeconds, setActiveDurationSeconds] = useState<number | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [rediarizeStatus, setRediarizeStatus] = useState("");
  const [rediarizing, setRediarizing] = useState(false);
  const [translationStatus, setTranslationStatus] = useState("");
  const [translating, setTranslating] = useState(false);
  const [improvingAll, setImprovingAll] = useState(false);
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, SpeakerDraft>>({});
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [loadingSession, setLoadingSession] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowFeedRef = useRef(true);

  const sourceA = sourceALanguages[0] || (sourceB === "en" ? "ja" : "en");
  const canStart = status === "idle" || status === "stopped" || status === "error";
  const isLive = status === "requesting microphone" || status === "connecting" || status === "listening";
  const postProcessing = rediarizing || translating || improvingAll;
  const statusLabel = status === "requesting microphone" ? "mic access" : status;
  const hasLanguagePair = sourceALanguages.length > 0 && !sourceALanguages.includes(sourceB);
  const hasSessionStatus = Boolean(activeSession || savedPath || rediarizeStatus || translationStatus || reviewStatus);

  useEffect(() => {
    fetchLanguages()
      .then((data) => {
        setLanguages(data.languages);
        setStatus("idle");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load backend languages.");
        setStatus("error");
      });
  }, []);

  useEffect(() => {
    refreshSessions();
  }, []);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || !shouldFollowFeedRef.current) {
      return;
    }
    feed.scrollTo({
      top: feed.scrollHeight,
      behavior: "smooth"
    });
  }, [phrases, selectedSpeaker]);

  useEffect(() => {
    if (!isLive || !sessionStartedAt) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveDurationSeconds(Math.max(1, Math.floor((Date.now() - sessionStartedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLive, sessionStartedAt]);

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

  async function start() {
    setError("");
    setSavedPath("");
    setActiveSession("");
    setActiveSessionTitle("New chat");
    setRediarizeStatus("");
    setTranslationStatus("");
    setReviewStatus("");
    setSpeakerDrafts({});
    setSelectedSpeaker(null);
    setPhrases([]);
    setTokenCount(0);
    setActiveDurationSeconds(0);
    setSessionStartedAt(Date.now());
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
            context
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
      setContext(detail.session.context || contextWithRegister(BASE_CONTEXT, DEFAULT_AUDIENCE_PRESET));
      setExpectedSpeakerCount(
        detail.session.expected_speaker_count ? String(detail.session.expected_speaker_count) : ""
      );
      setPhrases(detail.phrases || []);
      setTokenCount(detail.session.tokens?.length || detail.phrases?.length || 0);
      setActiveDurationSeconds(detail.session.duration_seconds ?? durationFromPhrases(detail.phrases || []));
      setSessionStartedAt(null);
      setSavedPath(detail.session.artifact?.path || "");
      setRediarizeStatus("");
      setTranslationStatus("");
      setReviewStatus("");
      setSpeakerDrafts({});
      setSelectedSpeaker(null);
      shouldFollowFeedRef.current = true;
      setStatus("stopped");
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
    setSelectedSpeaker(null);
    setPhrases([]);
    setTokenCount(0);
    setActiveDurationSeconds(null);
    setSessionStartedAt(null);
    shouldFollowFeedRef.current = true;
    setStatus("idle");
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
    setContext((current) => contextWithRegister(stripRegisterBlock(current || BASE_CONTEXT), presetId));
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
      setPhrases(message.phrases);
      setTokenCount(message.final_token_count);
      return;
    }
    if (message.type === "saved") {
      setActiveSession(message.session);
      setActiveSessionTitle(message.title || "New chat");
      setSavedPath(message.path);
      setPhrases(message.phrases);
      setTokenCount(message.token_count);
      setActiveDurationSeconds(durationFromPhrases(message.phrases));
      setSessionStartedAt(null);
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
    window.setTimeout(() => {
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
      setPhrases(speakerResult.phrases);
      setTokenCount(speakerResult.token_count);
      setSavedPath(speakerResult.path);
      setRediarizeStatus(`Improved: ${speakerResult.speaker_count} speakers`);

      setRediarizing(false);
      setTranslating(true);
      setTranslationStatus("Improving translations...");
      const translationResult = await retranslateSession(activeSession);
      setPhrases(translationResult.phrases);
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
      setPhrases(result.phrases);
      setTokenCount(result.token_count);
      setSavedPath(result.path);
      setReviewStatus(`Saved ${result.speaker_count} speaker${result.speaker_count === 1 ? "" : "s"}`);
      setSelectedSpeaker(null);
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
      </header>

      <section className="workspace">
        <SessionSidebar
          activeDurationSeconds={activeDurationSeconds}
          activeSession={activeSession}
          activeSessionTitle={activeSessionTitle}
          expanded={sessionsExpanded}
          groups={visibleSessionGroups}
          hasMore={sessions.length > countGroupedSessions(visibleSessionGroups)}
          loadingSession={loadingSession}
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

            <div className="startFields">
              <label>
                Expected speakers
                <input
                  value={expectedSpeakerCount}
                  onChange={(event) => setExpectedSpeakerCount(event.target.value)}
                  placeholder="6"
                  inputMode="numeric"
                  disabled={isLive}
                />
              </label>
              <AudiencePicker
                disabled={isLive}
                expanded={audienceExpanded}
                onChange={changeAudiencePreset}
                onToggleExpanded={() => setAudienceExpanded((current) => !current)}
                value={audiencePreset}
              />
            </div>

            <div className="startFields contextFields">
              <label className="contextField">
                Context hint
                <textarea value={context} onChange={(event) => setContext(event.target.value)} disabled={isLive} />
              </label>
            </div>

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
          </section>
          {speakerSummaries.length > 0 ? (
            <SpeakerReviewPanel
              drafts={speakerDrafts}
              expectedNames={[]}
              liveMode={isLive}
              onSave={saveReview}
              onSelect={setSelectedSpeaker}
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
  loadingSession,
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
  loadingSession: string;
  onLoad: (name: string) => void;
  onNew: () => void;
  onToggleExpanded: () => void;
  total: number;
}) {
  return (
    <aside className="sessionPanel" aria-label="Sessions">
      <div className="sessionPanelHeader">
        <div>
          <p className="panelKicker">sessions</p>
          <h2>History</h2>
        </div>
        <button className="secondaryButton compactButton" onClick={onNew} type="button">
          New
        </button>
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
      <legend>Speaking to</legend>
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

function PhraseCard({ phrase, columns }: { phrase: Phrase; columns: string[] }) {
  const color = speakerColor(speakerKey(phrase.speaker));
  const style = { "--speaker-color": color } as CSSProperties;

  return (
    <article className="phrase" style={style}>
      <div className="phraseLines">
        {columns.map((code) => {
          const text = phrase.texts[code] || "";
          const isSource = code === phrase.source_lang;
          return (
            <div className={`lineBox ${isSource ? "sourceLine" : ""}`} key={code}>
              <span className={`lineText ${code === "ja" ? "japanese" : ""}`}>{text || "..."}</span>
              {code === "ja" && phrase.romaji_ja ? <span className="romaji">{phrase.romaji_ja}</span> : null}
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

function contextWithRegister(baseContext: string, presetId: string): string {
  const preset = AUDIENCE_PRESETS.find((item) => item.id === presetId) || AUDIENCE_PRESETS[0];
  const cleanBase = stripRegisterBlock(baseContext).trim() || BASE_CONTEXT;
  return `${cleanBase}\n\n${REGISTER_BLOCK_START}\nMedium: voice\nSpeaking to: ${preset.label}\nHidden register: ${preset.register}\nJapanese behavior: ${preset.behavior}\nVoice rules: Prefer short complete spoken sentences. Use names/titles instead of anata. Raise politeness for requests, apologies, refusals, and invitations. Avoid email-only formulas unless this is explicitly a business call opening.\n${REGISTER_BLOCK_END}`;
}

function stripRegisterBlock(value: string): string {
  const start = value.indexOf(REGISTER_BLOCK_START);
  const end = value.indexOf(REGISTER_BLOCK_END);
  if (start === -1 || end === -1 || end < start) {
    return value;
  }
  return `${value.slice(0, start)}${value.slice(end + REGISTER_BLOCK_END.length)}`.trim();
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
