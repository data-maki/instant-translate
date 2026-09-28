import type { Phrase } from "./api";
import { phraseSpeakReady, phraseTargetText, type PhraseAdaptation, type TranscriptLatencyMode } from "./phrase-text";
import type { TtsPlayback } from "./tts-playback";

export type SpeechItem = { key: string; text: string; language: string };
export type SpeechOptions = {
  language: string;
  latency: TranscriptLatencyMode;
  adaptations: Record<string, PhraseAdaptation>;
  prepare?: (item: SpeechItem, signal: AbortSignal) => Promise<Response>;
  preparationKey?: string;
  play: (item: SpeechItem, signal: AbortSignal, prepared?: Promise<Response>) => Promise<TtsPlayback>;
  status: (key: string, value: "loading" | "playing" | "error" | null) => void;
};

/** One audio job at a time. The cursor includes unfinished turns so a later
 * translation cannot overtake an earlier English utterance still being translated. */
export class AutoSpeakQueue {
  private phrases: Phrase[] = [];
  private cursor = 0;
  private enabled = false;
  private options: SpeechOptions | null = null;
  private active: { controller: AbortController; item: SpeechItem; options: SpeechOptions; playback?: TtsPlayback } | null = null;
  private prepared: { identity: string; controller: AbortController; response: Promise<Response>; start: () => void } | null = null;

  reset(phrases: Phrase[], options: SpeechOptions, enabled: boolean) {
    this.cancelPlayback();
    this.cancelPrepared();
    this.phrases = phrases;
    this.cursor = phrases.length;
    this.options = options;
    this.enabled = enabled;
  }

  enable(phrases: Phrase[], options: SpeechOptions) {
    this.reset(phrases, options, true);
    // Start at the latest box, never scan backwards for an older English turn.
    this.cursor = Math.max(0, phrases.length - 1);
    this.drain();
  }

  disable() {
    this.enabled = false;
    this.cursor = this.phrases.length;
    this.cancelPlayback();
    this.cancelPrepared();
  }

  update(phrases: Phrase[], options: SpeechOptions) {
    this.phrases = phrases;
    this.options = options;
    this.drain();
  }

  refresh({ adaptations, latency }: Pick<SpeechOptions, "adaptations" | "latency">) {
    if (this.options) this.options = { ...this.options, adaptations, latency };
    this.drain();
  }

  speakNow(item: SpeechItem, options: SpeechOptions) {
    // An explicit voice-button click replaces the current playback/backlog.
    // New English turns arriving afterwards still queue behind it.
    this.reset(this.phrases, options, this.enabled);
    this.play(item, options);
  }

  private cancelPlayback() {
    const active = this.active;
    this.active = null;
    if (!active) return;
    active.controller.abort();
    active.playback?.stop();
    active.options.status(active.item.key, null);
  }

  private drain() {
    const options = this.options;
    this.prepareNext();
    if (!this.enabled || this.active || !options) return;
    while (this.cursor < this.phrases.length) {
      const phrase = this.phrases[this.cursor]!;
      if (!phrase.is_final) return;
      // Source language, not the presence of an English translation, decides
      // eligibility. Bulgarian microphone echo therefore cannot trigger speech.
      if (phrase.source_lang?.trim().toLowerCase() !== "en" || options.language === "en") {
        this.cursor += 1;
        continue;
      }
      if (!phraseSpeakReady(phrase, options.adaptations, options.language, options.latency)) return;
      const text = phraseTargetText(phrase, options.language, options.adaptations).replace(/\s+/g, " ").trim();
      if (!text) return;
      this.cursor += 1;
      this.play({ key: `tts:${phrase.id}:${options.language}`, text, language: options.language }, options);
      this.prepareNext();
      return;
    }
  }

  private identity(item: SpeechItem, options: SpeechOptions) {
    return JSON.stringify([item.key, item.text, item.language, options.preparationKey]);
  }

  private cancelPrepared() {
    const prepared = this.prepared;
    this.prepared = null;
    if (!prepared) return;
    prepared.controller.abort();
    void prepared.response.then(response => response.body?.cancel()).catch(() => {});
  }

  private prepareNext() {
    const options = this.options;
    if (this.enabled && options?.prepare) {
      for (let i = this.cursor; i < this.phrases.length; i += 1) {
        const phrase = this.phrases[i]!;
        if (phrase.source_lang?.trim().toLowerCase() !== "en" || options.language === "en") continue;
        // Synthesize a stable draft early, but drain() still requires final text
        // before any audio is played. Corrections invalidate this exact-text key.
        if (!phraseSpeakReady({ ...phrase, is_final: true }, options.adaptations, options.language, options.latency)) break;
        const item = { key: `tts:${phrase.id}:${options.language}`, language: options.language,
          text: phraseTargetText(phrase, options.language, options.adaptations).replace(/\s+/g, " ").trim() };
        if (!item.text) break;
        const identity = this.identity(item, options);
        if (this.prepared?.identity === identity) {
          if (phrase.is_final) this.prepared.start();
          return;
        }
        this.cancelPrepared();
        const controller = new AbortController();
        const prepare = options.prepare;
        let start!: () => void;
        const response = new Promise<Response>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let started = false;
          const cancel = () => {
            clearTimeout(timer);
            reject(new DOMException("Speech preparation cancelled", "AbortError"));
          };
          start = () => {
            if (started || controller.signal.aborted) return;
            started = true;
            clearTimeout(timer);
            controller.signal.removeEventListener("abort", cancel);
            try { resolve(prepare(item, controller.signal)); }
            catch (error) { reject(error); }
          };
          controller.signal.addEventListener("abort", cancel, { once: true });
          if (phrase.is_final) start();
          else timer = setTimeout(start, 150);
        });
        void response.catch(() => {}); // Report an error only if this turn is consumed.
        this.prepared = { identity, controller, response, start };
        return; // At most one future clip; never synthesize the entire backlog.
      }
    }
    this.cancelPrepared();
  }

  private play(item: SpeechItem, options: SpeechOptions) {
    const prepared = this.prepared?.identity === this.identity(item, options) ? this.prepared : null;
    if (prepared) this.prepared = null;
    const active = { controller: prepared?.controller ?? new AbortController(), item, options, playback: undefined as TtsPlayback | undefined };
    this.active = active;
    options.status(item.key, "loading");
    void (async () => {
      try {
        const playback = await options.play(item, active.controller.signal, prepared?.response);
        if (active.controller.signal.aborted) {
          playback.stop();
          return;
        }
        active.playback = playback;
        options.status(item.key, "playing");
        await playback.done;
        if (!active.controller.signal.aborted) options.status(item.key, null);
      } catch {
        if (!active.controller.signal.aborted) options.status(item.key, "error");
      } finally {
        if (this.active === active) {
          this.active = null;
          this.drain();
        }
      }
    })();
  }
}
