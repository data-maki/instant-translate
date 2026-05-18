# Optional Goal Prompt: Diarization Research Eval

Use this when we want Codex to verify `docs/diarization-alternatives.md` like an ML researcher: measured against the real saved JSON transcripts and MP3/WAV recordings, with a repeatable eval harness and an improvement curve.

## Simple vs Best Path

Simple path: build an offline eval harness around the recordings we already have.

```text
output/<session>/*.mp3
output/<session>/*.json
        |
        v
manual speaker labels for a few clips
        |
        v
baseline vs alternatives
        |
        v
metrics table + curve
```

Best path: same harness, but split into fixed fixtures, ground truth labels, cached model outputs, and an experiment report.

```text
eval/fixtures/recordings
        |
        +--> eval/fixtures/ground_truth
        |
        +--> eval/runs/<method>/<recording>.json
        |
        v
eval/report.md + eval/metrics.csv + eval/curves.png
```

The simple path is faster. The best path is still small, but makes results reproducible and lets us compare methods without rerunning paid APIs.

## Goal Prompt

```text
Goal: verify the diarization, translation, and speaker-identification alternatives in docs/diarization-alternatives.md against the actual saved recordings in output/.

Act like a pragmatic ML researcher. Do not assume any method is better because benchmarks or vendor claims say so. Build the smallest reproducible evaluation loop that can answer: which method improves real recordings, by how much, at what cost/latency, and whether the lift is large enough to justify integrating it.

Primary data:
- Use saved session JSON transcripts and original MP3/WAV recordings from output/<session>/.
- Prefer sessions with known multi-speaker failures, especially Japanese board-game/family-dinner style recordings.
- If existing JSON transcripts are stale or incomplete, regenerate transcripts from the original audio and cache regenerated outputs under eval/runs/.

Required research structure:
1. Inventory available recordings and transcript JSON files.
2. Pick a small fixture set first: 2-3 recordings, with at least one known hard multi-speaker case.
3. Create or document ground truth before scoring:
   - For diarization: hand-label speaker turns for selected time windows.
   - For speaker identification: label which real person maps to each known voice where available.
   - For translation: either collect blind human ratings or mark that no true accuracy metric is available yet.
4. Implement or outline a repeatable eval harness that can run each method on the same fixtures and cache outputs.
5. Compare methods incrementally, not all at once.
6. Produce a report with metrics, failures, cost/latency, and a curve showing marginal lift from each method.

Evaluation ladder:
- Baseline A: current Soniox realtime transcript JSON from output/.
- Baseline B: Soniox async rediarization where rediarized.json exists, or regenerate it if SONIOX_API_KEY is available.
- Method C: pyannote global diarization with unknown speaker count.
- Method D: pyannote global diarization with known num_speakers.
- Method E: speaker embedding/enrollment on top of the best diarization output.
- Translation comparison: Soniox inline translation vs DeepL vs GPT-4o on the same finalized Japanese utterances.

Metrics:
- Diarization:
  - DER if ground truth time-aligned labels exist.
  - JER or cluster purity/coverage if useful.
  - speaker-count error: abs(predicted_speakers - true_speakers).
  - manual segment audit pass/fail for ambiguous cases.
- Speaker identification:
  - enrolled-speaker accuracy.
  - false-name assignment rate.
  - unknown-speaker fallback rate.
- Translation:
  - blind human rating average for meaning accuracy and naturalness.
  - optional latency and cost per finalized utterance.
- Do not call black-box API metrics "loss" unless there is a real supervised objective. Use "error", "accuracy", "DER", "rating", "latency", and "cost" instead.

Improvement curve:
- Produce a table and plot where each row is one added method in the evaluation ladder.
- Include absolute metric value and lift versus the previous row.
- Example columns:
  method, recordings, DER, speaker_count_error, id_accuracy, translation_rating, latency_sec, cost_usd, lift_vs_previous, notes.

Decision rules:
- Do not recommend integration without measured lift on real fixtures.
- Prefer the simplest method that clears the threshold.
- For diarization, require a lower DER or clearly better manual audit than Soniox async, not just a better speaker count.
- For translation, require at least +0.5 average blind-rating lift before replacing Soniox finalized translations.
- For identification, require correct matching for most enrolled speakers and no severe false-name assignments.
- If the bottleneck appears acoustic, stop algorithm work and recommend a recording-condition test instead.

Deliverables:
- eval/README.md explaining fixture setup and how to run the eval.
- eval/metrics.csv with one row per method/recording.
- eval/report.md summarizing results, curves, decisions, and next experiment.
- cached method outputs under eval/runs/ when external APIs are used.
- minimal code only; do not refactor the app unless a method wins and integration is explicitly requested.

Constraints:
- Keep diffs small.
- Preserve existing transcript/session structure.
- Do not add a database, auth, or production hardening.
- Ask for missing API keys only when a selected method cannot run without them.
- If no ground truth labels exist, first create the labeling format and score only the windows that are labeled.
```

## Practical First Experiment

Start with diarization only. Translation and real-name identification depend on a decent speaker partition, so running them before diarization is measured will produce noisy conclusions.

```text
1. Select 2 recordings from output/.
2. Label 5-10 minutes total with speaker turns.
3. Score Soniox realtime JSON.
4. Score Soniox async rediarized.json or regenerate it.
5. Score pyannote with known speaker count.
6. Plot DER / speaker-count error / cost.
```

That gives the first real curve:

```text
Soniox realtime -> Soniox async -> pyannote unknown N -> pyannote known N
```

Only after that curve shows lift should we spend time on enrollment embeddings or translation replacement.
