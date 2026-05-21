export type TravelerProfile = {
  first_name: string;
  last_name: string;
  /** Katakana for given name (e.g. ジョン). */
  first_name_katakana: string;
  /** Katakana for family name (e.g. スミス). */
  last_name_katakana: string;
  age: string;
  hotel: string;
  travel_party: string;
  allergies: string;
  spice_level: string;
  mobility: string;
  current_city: string;
  current_location_label: string;
  location_lat: string;
  location_lng: string;
  location_updated_at: string;
  nearby_places: string;
  saved_places: string;
  /** ElevenLabs voice ID for Japanese TTS playback. */
  tts_voice_id: string;
  /** Display name for the chosen TTS voice. */
  tts_voice_name: string;
  /** When true, schedule a background re-diarize + re-translate 2 minutes after the chat stops. */
  auto_improve: boolean;
};

export type JapaneseTtsVoice = {
  id: string;
  name: string;
  /** Short kana sample so users can hear the persona in their head. */
  kana: string;
  /** One-line character/voice description shown in the picker. */
  description: string;
  /** ElevenLabs voice library URL for previewing the voice. */
  previewUrl: string;
};

export const JAPANESE_TTS_VOICES: JapaneseTtsVoice[] = [
  {
    id: "nHEVPT3LS1V37bXZNr82",
    name: "Hideki",
    kana: "ヒデキ",
    description: "Calm, measured narrator. Good for slower, polite phrasing.",
    previewUrl: "https://elevenlabs.io/app/voice-library?voiceId=nHEVPT3LS1V37bXZNr82"
  },
  {
    id: "NO5A3b3sSzDyJQF7MiNS",
    name: "Shohei",
    kana: "ショウヘイ",
    description: "Friendly, conversational. Everyday tone for casual exchanges.",
    previewUrl: "https://elevenlabs.io/app/voice-library?voiceId=NO5A3b3sSzDyJQF7MiNS"
  },
  {
    id: "lDdVGZb7WThyrgVORbh0",
    name: "Shin",
    kana: "シン",
    description: "Bright and youthful. Energetic for quick directions and asks.",
    previewUrl: "https://elevenlabs.io/app/voice-library?voiceId=lDdVGZb7WThyrgVORbh0"
  },
  {
    id: "8FuuqoKHuM48hIEwni5e",
    name: "Shohei (warm)",
    kana: "ショウヘイ",
    description: "Mellow, warm delivery. Softer alternative for restaurants & hotels.",
    previewUrl: "https://elevenlabs.io/app/voice-library?voiceId=8FuuqoKHuM48hIEwni5e"
  }
];

export const DEFAULT_TTS_VOICE = JAPANESE_TTS_VOICES[1];

/** Western-order full name for prompts and legacy context keys. */
export function profileWesternFullName(profile: TravelerProfile): string {
  return [profile.first_name, profile.last_name].map((s) => s.trim()).filter(Boolean).join(" ");
}

/** Katakana display as given・family when both set. */
export function profileKatakanaFullDisplay(profile: TravelerProfile): string {
  const f = profile.first_name_katakana.trim();
  const l = profile.last_name_katakana.trim();
  if (f && l) {
    return `${f}・${l}`;
  }
  return f || l;
}

export const PROFILE_STORAGE_KEY = "mil-decoder-profile-v1";

export const DEFAULT_PROFILE: TravelerProfile = {
  first_name: "",
  last_name: "",
  first_name_katakana: "",
  last_name_katakana: "",
  age: "",
  hotel: "",
  travel_party: "",
  allergies: "",
  spice_level: "",
  mobility: "",
  current_city: "",
  current_location_label: "",
  location_lat: "",
  location_lng: "",
  location_updated_at: "",
  nearby_places: "",
  saved_places: "",
  tts_voice_id: DEFAULT_TTS_VOICE.id,
  tts_voice_name: DEFAULT_TTS_VOICE.name,
  auto_improve: false
};

function migrateLegacyTravelerName(saved: Record<string, unknown>): Pick<TravelerProfile, "first_name" | "last_name"> {
  const legacy = typeof saved.traveler_name === "string" ? saved.traveler_name.trim() : "";
  if (!legacy) {
    return { first_name: "", last_name: "" };
  }
  const parts = legacy.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { first_name: parts[0]!, last_name: parts.slice(1).join(" ") };
  }
  return { first_name: parts[0] || "", last_name: "" };
}

let cachedProfileSnapshot: TravelerProfile | null = null;

function readProfileFromStorage(): TravelerProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
  if (!raw) return DEFAULT_PROFILE;
  try {
    const saved = JSON.parse(raw) as Partial<TravelerProfile> & {
      traveler_name?: string;
      name_katakana?: string;
      names?: string;
      places?: string;
      terms?: string;
    };
    const fromLegacy =
      !String(saved.first_name || "").trim() && !String(saved.last_name || "").trim()
        ? migrateLegacyTravelerName(saved as Record<string, unknown>)
        : null;
    let firstK = String(saved.first_name_katakana ?? "").trim();
    let lastK = String(saved.last_name_katakana ?? "").trim();
    const legacyK = typeof saved.name_katakana === "string" ? saved.name_katakana.trim() : "";
    if (!firstK && !lastK && legacyK) {
      if (legacyK.includes("・")) {
        const [a, ...rest] = legacyK.split("・");
        firstK = (a ?? "").trim();
        lastK = rest.join("・").trim();
      } else {
        firstK = legacyK;
      }
    }
    return {
      first_name: (saved.first_name ?? fromLegacy?.first_name ?? "").trim(),
      last_name: (saved.last_name ?? fromLegacy?.last_name ?? "").trim(),
      first_name_katakana: firstK,
      last_name_katakana: lastK,
      age: String(saved.age ?? "").trim(),
      hotel: String(saved.hotel ?? saved.places ?? "").trim(),
      travel_party: String(saved.travel_party ?? saved.names ?? "").trim(),
      allergies: String(saved.allergies ?? "").trim(),
      spice_level: String(saved.spice_level ?? "").trim(),
      mobility: String(saved.mobility ?? "").trim(),
      current_city: String(saved.current_city ?? "").trim(),
      current_location_label: String(saved.current_location_label ?? "").trim(),
      location_lat: String(saved.location_lat ?? "").trim(),
      location_lng: String(saved.location_lng ?? "").trim(),
      location_updated_at: String(saved.location_updated_at ?? "").trim(),
      nearby_places: String(saved.nearby_places ?? "").trim(),
      saved_places: String(saved.saved_places ?? "").trim(),
      tts_voice_id: String(saved.tts_voice_id ?? DEFAULT_TTS_VOICE.id).trim() || DEFAULT_TTS_VOICE.id,
      tts_voice_name: String(saved.tts_voice_name ?? DEFAULT_TTS_VOICE.name).trim() || DEFAULT_TTS_VOICE.name,
      auto_improve: saved.auto_improve === true || String(saved.auto_improve ?? "").toLowerCase() === "true"
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function loadTravelerProfile(): TravelerProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  if (!cachedProfileSnapshot) {
    cachedProfileSnapshot = readProfileFromStorage();
  }
  return cachedProfileSnapshot;
}

export const PROFILE_CHANGE_EVENT = "traveler-profile-change";

export function saveTravelerProfile(profile: TravelerProfile) {
  if (typeof window === "undefined") return;
  cachedProfileSnapshot = profile;
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  window.dispatchEvent(new Event(PROFILE_CHANGE_EVENT));
}

export function subscribeTravelerProfile(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const storageHandler = () => {
    cachedProfileSnapshot = null;
    callback();
  };
  window.addEventListener("storage", storageHandler);
  window.addEventListener(PROFILE_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", storageHandler);
    window.removeEventListener(PROFILE_CHANGE_EVENT, callback);
  };
}

export function getServerProfileSnapshot(): TravelerProfile {
  return DEFAULT_PROFILE;
}
