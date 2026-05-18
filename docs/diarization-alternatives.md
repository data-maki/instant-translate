# The Plan

Three problems. One hypothesis per problem, the cheapest test that confirms or refutes it, and the decision we make from the result.

The hypotheses below are inferences from API behavior and third-party benchmarks. **None of them are verified on our actual recordings.** Don't ship a change because it "should" work — ship it because the test below produced a result.

---

## 1. Speaker detection + diarization

**Problem**: Soniox returns 2–3 speakers when the recording has 6.

**Hypothesis**: Soniox's realtime diarizer does online clustering with no global pass — once two voices merge, they stay merged. Running pyannote 3.1 with `num_speakers=N` globally on the saved audio finds closer to N distinct speakers.

**What's known vs. inferred**:
- *Inferred*: Soniox's online-clustering behavior (from API shape and observed merging — no public writeup).
- *Inferred*: pyannote will do better on *our* audio. Its benchmarks are on DIHARD/AMI, not Japanese family dinners recorded on a laptop mic.

**Test** (~1 hour, a few dollars in Replicate credits):
1. Pick one saved fixture where Soniox merged a known ≥5-speaker conversation into 2–3.
2. Upload the audio to Replicate's hosted `pyannote/speaker-diarization-3.1` with `num_speakers=<known count>`.
3. Count distinct speakers returned. Spot-check ~20 segments by ear — is the partition sensible?

**Decision**:
- Pyannote returns ≥ N−1 distinct speakers AND segment audit looks reasonable → integrate as the offline diarization pass; replace the current `rediarized.json` Soniox-async fallback.
- Pyannote also collapses → the bottleneck is acoustic (mic, room, Voice Isolation), not the diarizer. Before doing anything else, re-record one session with macOS VI off and the user wearing AirPods, then rerun the same test.
- Pyannote returns reasonable count but segment boundaries are wrong → keep investigating; don't ship.

---

## 2. Translation

**Problem**: We don't actually know if Soniox's translation is the bottleneck. Speed feels fine; quality is unmeasured.

**Hypothesis 1**: DeepL (or GPT-4o) produces materially better JA→EN translations than Soniox's inline translation.

**Hypothesis 2**: Translating only on finalized utterances (instead of every tentative token) is fast enough that the user doesn't notice added latency, while cutting compute.

**What's known vs. inferred**:
- *Reputation, not measured*: DeepL is widely regarded as best-in-class for JA↔EN. We haven't compared on our transcripts.
- *Inferred*: Soniox retranslates aggressively on tentative tokens, which is wasted compute. We haven't actually profiled this.

**Test** (~2 hours):
1. Take 30 finalized Japanese utterances from a saved session.
2. Translate each with: Soniox (already in transcript), DeepL, GPT-4o.
3. Blind-rate (random order, hide source) on a 1–5 scale for naturalness and meaning-accuracy.
4. Separately, instrument the live pipeline to log how many translation calls happen per finalized utterance today.

**Decision**:
- One alternative wins on blind quality by ≥0.5 points average → adopt it for finalized text; keep Soniox tokens for live display.
- Tie or Soniox wins → don't change anything; the perceived translation problem isn't real.
- Either way, if the instrumentation shows Soniox is retranslating tentatives wastefully, gate translation calls on the final flag.

---

## 3. Identification

**Problem**: "Speaker 1" isn't useful. We want real names.

**Hypothesis**: A short voice enrollment per family member, stored as an embedding, matches the speaker accurately enough in real dinner-table sessions to replace anonymous labels with names.

**What's known vs. inferred**:
- *Measured on clean benchmarks*: ECAPA-TDNN speaker verification has EER <2% on clean speech.
- *Inferred (with low confidence)*: this carries over to laptop-mic dinner-table acoustic conditions. It might not — far-field and enrollment-clip distributions can diverge enough that embeddings don't match well.

**Test** (~3 hours):
1. Record 30s clean enrollment clips from 2–3 family members (anywhere — coffee shop, quiet room, just close-mic).
2. Compute embeddings via pyannote-embedding or Resemblyzer.
3. Take a saved dinner session containing those people. For each pyannote cluster (from problem 1's output), compute its mean embedding and match against the enrollment library.
4. Manually check: does each enrolled person's cluster get matched to the correct name?

**Decision**:
- ≥2 of 3 enrolled speakers match correctly → ship enrollment as the identification path; unmatched clusters fall back to "Speaker N" with a prompt at session save.
- Matching is unreliable → try enrolling on *dinner-condition* audio of the same person (a saved session where you already know who's who); the acoustic mismatch may be the issue.
- Still unreliable → embedding-based ID isn't viable here; manual naming at session end is the only path.

---

## API keys needed to run the tests

Add these to `.env` alongside the existing `SONIOX_API_KEY`. Each key is only needed for the test(s) noted.

| Key | Used by | Tests |
|---|---|---|
| `SONIOX_API_KEY` | Soniox realtime (already set) | All three |
| `REPLICATE_API_TOKEN` | Replicate-hosted pyannote 3.1 | 1 (diarization), 3 (embeddings if going via Replicate) |
| `HF_TOKEN` | Direct pyannote-audio + pyannote-embedding from HuggingFace | 1, 3 (alternative to Replicate; needed once we move pyannote local) |
| `DEEPL_API_KEY` | DeepL Free or Pro translation API | 2 (translation A/B) |
| `OPENAI_API_KEY` | GPT-4o translation, and any later Whisper-API or gpt-realtime experiments | 2 (translation A/B) |

Variable names match each vendor's own SDK conventions (`REPLICATE_API_TOKEN`, `HF_TOKEN`) so client libraries pick them up without extra wiring.

Resemblyzer (the alternative embedding library for test 3) runs locally and needs no key.

---

## What we don't do until something concrete breaks

- Don't build multi-device capture, mic arrays, video pipelines, ensemble voting, VAD pre-segmentation, or constraint smoothing.
- Don't run an ASR bake-off (Gladia, Whisper API, gpt-realtime-2, etc.). Soniox's ASR quality isn't an observed problem; only diarization and possibly translation are.
- Don't refactor session JSON into a layered data model. Once pyannote is integrated, overwrite the `speaker` field directly.
- Don't pre-commit to any solution above on the basis of "it should work." Run the test first.
