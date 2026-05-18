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
        was_resumed: boolean;
        token_count: number;
      };
    }
  | { type: "transcript"; phrases: Phrase[]; final_token_count: number }
  | { type: "saved"; path: string; phrases: Phrase[] }
  | { type: "error"; message: string };

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
