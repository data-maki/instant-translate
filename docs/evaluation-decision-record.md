# Evaluation Decision Record

Generated from local evaluation artifacts on 2026-05-19. The heavy eval workspace is intentionally ignored in git; the compact CSV snapshot is `docs/solution-comparison-summary.csv`.

## Current Product Decision

The webapp keeps Soniox as the live runtime path and adds two explicit post-recording improvement passes:

```text
Live recording:
  Soniox realtime -> live transcript + live translation

After recording:
  Improve transcript
    1. Soniox async -> improved speaker labels
    2. OpenAI GPT-4o revision -> improved saved translations
```

This means the implemented core path is:

| Stage | Implemented choice | Why |
|---|---|---|
| Live transcript + live translation | Soniox realtime | Only proven realtime/runtime path in the app. Soniox already returns translation tokens in the realtime stream. |
| Post-recording speaker improvement | Soniox async | Best aggregate result among tested diarization APIs and already fits the token schema. |
| Post-recording translation improvement | OpenAI GPT-4o revision | Best simple post-processing candidate from the translation screens; kept explicit, not live. |
| Human speaker cleanup | Expected speaker metadata now; label/merge UI still pending | We prefer over-identifying clusters and letting a human label/merge at the end. |

Important caveat: the saved realtime baseline rows are from previously saved Soniox realtime transcript JSON. The app has since been switched to `stt-rt-v4`; rerun live fixtures before making a fresh realtime-vs-realtime vendor decision.

## Diarization / Speaker Comparison

Quality here is the automated speaker-count proxy, not completed human DER. Lower speaker-count error is better.

| Method | Recordings | Avg speaker-count error | Avg runtime | Avg cost | Decision |
|---|---:|---:|---:|---:|---|
| Soniox realtime | 3 | 3.67 | not measured | $0.010 avg | Keep as live baseline. |
| Soniox async | 3 | 2.33 | 26.843s | $0.008 avg | Integrated as the speaker step inside `Improve transcript`. |
| ElevenLabs | 3 | 2.67 | 9.440s | $0.018 avg | Good batch challenger; not integrated because it is not the current runtime path and cost was higher. |
| Speechmatics | 3 | 3.33 | 20.875s | $0.019 avg | Not integrated. |
| HappyScribe | 3 | 3.67 | 105.009s | $0.000 API-reported | Not integrated; API cost was likely account/trial behavior, not general pricing. |
| AssemblyAI | 3 | 4.67 | 26.339s | $0.014 avg | Not integrated. |
| Pyannote unknown N | 2 | 3.50 | 89.927s | $0.002 avg | Not integrated; no short-fixture lift, long fixture blocked. |
| Pyannote known N | 2 | 3.50 | 4.374s | $0.002 avg | Not integrated; known speaker count did not force six clusters. |

API aggregate standings:

| Rank | Method | Quality score | Speed score | Price score | Aggregate |
|---:|---|---:|---:|---:|---:|
| 1 | Soniox async | 100.0 | 81.8 | 58.3 | 80.0 |
| 2 | ElevenLabs | 85.5 | 100.0 | 8.3 | 64.6 |
| 3 | Speechmatics | 57.3 | 88.0 | 0.0 | 48.4 |
| 4 | HappyScribe | 42.7 | 0.0 | 100.0 | 47.6 |
| 5 | AssemblyAI | 0.0 | 82.3 | 29.2 | 37.2 |

## Per-Fixture Diarization Results

| Fixture | Method | True speakers | Predicted speakers | Error | Runtime | Cost |
|---|---|---:|---:|---:|---:|---:|
| jbg2 | Soniox realtime | 6 | 2 | 4 |  | $0.021720 |
| jbg2 | Soniox async | 6 | 2 | 4 | 52.295s | $0.018100 |
| jbg2 | AssemblyAI | 6 | 1 | 5 | 52.639s | $0.030770 |
| jbg2 | ElevenLabs | 6 | 2 | 4 | 15.415s | $0.039820 |
| jbg2 | HappyScribe | 6 | 4 | 2 | 129.971s | $0.000000 |
| jbg2 | Speechmatics | 6 | 4 | 2 | 25.100s | $0.043440 |
| jbg12 | Soniox realtime | 6 | 2 | 4 |  | $0.002487 |
| jbg12 | Soniox async | 6 | 3 | 3 | 12.136s | $0.002072 |
| jbg12 | Pyannote unknown N | 6 | 2 | 4 | 172.165s | $0.002100 |
| jbg12 | Pyannote known N | 6 | 2 | 4 | 2.975s | $0.002100 |
| jbg12 | AssemblyAI | 6 | 1 | 5 | 12.805s | $0.003523 |
| jbg12 | ElevenLabs | 6 | 4 | 2 | 2.887s | $0.004559 |
| jbg12 | HappyScribe | 6 | 1 | 5 | 87.557s | $0.000000 |
| jbg12 | Speechmatics | 6 | 1 | 5 | 18.742s | $0.004973 |
| jbg5 | Soniox realtime | 6 | 3 | 3 |  | $0.004800 |
| jbg5 | Soniox async | 6 | 6 | 0 | 16.097s | $0.004000 |
| jbg5 | Pyannote unknown N | 6 | 3 | 3 | 7.689s | $0.002100 |
| jbg5 | Pyannote known N | 6 | 3 | 3 | 5.773s | $0.002100 |
| jbg5 | AssemblyAI | 6 | 2 | 4 | 13.572s | $0.006800 |
| jbg5 | ElevenLabs | 6 | 4 | 2 | 10.019s | $0.008800 |
| jbg5 | HappyScribe | 6 | 2 | 4 | 97.499s | $0.000000 |
| jbg5 | Speechmatics | 6 | 3 | 3 | 18.784s | $0.009600 |

## Translation Comparison

The app keeps Soniox inline translation for live display because it is already returned in the realtime stream. OpenAI revision is a post-recording improvement pass.

Screening summary:

| Method | JA->EN rating | EN->JA rating | Decision |
|---|---:|---:|---|
| Soniox inline | 2.98 | 4.00 | Keep for live speed. |
| DeepL | 2.97 | 4.17 | Not integrated. |
| GPT-4o direct | 3.17 | 4.25 | Not integrated; revision path was better. |
| GPT-4o revision | 3.40 | 4.33 | Integrated as the translation step inside `Improve transcript`. |
| GPT-4o context revision | 3.37 | 4.33 | Not integrated; no clear win over simpler revision. |
| GPT-4o dialogue revision | 3.33 | 4.25 | Not integrated; no clear win over simpler revision. |

Item-level LLM judge summary from the completed rating packs:

| Method | Rated candidates | Avg meaning | Avg naturalness | Avg overall |
|---|---:|---:|---:|---:|
| Soniox inline | 60 | 4.68 | 4.51 | 4.60 |
| DeepL | 60 | 4.12 | 3.88 | 4.00 |
| GPT-4o direct | 60 | 4.60 | 4.45 | 4.53 |
| GPT-4o revision | 60 | 4.71 | 4.60 | 4.65 |
| GPT-4o context revision | 60 | 4.73 | 4.56 | 4.65 |
| GPT-4o dialogue revision | 60 | 4.73 | 4.48 | 4.61 |

Translation caveat: the item-level judge did not show a large enough lift to replace live Soniox translation. That is why GPT-4o revision is implemented as an explicit post-recording action, not as the live translator.

## Final Notes For Future Revisit

- If we revisit realtime alternatives, benchmark realtime APIs directly on latency from audio sent to first stable transcript token and final sentence token. The current AssemblyAI, ElevenLabs, Speechmatics, and HappyScribe rows are batch/offline outputs.
- If we revisit speaker quality, complete the human diarization audit. The current decision used speaker-count error as a proxy.
- If we revisit Soniox realtime, rerun fixtures with `stt-rt-v4`; older saved realtime rows may reflect `stt-rt-v3`.
- The product preference is still: over-identify speakers first, then support fast human label/merge at the end of the meeting.
