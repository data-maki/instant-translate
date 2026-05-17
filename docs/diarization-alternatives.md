# Diarization Alternatives — Research Log

A Bayesian-flavored brainstorm of orthogonal ways to improve speaker tagging when Soniox collapses 6+ speakers down to 2-3. Each hypothesis carries:

- **Hypothesis**: the concrete claim.
- **Mechanism**: why we believe this could work.
- **Prior P(success)**: subjective probability that this materially improves separation on Japanese ~6-speaker family conversations. "Material" means the system reliably distinguishes ≥4 of 6 speakers in a 30-min recording without manual relabeling.
- **Evidence that would update**: what experiment / data would shift the prior up or down most.
- **Cost**: rough engineering + ops effort.

Priors are calibrated against a baseline where Soniox alone delivers ~25% material-success (it sometimes catches 3-4 speakers when audio is close-mic).

The list is intentionally over-inclusive — many hypotheses will not be worth pursuing, but listing them makes the trade space legible.

---

## Category A — Replace or augment the diarization model

### H1. Local pyannote.audio with `num_speakers=N` hint
- **Hypothesis**: pyannote 3.1's ECAPA-TDNN embeddings + spectral clustering, given a hard speaker count, separates 6 Japanese family voices better than Soniox.
- **Mechanism**: Operates on language-agnostic acoustic embeddings, clusters globally on the whole file, and the speaker-count hint forces it to not collapse below N.
- **Prior P(success)**: **0.72** — pyannote benchmarks well on DIHARD-III and AMI; the speaker-count hint directly fixes the failure mode we observe.
- **Evidence that would update**: run on `japanese-board-game-4` MP3, count clusters. Sharp drop if pyannote also returns 2.
- **Cost**: ~150 LOC, free `HF_TOKEN`, ~500 MB model download, PyTorch dep.

### H2. AssemblyAI with `speakers_expected: 6`
- **Hypothesis**: AssemblyAI's universal-2 + diarizer behaves differently enough from Soniox to escape the same blind spot.
- **Mechanism**: Different proprietary model family; published benchmarks claim strong diarization, and the `speakers_expected` hint is comparable to pyannote's.
- **Prior P(success)**: **0.50** — cloud diarizers are often trained on similar data distributions and may share Soniox's bias toward conservative clustering. Less specialized for Japanese than pyannote.
- **Evidence that would update**: same MP3 test. If it also returns 2-3, prior drops; if it separates ≥5, prior goes to 0.85.
- **Cost**: ~120 LOC, paid API ($50 trial credit covers ~75 hours).

### H3. Google Cloud Speech-to-Text with `min_speaker_count`/`max_speaker_count`
- **Hypothesis**: Google's hint pair lets us bracket the answer, and their model has the largest training corpus of any cloud option.
- **Mechanism**: `min` + `max` is a stronger constraint than a single hint; the clusterer is forced into the [min, max] window.
- **Prior P(success)**: **0.55** — bracketing is theoretically the most powerful hint, but GCP STT is older and often outperformed by Soniox on transcription quality. Diarization may not be a focus.
- **Evidence that would update**: same MP3, same metric.
- **Cost**: heaviest setup of any (GCP project + service account + GCS bucket for async). ~200 LOC of glue.

### H4. NVIDIA NeMo TitaNet + MarbleNet
- **Hypothesis**: NeMo's diarization pipeline (VAD via MarbleNet, embeddings via TitaNet, clustering via NME-SC) is competitive with pyannote and runs entirely local.
- **Mechanism**: Different embedding model than ECAPA-TDNN; might catch acoustic distinctions pyannote misses.
- **Prior P(success)**: **0.65** — strong benchmarks, but heavier install, less ergonomic on Mac, and largely overlaps pyannote's strengths.
- **Evidence that would update**: useful only if pyannote underperforms; expected info gain is otherwise low.
- **Cost**: ~3 GB install, PyTorch + NeMo deps, ~200 LOC glue.

### H5. WhisperX (Whisper + pyannote bundled)
- **Hypothesis**: Same as H1, but with WhisperX's alignment giving us word-level timestamps that match Soniox's tokens more tightly.
- **Mechanism**: WhisperX runs forced alignment over the diarization output, which may produce cleaner segment boundaries than raw pyannote.
- **Prior P(success)**: **0.70** — strictly an improvement over raw pyannote on segment alignment quality, but the speaker-clustering core is identical.
- **Evidence that would update**: A/B against H1 on the same audio; expected delta is modest.
- **Cost**: same deps as H1 + Whisper model weights, ~3 GB total.

### H6. Picovoice Falcon (on-device, lightweight)
- **Hypothesis**: A fast on-device diarizer that's been trained on a different distribution might separate similar-timbre voices Soniox merges.
- **Mechanism**: Different model family, different training data; cheap to try.
- **Prior P(success)**: **0.30** — less prior work suggesting it beats pyannote; no speaker-count hint.
- **Evidence that would update**: quick test on one MP3.
- **Cost**: free tier API key, ~100 LOC, no PyTorch.

---

## Category B — Improve the audio that the diarizer sees

### H7. Mandatory mic-mode check on macOS
- **Hypothesis**: Voice Isolation / Wide Spectrum is the #1 cause of voice merging on Macs; promoting the advisory to a hard "press Enter to confirm Standard mode" gate would eliminate this class of failures.
- **Mechanism**: VI applies heavy spectral smoothing that flattens timbre — directly destroys what a diarizer needs.
- **Prior P(success)**: **0.45** that this alone materially helps, **0.85** that it removes one entire failure mode.
- **Evidence that would update**: ask user to record once with VI on, once with VI off, run same diarizer.
- **Cost**: ~10 LOC + UX prompt.

### H8. Switch to close-mic capture (lapel, USB, AirPods)
- **Hypothesis**: Built-in laptop mic across a dinner table is the worst case for any diarizer; close-mic captures defeat the room-merging problem.
- **Mechanism**: SNR is the single biggest lever in diarization quality; close-mic gains 15-25 dB SNR.
- **Prior P(success)**: **0.55** that this alone fixes most issues; **0.95** that this is a necessary precondition for any model-side fix to deliver.
- **Evidence that would update**: rerun a session with a $30 lapel.
- **Cost**: hardware purchase, UX prompt in the app.

### H9. VAD pre-segmentation before clustering
- **Hypothesis**: Running a strict Voice Activity Detector first, then handing only confident speech segments to the diarizer, reduces false speaker assignments on silence/noise.
- **Mechanism**: Removes the "phantom speaker" artifact where background noise gets clustered as its own voice.
- **Prior P(success)**: **0.25** — modest cleanup, doesn't address the merging problem.
- **Evidence that would update**: count "junk" speakers in current outputs; if low, VAD won't help.
- **Cost**: silero-vad or pyannote/voice-activity-detection, ~50 LOC.

### H10. Speech source separation (Sepformer / Asteroid)
- **Hypothesis**: Pre-separating overlapping speech into per-speaker streams gives the diarizer cleaner input.
- **Mechanism**: WHAMR! / WSJ0-2mix-trained models split mixed audio.
- **Prior P(success)**: **0.20** — separators often introduce artifacts that hurt diarization more than they help; in family settings, overlap rate is usually low (<10%).
- **Evidence that would update**: measure actual overlap rate in your recordings (cheap to compute from pyannote VAD output).
- **Cost**: heavy deps, slow inference, ~200 LOC.

### H11. Dereverberation preprocessing
- **Hypothesis**: Family rooms have reverb that smears speaker embeddings; WPE-style dereverb sharpens them.
- **Mechanism**: Linear prediction or NN-based dereverb reduces late-reflection energy.
- **Prior P(success)**: **0.25** — helps a little in reverberant rooms, neutral elsewhere.
- **Evidence that would update**: measure RT60 of recordings (or just listen for echo).
- **Cost**: nara_wpe or `pyannote-audio` enhancement pipelines, ~80 LOC.

---

## Category C — Use prior knowledge about who's speaking

### H12. Voice enrollment ("calibration session")
- **Hypothesis**: Capture 15-30 seconds of each known speaker reading a fixed sentence before the main session; match incoming tokens against enrolled embeddings via cosine similarity.
- **Mechanism**: Turns diarization into speaker verification, which is a much easier problem (90%+ EER < 2% on enrolled speakers).
- **Prior P(success)**: **0.80** for the recurring family-member case where you can pre-enroll once and reuse across sessions.
- **Evidence that would update**: try it on one session with a 30s pre-enrollment per speaker.
- **Cost**: requires Resemblyzer or pyannote embedding model, ~200 LOC + UX flow, ~10s/speaker per session (or one-shot if persistent).

### H13. Persistent speaker library
- **Hypothesis**: Once you've labeled "Speaker A = mom-in-law" in one session, that embedding should auto-match in the next session, *across days*.
- **Mechanism**: Store embeddings + name in `output/.speaker_library.json`; cosine-match new speakers at the start of each session.
- **Prior P(success)**: **0.75** conditional on H12 working at all — same tech, just persisted.
- **Evidence that would update**: run two consecutive sessions, check if labels transfer.
- **Cost**: small extension of H12, ~50 LOC.

### H14. Speaker-count inference from session metadata
- **Hypothesis**: User-provided context ("Sunday dinner, usually 6 people") + past sessions in same `--session` family lets us predict N without asking.
- **Mechanism**: Most family dinners have stable cast; we can default `num_speakers` from history.
- **Prior P(success)**: **0.40** — useful UX but doesn't fix accuracy; just removes one user prompt.
- **Evidence that would update**: low priority.
- **Cost**: trivial, ~30 LOC.

### H15. Linguistic / honorific cues to constrain speaker
- **Hypothesis**: In Japanese, honorifics (お父さん, ママ, あなた) and pronoun choices (僕 vs 私 vs 俺) reliably indicate speaker identity or addressee, which we can use as a soft constraint on speaker labels.
- **Mechanism**: Parse text, extract speaker indicators, downweight diarizer assignments that conflict.
- **Prior P(success)**: **0.20** — clever but brittle; lots of casual Japanese drops honorifics entirely, and the model would need careful tuning to not hallucinate roles.
- **Evidence that would update**: manually annotate a transcript with text-derived speakers and see if it agrees with audio.
- **Cost**: medium — NLP pipeline + tuning, ~300 LOC.

---

## Category D — Multi-modal and capture-protocol changes

### H16. Multi-device recording (each phone = one speaker)
- **Hypothesis**: Have each participant's phone record their own voice; merge with timestamps. Each channel is mostly one speaker → diarization becomes trivial.
- **Mechanism**: SNR per channel is 20-30 dB higher than a single far-field mic.
- **Prior P(success)**: **0.92** when logistics work — this is what podcasts do.
- **Evidence that would update**: try it once.
- **Cost**: app changes to ingest multiple WAVs + sync via cross-correlation; UX is the hard part.

### H17. Stereo / multi-channel mic with beamforming
- **Hypothesis**: A USB stereo or 4-mic array (e.g., ReSpeaker, MV7) + beamforming detects which direction a voice came from, used as a strong speaker prior.
- **Mechanism**: Direction-of-arrival estimation is well-developed; voices from distinct positions cluster trivially.
- **Prior P(success)**: **0.75** if positions are stable; **0.40** if people move (kids).
- **Evidence that would update**: try with a ReSpeaker mic.
- **Cost**: hardware ($60-200) + multi-channel ingest code, ~150 LOC.

### H18. Video / lip-movement multimodal cue
- **Hypothesis**: If we capture video, lip-movement detection + face recognition gives a near-perfect speaker label.
- **Mechanism**: AV-diarization (lip-sync ASR) is the SOTA on dinner-table benchmarks (AMI, EgoCom).
- **Prior P(success)**: **0.88** with good camera angles; **0.50** with one front-facing laptop camera and 6 people around a table.
- **Evidence that would update**: capture video alongside audio for one session.
- **Cost**: significant — video pipeline, face DB, alignment, ~600 LOC. Privacy considerations.

### H19. iPhone TrueDepth / face-tracking sidecar
- **Hypothesis**: An iPhone running a small companion app captures who's facing the camera at any moment, sends speaker hints over local network.
- **Mechanism**: Same as H18 but using existing phone hardware.
- **Prior P(success)**: **0.65** conditional on building the companion app.
- **Cost**: high — Swift app, networking, alignment. Don't build this until cheaper options exhaust.

---

## Category E — UI-assisted labeling

### H20. Push-to-tag during live recording
- **Hypothesis**: A "tap to mark next speaker as X" key — user manually labels speaker changes in real time as they happen.
- **Mechanism**: Trades user attention for accuracy; works because conversation pace is slow enough to keep up.
- **Prior P(success)**: **0.85** as a fallback, **0.50** as a primary mode (annoying).
- **Evidence that would update**: try in one session.
- **Cost**: ~80 LOC, builds on existing rename flow.

### H21. Post-session review-and-fix UI
- **Hypothesis**: A scrubbable timeline UI where the user clicks on misassigned segments and corrects them in 30 seconds per session.
- **Mechanism**: Cheapest path to ground-truth labels.
- **Prior P(success)**: **0.95** for accuracy after review; manual labor is just guaranteed to work.
- **Evidence that would update**: design and try.
- **Cost**: medium — needs a real UI (frontend work, not CLI), ~400 LOC.

### H22. Active-learning loop
- **Hypothesis**: Diarizer flags low-confidence segments; user is prompted to confirm only those; model retrained / fine-tuned per user.
- **Mechanism**: Compounds H21 with self-improvement over time.
- **Prior P(success)**: **0.70** with patient user; **0.30** otherwise.
- **Cost**: high — requires fine-tunable embedding model + UI.

---

## Category F — Post-processing the diarizer's output

### H23. Constraint-based smoothing
- **Hypothesis**: Apply rules like "minimum segment 1 s", "speakers don't change mid-word", "same speaker cannot have two overlapping segments" to clean up flutter.
- **Mechanism**: Removes obviously wrong micro-flicker.
- **Prior P(success)**: **0.40** for marginal improvement; doesn't fix the merging problem.
- **Cost**: ~100 LOC.

### H24. Bayesian re-clustering on raw embeddings
- **Hypothesis**: Extract per-segment embeddings from any diarizer, run Variational Bayes HMM with informed priors on speaker count and turn duration.
- **Mechanism**: Re-cluster with explicit Bayesian model rather than greedy spectral.
- **Prior P(success)**: **0.50** — moderate gains documented in academic literature (e.g., VBx clustering).
- **Cost**: ~250 LOC; specialized expertise.

### H25. Ensemble vote across diarizers
- **Hypothesis**: Run pyannote, AssemblyAI, and one other; assign each token the speaker most agreed upon.
- **Mechanism**: Ensembles reduce idiosyncratic errors.
- **Prior P(success)**: **0.45** — works when failure modes are uncorrelated, which they may not be.
- **Cost**: trivial once H1-H3 exist; orchestration ~100 LOC.

---

## Recommended experiment order (highest expected info gain first)

The expected info gain ranks roughly as `P(success) × novelty × cost⁻¹`. My ordering for the *next 5 experiments*:

1. **H1 — pyannote with `num_speakers=6`**. Highest prior, lowest cost, free. Run on existing MP3s; one afternoon of work.
2. **H7 — mandatory mic-mode check**. Free, eliminates a known confounder.
3. **H12 — voice enrollment**. Highest prior among "novel UX" approaches; recurring-family-member case is ideal for it.
4. **H16 — multi-device recording test**. High prior; one logistical experiment validates whether hardware is the answer.
5. **H2 — AssemblyAI with `speakers_expected`**. Only if H1 underperforms; provides a useful comparison datapoint.

Skip until later: H4, H10, H11, H15, H18, H19, H22, H24.

## What would falsify the whole research program

If we run H1, H2, H12, and a close-mic capture (H8), and *none* materially beats Soniox, then the bottleneck is acoustic — the recordings are too reverberant or too low-SNR for any current diarizer. At that point the only paths forward are H16-H19 (capture protocol changes) or H21 (manual labeling). That outcome would have an estimated prior of **~15%** before the experiments and would drive significant product redesign.
