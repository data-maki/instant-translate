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
      type: "openai_realtime_audio";
      audio: string;
      format: "pcm_s16le" | string;
      sample_rate: number;
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

export type RealtimeTranslationSession = {
  value?: string;
  client_secret?: {
    value?: string;
  };
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
  adaptations?: Record<string, AdaptPhraseResult & { status: "loading" | "ready" | "error" }>;
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

async function requestJson<T>(path: string, init: RequestInit, fallbackError: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail || `${fallbackError} (${response.status})`);
  }
  return response.json();
}

export async function fetchLanguages(): Promise<{
  default_source_languages: string[];
  default_target_language: string;
  languages: Language[];
}> {
  return requestJson("/languages", { cache: "no-store" }, "Could not load languages");
}

export async function fetchSessions(options: { limit?: number } = {}): Promise<{ sessions: SessionSummary[]; total: number }> {
  const query = options.limit ? `?limit=${encodeURIComponent(String(options.limit))}` : "";
  const result = await requestJson<{ sessions: SessionSummary[]; total?: number }>(
    `/sessions${query}`,
    { cache: "no-store" },
    "Could not load sessions"
  );
  return {
    sessions: result.sessions,
    total: result.total ?? result.sessions.length
  };
}

export async function fetchSessionDetail(sessionName: string): Promise<SessionDetail> {
  return requestJson(`/sessions/${encodeURIComponent(sessionName)}`, { cache: "no-store" }, "Could not load session");
}

export async function renameSession(sessionName: string, title: string): Promise<{ name: string; title: string }> {
  return requestJson(`/sessions/${encodeURIComponent(sessionName)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title })
  }, "Could not rename session");
}

export async function deleteSession(sessionName: string): Promise<{ name: string; deleted: boolean }> {
  return requestJson(`/sessions/${encodeURIComponent(sessionName)}`, {
    method: "DELETE"
  }, "Could not delete session");
}

export async function saveSessionAdaptation(payload: {
  sessionName: string;
  key: string;
  adaptation: AdaptPhraseResult & { status: "loading" | "ready" | "error" };
}): Promise<{ session: string; key: string; adaptation: AdaptPhraseResult & { status: string } }> {
  return requestJson(`/sessions/${encodeURIComponent(payload.sessionName)}/adaptations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: payload.key, adaptation: payload.adaptation })
  }, "Could not save adaptation");
}

export async function rediarizeSession(sessionName: string): Promise<RediarizeResult> {
  return requestJson(`/sessions/${encodeURIComponent(sessionName)}/rediarize`, {
    method: "POST"
  }, "Could not improve speakers");
}

export async function retranslateSession(sessionName: string): Promise<RetranslateResult> {
  return requestJson(`/sessions/${encodeURIComponent(sessionName)}/retranslate`, {
    method: "POST"
  }, "Could not improve translations");
}

export async function saveSpeakerReview(
  sessionName: string,
  speakers: SpeakerReviewRow[]
): Promise<SpeakerReviewResult> {
  return requestJson(`/sessions/${encodeURIComponent(sessionName)}/speakers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speakers })
  }, "Could not save speaker labels");
}

export async function fetchPlacesContext(payload: {
  lat: number;
  lng: number;
  intent: string;
  poi_type?: string;
}): Promise<PlacesContextResult> {
  return requestJson("/context/places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, "Could not load nearby places");
}

export async function createRealtimeTranslationSession(payload: {
  target_language: string;
}): Promise<RealtimeTranslationSession> {
  return requestJson("/realtime/translation-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, "Could not start GPT realtime translation");
}

export async function adaptPhrase(payload: {
  source_language: string;
  target_language: string;
  source_text: string;
  draft_translation?: string;
  rewrite_context: Record<string, unknown>;
}): Promise<AdaptPhraseResult> {
  return requestJson("/context/rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, "Could not adapt phrase");
}

export async function translatePhrase(payload: {
  source_language: string;
  target_language: string;
  source_text: string;
  draft_translation?: string;
  rewrite_context: Record<string, unknown>;
}): Promise<TranslatePhraseResult> {
  return requestJson("/context/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, "Could not translate phrase");
}

export type NameKatakanaOption = {
  first_katakana: string;
  last_katakana: string;
  /** Short Latin spelling of how the first katakana sounds (e.g. Jan vs Yan). */
  first_reading_en: string;
  /** Short Latin spelling of how the last katakana sounds. */
  last_reading_en: string;
};

export type NameKatakanaResult = {
  options: NameKatakanaOption[];
};

export type MapsListPlace = {
  name: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  place_id?: string;
};

export type MapsListImportResult = {
  title: string;
  source_url: string;
  places: MapsListPlace[];
};

export async function importGoogleMapsList(payload: { url: string }): Promise<MapsListImportResult> {
  const raw = await requestJson<MapsListImportResult>("/context/maps-list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, "Could not import Google Maps list");
  return {
    title: String(raw.title || "").trim(),
    source_url: String(raw.source_url || payload.url).trim(),
    places: Array.isArray(raw.places)
      ? raw.places
          .map((place) => ({
            name: String(place?.name || "").trim(),
            address: String(place?.address || "").trim(),
            lat: typeof place?.lat === "number" ? place.lat : null,
            lng: typeof place?.lng === "number" ? place.lng : null,
            place_id: String(place?.place_id || "").trim()
          }))
          .filter((place) => place.name)
      : []
  };
}

export async function fetchNameKatakanaOptions(payload: {
  first_name: string;
  last_name: string;
}): Promise<NameKatakanaResult> {
  const raw = await requestJson<{ options?: unknown }>("/context/name-katakana", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, "Could not load katakana suggestions");
  const rows = Array.isArray(raw.options) ? raw.options : [];
  const options: NameKatakanaOption[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const r = row as Record<string, unknown>;
    const first_katakana = String(r.first_katakana ?? r.given_katakana ?? "").trim();
    const last_katakana = String(r.last_katakana ?? r.family_katakana ?? "").trim();
    const first_reading_en = String(r.first_reading_en ?? r.first_sound_en ?? "").trim();
    const last_reading_en = String(r.last_reading_en ?? r.last_sound_en ?? "").trim();
    if (!first_katakana && !last_katakana) {
      continue;
    }
    options.push({
      first_katakana,
      last_katakana,
      first_reading_en,
      last_reading_en
    });
  }
  return { options };
}
