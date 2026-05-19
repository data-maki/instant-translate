# Current Pipeline

## Which Soniox model do we use?

We use both, but for different moments in the workflow.

| Path | Current model | When it runs | What it does |
|---|---|---|---|
| Live session | Soniox realtime `stt-rt-v4` | While the browser is recording | Live transcription, language ID, speaker diarization, endpoint detection, and two-way JA/EN translation |
| Improve transcript, speaker step | Soniox async `stt-async-v4` | After a session has saved audio | Re-runs diarization/transcription over the full audio file, then remaps speaker IDs onto the current transcript tokens |
| Improve transcript, translation step | OpenAI `gpt-4o` | After a session has transcript tokens | Revises the Soniox draft translations while preserving the transcript shape |
| Comparison record | See `docs/evaluation-decision-record.md` | Documentation only | Historical vendor comparison; not wired into the app runtime |

So the default app is Soniox realtime. The only post-processing UI action is `Improve transcript`; internally it runs the speaker step first and the translation step second.

## ASCII Pipeline

```text
                         CURRENT WEBAPP RUNTIME

  Browser / Next.js
  frontend/src/components/TranslatorApp.tsx
  -----------------------------------------------------------------
  [mic permission]
        |
        v
  [WebAudio recorder: 16kHz mono PCM]
        |
        | binary audio chunks
        v
  WebSocket: /ws/transcribe
        |
        v
  FastAPI backend
  backend/app/main.py
  -----------------------------------------------------------------
  [accept websocket]
        |
        | start payload:
        | - session_name
        | - source_languages: [ja, en]
        | - target_language
        | - context
        v
  Soniox realtime bridge
  backend/app/soniox.py
  -----------------------------------------------------------------
  [connect to wss://stt-rt.soniox.com/transcribe-websocket]
        |
        | config:
        | - model: stt-rt-v4
        | - enable_language_identification: true
        | - enable_speaker_diarization: true
        | - enable_endpoint_detection: true
        | - translation: two_way
        v
  Soniox realtime API
        |
        | streaming tokens:
        | - original text
        | - translated text
        | - language
        | - speaker
        | - timestamps
        | - final/partial state
        v
  Backend session shaping
  backend/app/sessions.py
  -----------------------------------------------------------------
  [process_soniox_tokens]
        |
        v
  [build_phrases]
        |
        | transcript events
        v
  Browser transcript feed
        |
        v
  User sees live bilingual phrase cards
```

## Save Path

```text
  Stop recording
        |
        v
  Session.save_segment()
  cli/live_transcriber/session.py
        |
        +--> output/<session>/session_state.json
        +--> output/<session>/segment_###_<timestamp>.json
        +--> output/<session>/segment_###_<timestamp>.txt
        +--> output/<session>/segment_###_<timestamp>.wav
        +--> output/<session>/segment_###_<timestamp>.mp3
```

## Improve Transcript Path

```text
  User clicks "Improve transcript"
        |
        v
  Step 1: improve speakers
        |
        v
  POST /sessions/<session>/rediarize
  backend/app/main.py
        |
        v
  Find latest saved MP3/WAV in output/<session>/
        |
        v
  Soniox async diarization
  cli/live_transcriber/async_diarize.py
        |
        | upload file
        | create transcription:
        | - model: stt-async-v4
        | - enable_speaker_diarization: true
        | - enable_language_identification: true
        | - translation: one_way
        v
  Soniox async API
        |
        v
  async_tokens with full-file speaker clustering
        |
        v
  _apply_async_speakers()
  backend/app/main.py
        |
        | keeps current transcript text/translations
        | replaces speaker labels by timestamp overlap
        v
  output/<session>/rediarized.json
  output/<session>/rediarized.txt
        |
        v
  Browser phrase cards refresh with improved speakers
        |
        v
  Step 2: improve translations
        |
        v
  POST /sessions/<session>/retranslate
  backend/app/main.py
        |
        v
  Load latest transcript tokens
        |
        | precedence:
        | 1. latest of retranslated.json / rediarized.json
        | 2. session_state.json tokens
        v
  Build source/draft translation samples
        |
        v
  OpenAI Responses API
        |
        | model: gpt-4o
        | task: revise draft captions, preserve meaning/tone/context
        v
  Revised translation strings
        |
        v
  _apply_revised_translations()
        |
        v
  output/<session>/retranslated.json
  output/<session>/retranslated.txt
        |
        v
  Browser phrase cards refresh with improved translations
        |
        v
  Human labels/merges speakers
        |
        v
  output/<session>/speaker_review.json
  output/<session>/speaker_review.txt
```

## Human Speaker Review Constraint

At session start, the UI can collect an expected speaker count and optional speaker names. Those values are saved as session metadata for the review flow. They do not force Soniox to return that count, and they do not trigger any automatic merge.

The desired post-meeting behavior is to let the model over-identify speakers rather than under-identify them. Extra anonymous clusters are acceptable because a human can quickly label and merge them later. Collapsed speakers are worse because separating them manually is slower.

```text
  preferred failure mode:
    Speaker A + Speaker B + Speaker C + Speaker D
      -> human labels/merges extra clusters quickly

  bad failure mode:
    Speaker A absorbs Speaker B/C/D
      -> human has to split mixed speech manually
```

## Artifact Precedence

```text
  GET /sessions/<session>
        |
        v
  _latest_tokens_for_session()
        |
        +--> use newest improved artifact:
        |       speaker_review.json, retranslated.json, or rediarized.json
        |
        +--> otherwise use session_state.json tokens
```

## Current Boundary

```text
  Runtime app:
    Soniox realtime stt-rt-v4
    Soniox async stt-async-v4
    OpenAI gpt-4o translation revision

  Historical comparison:
    docs/evaluation-decision-record.md
    docs/solution-comparison-summary.csv
```
