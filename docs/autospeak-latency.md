# Autospeak latency

The target is **last input speech sample → first translated audible sample under
700 ms**. A TTS inference-time claim is not that measurement.

## Before and after

Before:

```text
Final translation → v3 synthesis → download full MP3 → base64 JSON
                 → initialize WebRTC audio → play → synthesize next reply
```

After:

```text
Enable/Start → unlock AudioContext and warm WebRTC audio
Final translation → Flash synthesis → stream PCM → WebRTC audio → speakers
                                    (play before response finishes)
Stable translated draft → prepare audio → wait for identical confirmed text
Current reply playing → prepare one next reply → ordered playback
Repeated text + same user/language/voice → memory cache → WebRTC audio
```

- `/tts/stream` uses `eleven_flash_v2_5` for its supported languages, including
  Bulgarian. Other languages retain `eleven_v3`. Provider errors can fall back to
  v3 and then multilingual v2 before audio is sent. `/tts/voices` reports coverage.
- Backend HTTP connections are pooled. Mono 24 kHz signed little-endian PCM avoids
  waiting for a complete compressed file or decoding it in the browser.
- Playback remains on the WebRTC echo-reference path. PCM chunks are scheduled in
  order with 40 ms of initial buffering. A late network chunk can still cause a gap.
- Starting or reusing playback explicitly awaits the final audio element's
  `play()` call. A connected WebRTC track can carry speech while browser autoplay
  leaves its output paused; received samples alone are not proof of playback.
  A rejected output start reaches the existing retry/error state.
- The queue prepares at most one future eligible reply. A draft translation must
  remain unchanged for 150 ms before synthesis starts; final text skips that wait.
  It reuses the request only if the confirmed text matches exactly. Corrections,
  voice changes, Off, navigation and manual interruption discard stale preparation.
  This can spend a synthesis request on a draft that is later discarded.
- Only English source speech into the selected non-English language triggers auto
  playback. Enabling starts at the latest box. Partial text and historical boxes
  are not speculatively spoken.
- Soniox's existing target-language text goes directly to synthesis in both fast
  and slow display modes. There is no automatic DeepL retranslating pass, 350 ms
  rewrite timer, or Groq/DeepL polish pass. Typed input and missing display languages
  get one fallback translation; an existing saved fallback is reused too.
- Completed PCM is cached in page memory for five minutes, at most 32 clips / 8 MiB,
  keyed by authentication identity, language, voice and exact text. Clips over
  4 MiB, errors and incomplete streams are not cached. No audio is put in storage.
- The existing `/tts/speak` MP3/JSON contract remains available for iOS. Web clients
  also fall back to it when a running older backend lacks `/tts/stream`.

## Manual playback and Bulgarian readings

Each paragraph has two language-labeled speaker buttons: source and translation.
Either button reads all available sentences in that paragraph in order, including
saved history and available draft text. Missing translations do not block source
playback. Clicking another language or paragraph interrupts the current playback;
clicking the same button replays from the beginning. The text remains selectable.
Manual playback does not use autospeak's English-only direction, latest-box cursor,
or finality restrictions.

The queue splits text longer than the backend's 1,500-character request limit at
word boundaries, preserving Unicode characters, and plays each chunk sequentially.
The paragraph keeps one playback identity until its final chunk finishes; newly
arriving autospeak turns wait behind it. Interruption cancels the remaining chunks.

Bulgarian text includes a Latin reading in brackets beside the Cyrillic by default; the
Script/Latin toggle can show only the reading. Readings are generated locally
from the displayed text, so old sessions and fallback translations work without
another translation request. TTS always receives the original Cyrillic. The
mapping follows the [Bulgarian Transliteration Act, Articles 4–6](https://www.mrrb.bg/en/transliteration-act/),
including word-final `ия → ia` and `България → Bulgaria`. It is a reading aid;
it does not mark stress or represent all pronunciation differences.

Source, reading, and translation flow inline and wrap at the available width.
Small language-code labels use stable, theme-aware colors: related languages
share close shades (for example, Catalan and Spanish). Labels identify languages
without relying on color alone; speaker colors remain on the avatars/borders.

Regression checks: `pnpm --filter cottonoha-web test:phrase-text` and
`pnpm --filter cottonoha-web test:autospeak`.

## Measurements, 2026-09-28

Local frontend/backend; synthetic Bulgarian; live ElevenLabs requests. These are
small diagnostic samples, not a production percentile or a latency guarantee.

| Measurement | Observed |
|---|---:|
| Previous v3 `/tts/speak`, full file ready, 2 requests | 1,896 / 3,365 ms |
| New `/tts/stream`, first PCM byte, 6 requests | 1,027 / 750 / 191 / 283 / 364 / 1,531 ms |
| New TTS first-byte median / range | 557 ms / 191–1,531 ms |
| Chromium, uncached translated text → signal on remote WebRTC audio track | 453 ms |
| Same browser/phrase, cached → remote audio signal | 125 ms |
| Synthetic English last clause → finalized Bulgarian translation | 625 ms after last input sample |
| Same synthetic last clause → first TTS byte, without draft prefetch | 788 ms after last input sample (164 ms TTS) |

The browser probe observed actual PCM energy on the remote WebRTC track, rather
than timing `audio.play()` or request headers. It excludes physical speaker/device
latency and microphone recognition/translation. Its audio graph was warmed first.
The separate Soniox test fed synthetic English PCM at real-time speed using the
app's current diarization configuration. It waited for a finalized translation of
the last clause, not an earlier translated prefix. This is one diagnostic replay;
it excludes browser/device output and is not a full latency distribution.
Separate Chromium and WebKit checks verified starting before response completion,
waiting for a delayed tail, and aborting scheduled playback.

## Reproduce

```sh
venv/bin/python backend/scripts/benchmark_tts.py --base-url http://127.0.0.1:8001 --runs 6
venv/bin/python backend/scripts/benchmark_tts.py --base-url http://127.0.0.1:8001 --runs 2 --legacy
venv/bin/python -m pytest backend/tests -q
pnpm --filter cottonoha-web test:autospeak
pnpm --filter cottonoha-web test:session-navigation
```

The benchmark calls the paid provider through the app. For an authenticated
backend, supply `COTTONOHA_AUTH_TOKEN` in the environment. No credentials or
conversation text are printed.

## Remaining delay

The pipeline still waits for finalized Soniox text/translation. Display mode does
not make speech wait for an English rewrite or a second translation. Recognition
and translation precede the TTS measurements above. Cache hits cannot help unseen
sentences.

Soniox endpoint detection remains disabled to preserve speaker context. Re-enabling
it solely to improve latency would reintroduce the documented diarization tradeoff.
A reliable 700 ms speech-to-speech target requires timing recognition finality,
translation readiness, first audio bytes and output together, including provider
tail latency. Draft prefetch overlaps synthesis only when a translation stabilizes
before confirmation; revised or late translations still pay that delay. It never
plays an unconfirmed prediction. The measured 788 ms replay already exceeds the
target before audio output, so this change does not establish a sub-700-ms guarantee.

Sources: [ElevenLabs models](https://elevenlabs.io/docs/overview/models),
[streaming endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/stream),
[latency guidance](https://elevenlabs.io/docs/developers/best-practices/latency-optimization).
Language coverage was also checked against the authenticated `/v1/models` API.
The advertised ~75 ms Flash latency is inference time, not end-to-end latency.
