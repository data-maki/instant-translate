"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchLanguages, Language, Phrase, TranscriptEvent, websocketUrl } from "@/lib/api";
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

export function TranslatorApp() {
  const [languages, setLanguages] = useState<Language[]>([]);
  const [sourceA, setSourceA] = useState("ja");
  const [sourceB, setSourceB] = useState("en");
  const [targetLanguage, setTargetLanguage] = useState("en");
  const [sessionName, setSessionName] = useState("");
  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const [status, setStatus] = useState<AppStatus>("checking");
  const [error, setError] = useState("");
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [tokenCount, setTokenCount] = useState(0);
  const [savedPath, setSavedPath] = useState("");
  const [activeSession, setActiveSession] = useState("");

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
      top: feedRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [phrases]);

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
  const statusLabel = status === "requesting microphone" ? "mic access" : status;

  async function start() {
    setError("");
    setSavedPath("");
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
              <p className="eyebrow">leaves of speech</p>
              <h1>cottonoha</h1>
            </div>
          </div>
          <p className="subhead">Live Japanese <span aria-hidden="true">↔</span> English captions for everyday conversations in Japan.</p>
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
          </div>

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
          <div className="feed" ref={feedRef}>
            {phrases.length === 0 ? (
              <div className="emptyState">
                <BrandMark compact />
                <strong>Ready for the next conversation.</strong>
                Keep the phone near the speakers. Cottonoha will separate live speech from final captions as the
                translation feed grows.
              </div>
            ) : (
              phrases.map((phrase) => (
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

function PhraseCard({
  phrase,
  languageMap,
  columns
}: {
  phrase: Phrase;
  languageMap: Map<string, Language>;
  columns: string[];
}) {
  const source = phrase.source_lang ? languageMap.get(phrase.source_lang) : undefined;

  return (
    <article className={`phrase ${phrase.is_final ? "" : "partial"}`}>
      <div className="phraseMeta">
        <span className="speakerBadge">{phrase.speaker_label}</span>
        {source ? <span className="sourceBadge">Spoke {source.flag} {source.name}</span> : null}
        <span>{phrase.is_final ? "final" : "live"}</span>
      </div>
      <div className="phraseLines">
        {columns.map((code) => {
          const language = languageMap.get(code);
          const text = phrase.texts[code] || "";
          return (
            <div className="lineBox" key={code}>
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
