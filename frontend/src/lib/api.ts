export type Language = {
  code: string;
  name: string;
  flag: string;
  priority: "core" | "available";
};

export type Phrase = {
  id: string;
  speaker: number | string | null;
  speaker_label: string;
  source_lang: string | null;
  texts: Record<string, string>;
  romaji_ja?: string | null;
  is_final: boolean;
  time?: number | string | null;
};

export type TranscriptEvent =
  | { type: "status"; status: string }
  | {
      type: "session";
      session: {
        name: string;
        title?: string | null;
        source_languages: string[];
        target_language: string;
        expected_speaker_count?: number | null;
        expected_speaker_names?: string[];
        was_resumed: boolean;
        token_count: number;
      };
    }
  | { type: "transcript"; phrases: Phrase[]; final_token_count: number }
  | {
      type: "provider_update";
      provider: "deepgram" | "openai_realtime" | string;
      kind: "transcript" | "translation" | "error" | string;
      text: string;
      is_final: boolean;
    }
  | {
      type: "saved";
      session: string;
      path: string;
      title?: string | null;
      summary?: string | null;
      phrases: Phrase[];
      token_count: number;
    }
  | { type: "error"; message: string };

export type RediarizeResult = {
  session: string;
  path: string;
  speakers: string[];
  speaker_count: number;
  token_count: number;
  phrases: Phrase[];
};

export type RetranslateResult = {
  session: string;
  path: string;
  translation_count: number;
  token_count: number;
  phrases: Phrase[];
};

export type SpeakerReviewRow = {
  speaker: number | string;
  merge_into: number | string;
  label?: string;
};

export type SpeakerReviewResult = {
  session: string;
  path: string;
  speakers: string[];
  speaker_count: number;
  speaker_labels: Record<string, string>;
  token_count: number;
  phrases: Phrase[];
};

export type PlacesContextResult = {
  places: string[];
  general: string[];
  terms: string[];
  translation_terms: string[];
};

export type AdaptPhraseResult = {
  source_rewrite: string;
  target_translation?: string;
};

export type TranslatePhraseResult = {
  target_translation: string;
};

export type SessionSummary = {
  name: string;
  title: string;
  updated?: string | null;
  token_count: number;
  duration_seconds?: number | null;
  source_languages?: string[] | null;
  target_language?: string | null;
};

export type SessionDetail = {
  session: {
    name: string;
    title?: string | null;
    summary?: string | null;
    updated?: string;
    duration_seconds?: number | null;
    source_languages?: string[];
    target_language?: string;
    context?: string | null;
    expected_speaker_count?: number | null;
    expected_speaker_names?: string[];
    tokens?: unknown[];
    artifact?: {
      kind: string;
      path: string;
    };
  } | null;
  phrases?: Phrase[];
};

const DEFAULT_API_BASE_URL = "http://localhost:8000";

export function apiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;
}

export function websocketUrl() {
  const base = new URL(apiBaseUrl());
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/ws/transcribe";
  return base.toString();
}

export async function fetchLanguages(): Promise<{
  default_source_languages: string[];
  default_target_language: string;
  languages: Language[];
}> {
  const response = await fetch(`${apiBaseUrl()}/languages`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load languages (${response.status})`);
  }
  return response.json();
}

export async function fetchSessions(): Promise<{ sessions: SessionSummary[] }> {
  const response = await fetch(`${apiBaseUrl()}/sessions`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load sessions (${response.status})`);
  }
  return response.json();
}

export async function fetchSessionDetail(sessionName: string): Promise<SessionDetail> {
  const response = await fetch(`${apiBaseUrl()}/sessions/${encodeURIComponent(sessionName)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load session (${response.status})`);
  }
  return response.json();
}

export async function rediarizeSession(sessionName: string): Promise<RediarizeResult> {
  const response = await fetch(`${apiBaseUrl()}/sessions/${encodeURIComponent(sessionName)}/rediarize`, {
    method: "POST"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Could not improve speakers (${response.status})`);
  }
  return response.json();
}

export async function retranslateSession(sessionName: string): Promise<RetranslateResult> {
  const response = await fetch(`${apiBaseUrl()}/sessions/${encodeURIComponent(sessionName)}/retranslate`, {
    method: "POST"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Could not improve translations (${response.status})`);
  }
  return response.json();
}

export async function saveSpeakerReview(
  sessionName: string,
  speakers: SpeakerReviewRow[]
): Promise<SpeakerReviewResult> {
  const response = await fetch(`${apiBaseUrl()}/sessions/${encodeURIComponent(sessionName)}/speakers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speakers })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Could not save speaker labels (${response.status})`);
  }
  return response.json();
}

export async function fetchPlacesContext(payload: {
  lat: number;
  lng: number;
  intent: string;
  poi_type?: string;
}): Promise<PlacesContextResult> {
  const response = await fetch(`${apiBaseUrl()}/context/places`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Could not load nearby places (${response.status})`);
  }
  return response.json();
}

export async function adaptPhrase(payload: {
  source_language: string;
  target_language: string;
  source_text: string;
  draft_translation?: string;
  rewrite_context: Record<string, unknown>;
}): Promise<AdaptPhraseResult> {
  const response = await fetch(`${apiBaseUrl()}/context/rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Could not adapt phrase (${response.status})`);
  }
  return response.json();
}

export async function translatePhrase(payload: {
  source_language: string;
  target_language: string;
  source_text: string;
  draft_translation?: string;
  rewrite_context: Record<string, unknown>;
}): Promise<TranslatePhraseResult> {
  const response = await fetch(`${apiBaseUrl()}/context/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Could not translate phrase (${response.status})`);
  }
  return response.json();
}
