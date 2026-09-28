// Stable visual groups, not a scale of linguistic distance. Close languages
// share a hue range; their written code remains the unambiguous label.
const LANGUAGE_HUES: Record<string, number> = {
  // Romance: warm clay.
  es: 22, ca: 26, pt: 18, gl: 20, it: 30, fr: 34, ro: 38,
  // Germanic: blue.
  en: 210, nl: 214, de: 218, da: 202, no: 204, sv: 206,
  // Slavic: lavender; nearby Baltic shades.
  bg: 268, mk: 270, bs: 262, hr: 260, sr: 264, sl: 258,
  cs: 250, sk: 252, pl: 246, ru: 276, uk: 278, lt: 238, lv: 240,
  // Indo-Aryan / Iranian: rose.
  hi: 350, ur: 352, pa: 346, gu: 342, mr: 338, fa: 358,
  // Dravidian: mauve.
  ta: 316, ml: 320, te: 312,
  // Semitic: ochre. Uralic: teal. Austronesian: green.
  ar: 48, he: 52, fi: 182, et: 186, hu: 176,
  id: 150, ms: 154, tl: 158,
  // Sino-Tibetan; distinct palettes for the remaining supported languages.
  zh: 8, my: 12, ja: 298, ko: 286, th: 110, vi: 130,
  tr: 78, el: 94, eu: 166
};

export function languageHue(code: string): number | undefined {
  return LANGUAGE_HUES[code.trim().toLowerCase().split(/[-_]/)[0]!];
}
