# Speaker attribution and independent review

Soniox estimates who spoke from the incoming audio. The app does not identify a
person from pitch alone, and changing language does not establish a new person.
One mono microphone also does not physically isolate overlapping voices.

## Current paths

```text
Live audio → Soniox tokens → stream-local speaker mapping → bilingual paragraphs
                                                            └─ unknown stays unknown

Saved audio → Improve speakers → Soniox async → revised labels + existing text
                                             └─ local WeSpeaker voice check
                                                → disagreements / insufficient evidence
                                                → review notice, without automatic relabeling
```

The independent check runs after recording. It adds no model inference to the
live translation or autospeak path. It uses a different model, WeSpeaker ResNet34
LM through sherpa-onnx, and does not send the recording to another service.
The model and optional dependencies are local. Without them, the app explicitly
reports that the independent check is unavailable; normal transcription works.

## Attribution fixes

- Unattributed words no longer inherit the preceding speaker. Unknown turns are
  kept separate on web and iOS and cannot be renamed together as one person.
- A resumed Soniox connection receives a new speaker-ID namespace. A repeated
  provider ID does not establish that the same person returned. This may produce
  extra labels across recordings; no voice-based reidentification is claimed.
- Translation-only fallback captions no longer fabricate “You/Them” identities
  from language, or save all voices as speaker 1.
- Async remapping needs actual temporal overlap and a unique majority. Missing
  coverage and ties preserve the original estimate instead of assigning the
  nearest voice somewhere else in the recording.
- Async review also allocates fresh IDs above the existing labels. Its provider
  speaker 1 cannot merge with an uncovered live speaker 1 or inherit that person's
  saved name. Repeated reviews allocate a fresh namespace again.
- Explicit millisecond timestamps prevent early turns from being interpreted as
  thousands of seconds. Backward time jumps cannot join distant paragraphs.

## What the extra check can establish

It takes 1.5–3.5 second speech windows from original-word timestamps, excludes
known overlap, and checks up to 96 windows per provider label across the recording.
Translated text, language, and expected speaker count are not voice evidence.
Each conflicting voice pattern needs a second supporting sample before it can
raise a possible-merge warning. Embeddings stay in memory; only timestamps,
similarity scores, coverage, and review notices are saved in `rediarized.json`.

Cosine thresholds (0.65 for supporting samples, 0.35 for a conflict) are
conservative review triggers, not calibrated identity probabilities. Short turns,
unobserved overlap, echo, changing microphone position, and code-switching remain
failure modes. The model is trained on VoxCeleb; Bulgarian identity accuracy has
not been validated with human-labeled turns. A clean report is not proof of
correct diarization. The check does not force the expected number of people.

## Local setup

```sh
venv/bin/python -m pip install -r backend/requirements-speakers.txt
mkdir -p "$HOME/.cache/cottonoha/speakers"
curl -A 'OpenAI File Downloader, XaiImageApiFetch/1.0' -L --fail \
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx' \
  -o "$HOME/.cache/cottonoha/speakers/wespeaker_en_voxceleb_resnet34_LM.onnx"
```

Downloaded model SHA-256:
`e9848563da86f263117134dfd7ad63c92355b37de492b55e325400c9d9c39012`.
Set `SPEAKER_EMBEDDING_MODEL` for a different local path. No automatic model
download occurs when the server handles a request. FFmpeg must be installed.

Run a read-only audit without changing the conversation:

```sh
venv/bin/python backend/scripts/audit_speakers.py output/SESSION_NAME --output /tmp/speaker-audit.json
```

Both audit and cleanup currently require a single saved recording. Resumed
recordings use separate time origins and must not be aligned to just one file.

## Validation on 2026-09-28

A first screen using 24 windows per label missed disagreements in two existing
English/Bulgarian recordings. Increasing coverage to 96 per label checked all
120 eligible windows in the latest completed recording, taking 2.985 seconds on
this Mac. It flagged possible mixed voice patterns inside both existing labels.
For label 2, example timestamps were 3:41 and 19:03; for label 1, 3:36 and 18:15.
These are review candidates, not human-confirmed errors or identified people.

A fault-injection run collapsed that recording's labels into one in memory.
The independent check flagged the resulting possible merge using 96 sampled
windows in 3.020 seconds. The source recording and saved transcript were unchanged.
The earlier 24-window sample missed this injected merge: coverage matters.

Regression checks cover unknown-speaker leakage, numeric ID normalization,
resumed stream collisions, unsupported attribution, missing/tied async overlap,
repeated acoustic disagreement versus a single outlier, translation exclusion,
known overlap, and absent-model/short-audio fallback.

Before using the second model to automatically split or merge people, annotate
a representative clip with actual speakers and compare turn attribution,
speaker switches, missed people, false splits, and overlapping speech. Correct
speaker count alone is insufficient. For quick phone exchanges, explicit talk
buttons also give turn ownership without asking an acoustic model to guess it.

Sources: [Soniox diarization guidance](https://soniox.com/docs/stt/concepts/speaker-diarization),
[sherpa-onnx speaker identification example](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/speaker-identification.py),
[official model distribution](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models).
