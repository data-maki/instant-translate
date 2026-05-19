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
        source_languages: string[];
        target_language: string;
        expected_speaker_count?: number | null;
        expected_speaker_names?: string[];
        was_resumed: boolean;
        token_count: number;
      };
    }
  | { type: "transcript"; phrases: Phrase[]; final_token_count: number }
  | { type: "saved"; path: string; phrases: Phrase[]; token_count: number }
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
