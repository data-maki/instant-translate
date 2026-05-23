const SPEAKER_COLORS = [
  "#BC002D",
  "#b45f2a",
  "#315f9c",
  "#8a4f9f",
  "#b23b53",
  "#5d6f2f",
  "#2f7f86",
  "#9a6a1f"
];

export function speakerKey(speaker: number | string | null): string {
  if (speaker === null || speaker === undefined) {
    return "";
  }
  return String(speaker);
}

export function speakerColor(id: string): string {
  if (!id) {
    return "#BC002D";
  }
  let hash = 0;
  for (const char of id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  }
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length];
}

export function fallbackSpeakerLabel(id: string): string {
  if (!id) {
    return "Speaker";
  }
  if (id === "typed") {
    return "You";
  }
  const numeric = Number(id);
  if (Number.isFinite(numeric)) {
    return `Speaker ${numeric}`;
  }
  return id;
}

export function normalizeInitials(value: string): string {
  return Array.from(value.trim().replace(/\s+/g, ""))
    .slice(0, 3)
    .join("")
    .toLocaleUpperCase();
}

export function initialsFromSpeakerName(name: string, speakerId: string): string {
  const clean = name.trim();
  const numeric = Number(speakerId);
  if (!clean || clean.startsWith("Speaker ")) {
    return Number.isFinite(numeric) ? `S${numeric}` : "S";
  }
  if (speakerId === "typed" && clean === "You") {
    return "Me";
  }
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return normalizeInitials(`${parts[0]![0] || ""}${parts.at(-1)?.[0] || ""}`);
  }
  const chars = Array.from(parts[0] || clean).slice(0, 2).join("");
  return normalizeInitials(chars) || "S";
}

export function speakerEditableName(label: string, speakerId: string): string {
  const clean = label.trim();
  if (!clean || clean === fallbackSpeakerLabel(speakerId) || clean.startsWith("Speaker ")) {
    return "";
  }
  return clean;
}
