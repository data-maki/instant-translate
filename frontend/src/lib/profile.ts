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
};

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
  saved_places: ""
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

export function loadTravelerProfile(): TravelerProfile {
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
      saved_places: String(saved.saved_places ?? "").trim()
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function saveTravelerProfile(profile: TravelerProfile) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
}
