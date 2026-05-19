# Diarization Research Status

This file is the short status after the comparison work. The detailed numbers are in:

- `docs/evaluation-decision-record.md`
- `docs/solution-comparison-summary.csv`

## Current Product Path

```text
Live meeting
  -> Soniox realtime stt-rt-v4
  -> live transcript + live JA/EN translation
  -> saved session
  -> Improve transcript
       -> Soniox async stt-async-v4 speaker remap
       -> OpenAI GPT-4o translation revision
```

The runtime app should stay simple:

- One live path.
- One post-recording improvement action.
- No vendor bake-off code in runtime paths.
- No automatic speaker merging yet.

## What Is Obsolete

These were comparison paths only and should not live in app code:

- Pyannote unknown speaker count.
- Pyannote known speaker count.
- AssemblyAI diarization.
- HappyScribe diarization.
- Speechmatics diarization.
- ElevenLabs diarization.
- DeepL translation.
- GPT-4o direct/context/dialogue translation variants.
- Separate speaker-only and translation-only UI buttons.

The only durable output from that work is the decision record and compact CSV snapshot.

## Pending Validation

Before calling diarization fully solved:

1. Human-audit Soniox async speaker assignments.
2. Rerun live fixtures with Soniox `stt-rt-v4` if we revisit realtime alternatives.

The product preference remains: over-identify speakers first, then let a human quickly label and merge extra clusters.
