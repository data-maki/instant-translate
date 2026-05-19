"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchLanguages,
  Language,
  Phrase,
  rediarizeSession,
  retranslateSession,
  saveSpeakerReview,
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

const DEFAULT_CONTEXT =
  "Natural bilingual conversation in Japan. Preserve nuance, casual tone, names, places, food, family context, and culturally specific references.";

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
  const [sourceA, setSourceA] = useState("ja");
  const [sourceB, setSourceB] = useState("en");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [sessionName, setSessionName] = useState("");
  const [expectedSpeakerCount, setExpectedSpeakerCount] = useState("");
  const [expectedSpeakerNames, setExpectedSpeakerNames] = useState("");
  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const [status, setStatus] = useState<AppStatus>("checking");
  const [error, setError] = useState("");
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [tokenCount, setTokenCount] = useState(0);
  const [savedPath, setSavedPath] = useState("");
  const [activeSession, setActiveSession] = useState("");
  const [rediarizeStatus, setRediarizeStatus] = useState("");
  const [rediarizing, setRediarizing] = useState(false);
  const [translationStatus, setTranslationStatus] = useState("");
  const [translating, setTranslating] = useState(false);
  const [improvingAll, setImprovingAll] = useState(false);
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, SpeakerDraft>>({});
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState("");
  const [savingReview, setSavingReview] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

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
    feedRef.current?.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }, [phrases, selectedSpeaker]);

  const languageMap = useMemo(() => {
    return new Map(languages.map((language) => [language.code, language]));
  }, [languages]);

  const orderedLanguages = useMemo(() => {
    const core = languages.filter((language) => language.priority === "core");
    const rest = languages.filter((language) => language.priority !== "core");
    return [...core, ...rest];
  }, [languages]);

  const canStart = status === "idle" || status === "stopped" || status === "error";
  const isLive = status === "requesting microphone" || status === "connecting" || status === "listening";
  const postProcessing = rediarizing || translating || improvingAll;
  const statusLabel = status === "requesting microphone" ? "mic access" : status;
  const speakerNames = expectedSpeakerNames.split(",").map((name) => name.trim()).filter(Boolean);
  const speakerSummaries = useMemo(() => summarizeSpeakers(phrases), [phrases]);
  const displayedPhrases = useMemo(() => {
    const compacted = compactPhrases(phrases);
    const filtered = selectedSpeaker
      ? compacted.filter((phrase) => speakerKey(phrase.speaker) === selectedSpeaker)
      : compacted;
    return filtered.slice().reverse();
  }, [phrases, selectedSpeaker]);

  async function start() {
    setError("");
    setSavedPath("");
    setActiveSession("");
    setRediarizeStatus("");
    setTranslationStatus("");
    setReviewStatus("");
    setSpeakerDrafts({});
    setSelectedSpeaker(null);
    setPhrases([]);
    setTokenCount(0);
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
            session_name: sessionName,
            source_languages: [sourceA, sourceB],
            target_language: targetLanguage,
            expected_speaker_count: expectedSpeakerCount ? Number(expectedSpeakerCount) : null,
            expected_speaker_names: speakerNames,
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

  function handleServerEvent(message: TranscriptEvent) {
    if (message.type === "status") {
      setStatus(message.status === "listening" ? "listening" : "stopped");
      return;
    }
    if (message.type === "session") {
      setActiveSession(message.session.name);
      setTokenCount(message.session.token_count);
      return;
    }
    if (message.type === "transcript") {
      setPhrases(message.phrases);
      setTokenCount(message.final_token_count);
      return;
    }
    if (message.type === "saved") {
      setSavedPath(message.path);
      setPhrases(message.phrases);
      setTokenCount(message.token_count);
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
    try {
      wsRef.current?.send(JSON.stringify({ type: "stop" }));
    } catch {
      // The close path below handles already-closed sockets.
    }
    window.setTimeout(() => {
      cleanup();
      setStatus("stopped");
    }, 350);
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
        <aside className="controlPanel" aria-label="Session controls">
          <div className="pairStrip" aria-label="Active language pair">
            <span>日本語</span>
            <strong aria-hidden="true">↔</strong>
            <span>English</span>
          </div>

          <div className="fieldGroup">
            <label>
              Session
              <input
                value={sessionName}
                onChange={(event) => setSessionName(event.target.value)}
                placeholder="family-dinner"
                disabled={isLive}
              />
            </label>
            <p className="hint">Blank creates a timestamped web session. Saved transcripts stay under output/.</p>
          </div>

          <div className="fieldGroup">
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
            <label>
              Speaker names
              <input
                value={expectedSpeakerNames}
                onChange={(event) => setExpectedSpeakerNames(event.target.value)}
                placeholder="Aiko, Jan, Maria"
                disabled={isLive}
              />
            </label>
            <p className="hint">Optional. Used later for fast label/merge review; it does not force Soniox to merge speakers.</p>
          </div>

          <div className="fieldGroup">
            <div className="fieldRow">
              <label>
                Language A
                <select value={sourceA} onChange={(event) => setSourceA(event.target.value)} disabled={isLive}>
                  {orderedLanguages.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.flag} {language.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Language B
                <select value={sourceB} onChange={(event) => setSourceB(event.target.value)} disabled={isLive}>
                  {orderedLanguages.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.flag} {language.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Translation focus
              <select
                value={targetLanguage}
                onChange={(event) => setTargetLanguage(event.target.value)}
                disabled={isLive}
              >
                {[sourceA, sourceB].map((code) => {
                  const language = languageMap.get(code);
                  return (
                    <option key={code} value={code}>
                      {language?.flag ?? ""} {language?.name ?? code.toUpperCase()}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          <label>
            Context hint
            <textarea value={context} onChange={(event) => setContext(event.target.value)} disabled={isLive} />
          </label>

          <div className="actions">
            <button className="primaryButton" onClick={start} disabled={!canStart || sourceA === sourceB}>
              Listen
            </button>
            <button className="secondaryButton" onClick={stop} disabled={!isLive}>
              Stop
            </button>
          </div>

          <div className="statusBox">
            <strong>{activeSession || "No active session"}</strong>
            <span>{sourceA.toUpperCase()} ↔ {sourceB.toUpperCase()} · focus {targetLanguage.toUpperCase()}</span>
            <span>Browser audio is converted to 16 kHz mono PCM before streaming.</span>
            {savedPath ? <span>Saved: {savedPath}</span> : null}
            {rediarizeStatus ? <span>{rediarizeStatus}</span> : null}
            {translationStatus ? <span>{translationStatus}</span> : null}
            {reviewStatus ? <span>{reviewStatus}</span> : null}
          </div>

          <button
            className="primaryButton fullWidthButton"
            onClick={improveSpeakersAndTranslations}
            disabled={!activeSession || isLive || postProcessing}
          >
            {improvingAll ? "Improving transcript..." : "Improve transcript"}
          </button>

          {error ? <div className="errorBox">{error}</div> : null}
        </aside>

        <section className="transcriptPanel" aria-label="Live transcript">
          <div className="transcriptHeader">
            <div>
              <p className="panelKicker">conversation</p>
              <h2>Live transcript</h2>
            </div>
            <span className="tokenCount">{tokenCount} final tokens</span>
          </div>
          {speakerSummaries.length > 0 ? (
            <SpeakerReviewPanel
              drafts={speakerDrafts}
              expectedNames={speakerNames}
              onSave={saveReview}
              onSelect={setSelectedSpeaker}
              onUpdate={updateSpeakerDraft}
              saving={savingReview}
              selectedSpeaker={selectedSpeaker}
              speakers={speakerSummaries}
            />
          ) : null}
          <div className="feed" ref={feedRef}>
            {phrases.length === 0 ? (
              <div className="emptyState">
                <BrandMark compact />
                <strong>Ready for the next conversation.</strong>
                Keep the phone near the speakers. Cottonoha will separate live speech from final captions as the
                translation feed grows.
              </div>
            ) : (
              displayedPhrases.map((phrase) => (
                <PhraseCard
                  key={phrase.id}
                  phrase={phrase}
                  languageMap={languageMap}
                  columns={[sourceA, sourceB]}
                />
              ))
            )}
          </div>
        </section>
      </section>
    </main>
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
  onSave,
  onSelect,
  onUpdate,
  saving,
  selectedSpeaker,
  speakers
}: {
  drafts: Record<string, SpeakerDraft>;
  expectedNames: string[];
  onSave: () => void;
  onSelect: (speakerId: string | null) => void;
  onUpdate: (speakerId: string, patch: Partial<SpeakerDraft>) => void;
  saving: boolean;
  selectedSpeaker: string | null;
  speakers: SpeakerSummary[];
}) {
  const datalistId = "expected-speaker-names";

  return (
    <section className="speakerReview" aria-label="Speaker review">
      <div className="speakerReviewHeader">
        <div>
          <p className="panelKicker">speaker review</p>
          <h3>Label and merge</h3>
        </div>
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
          return (
            <div className={`speakerRow ${selectedSpeaker === speaker.id ? "selected" : ""}`} key={speaker.id}>
              <button className="speakerJump" onClick={() => onSelect(speaker.id)} type="button">
                <strong>{draft.label.trim() || speaker.label}</strong>
                <span>{speaker.count} turn{speaker.count === 1 ? "" : "s"}</span>
              </button>
              <label>
                Name
                <input
                  list={expectedNames.length > 0 ? datalistId : undefined}
                  onChange={(event) => onUpdate(speaker.id, { label: event.target.value })}
                  placeholder={speaker.label}
                  value={draft.label}
                />
              </label>
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
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PhraseCard({
  phrase,
  languageMap,
  columns
}: {
  phrase: Phrase;
  languageMap: Map<string, Language>;
  columns: string[];
}) {
  const color = speakerColor(speakerKey(phrase.speaker));
  const style = { "--speaker-color": color } as CSSProperties;

  return (
    <article className={`phrase ${phrase.is_final ? "" : "partial"}`} style={style}>
      <div className="phraseMeta">
        <span
          className={`statusDot ${phrase.is_final ? "final" : "live"}`}
          aria-label={phrase.is_final ? "final" : "live"}
          title={phrase.is_final ? "final" : "live"}
        />
      </div>
      <div className="phraseLines">
        {columns.map((code) => {
          const language = languageMap.get(code);
          const text = phrase.texts[code] || "";
          const isSource = code === phrase.source_lang;
          return (
            <div className={`lineBox ${isSource ? "sourceLine" : ""}`} key={code}>
              <span className="lineLabel">{language?.flag} {language?.name ?? code.toUpperCase()}</span>
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
