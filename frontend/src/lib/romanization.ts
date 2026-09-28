// Bulgarian streamlined transliteration, including word-final ия and България.
// Source: https://www.mrrb.bg/en/transliteration-act/ (Articles 4–6).
// This is a reading aid; it does not invent word stress or change TTS input.
const BULGARIAN_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch",
  ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya", ѝ: "i"
};

export function romanizeBulgarian(text: string): string {
  return text.normalize("NFC").replace(/[А-Яа-яЍѝ]+/gu, (word) => {
    const lower = word.toLowerCase();
    const allCaps = word === word.toUpperCase();
    return Array.from(word, (letter, index) => {
      let latin = BULGARIAN_LATIN[letter.toLowerCase()] || letter;
      if (lower.endsWith("ия") && index === word.length - 1) latin = "a";
      if (lower === "българия" && index === 1) latin = "u";
      if (letter === letter.toLowerCase()) return latin;
      return allCaps ? latin.toUpperCase() : latin[0]!.toUpperCase() + latin.slice(1);
    }).join("");
  });
}
