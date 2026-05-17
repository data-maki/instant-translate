# Goal: Web App Transformation

Transform this repo from a terminal-only live translator into a responsive web app, while preserving the existing CLI as a working legacy path.

Repo: `/Users/jcarbs/Code/mother_in_law_decoder`

## Current State To Preserve

- Current CLI entrypoint is `main.py`.
- Current core package is `live_transcriber/`.
- It uses Soniox realtime WebSocket transcription/translation, session persistence, speaker tracking, Japanese romaji helpers, and terminal UI.
- Current `requirements.txt` is Python-only and includes `websockets`, `pyaudio`, `python-dotenv`, `rich`, `prompt_toolkit`, `requests`, and `pykakasi`.
- Current output goes under `output/<session>/`.

## Target Outcome

Build an end-to-end web version that is useful for an English speaker and a Japanese speaker in Japan, with English/Japanese as the default priority pair. Keep the language model flexible enough to add other languages later, but do not overbuild multi-language features beyond what is needed now.

## Required Product Behavior

- Responsive UI that works well on desktop and phone.
- A live chat/live-translation style transcript that scrolls naturally as conversation arrives.
- Clear bilingual display for English and Japanese speakers.
- Show live partial text and finalized transcript entries distinctly.
- Keep speaker labels readable and stable.
- Let the user start/stop a session from the browser.
- Let the user choose or confirm the language pair, defaulting to English <-> Japanese.
- Let the user provide an optional session name and optional context hint.
- Keep transcript history readable while live updates continue.
- Preserve session saving/loading behavior where practical.
- Use simple, direct UI. No marketing landing page.

## Implementation Direction

1. First inspect the repo and current git status. Preserve existing user changes.
2. Move/package the existing CLI into a `cli/` folder with minimal changes. The CLI should still run after the move.
   - Prefer a mechanical move over a redesign.
   - Keep its behavior equivalent: device listing, session name, context, source/target languages, terminal UI, saved output.
   - Update imports, paths, README commands, and requirements as needed.
3. Create a FastAPI backend in `backend/`.
   - Reuse as much existing session/transcription/language logic as makes sense.
   - Do not require PyAudio for the web path. Browser audio should come from the frontend.
   - Expose endpoints for supported languages, session metadata, and health.
   - Expose a WebSocket endpoint for live audio chunks and transcript events.
   - The backend should connect to Soniox and stream browser audio to Soniox.
   - Return normalized events suitable for the UI: status, partial transcript, final transcript, error, session saved.
   - Keep `.env` usage simple; read `SONIOX_API_KEY` from one `.env`/environment.
4. Create a Next.js React frontend in `frontend/`.
   - Use the browser microphone APIs to capture audio.
   - Stream audio to the FastAPI backend WebSocket.
   - Render transcript as a chat/live translation feed, newest messages visible and scrollable.
   - Make the layout responsive for phone and desktop.
   - Prioritize English/Japanese labels, typography, spacing, and mobile usability.
   - Avoid decorative/marketing UI; make the first screen the actual tool.
5. Keep the architecture simple.
   - Do not add auth, a database, queues, Docker, or a production deployment setup unless required for local correctness.
   - If a browser audio format conversion is needed, implement the smallest reliable path and document it.
   - If Soniox requires PCM 16kHz mono and the browser provides another format, handle conversion explicitly and verify it.

## Suggested Target Structure

```text
mother_in_law_decoder/
  cli/
    main.py
    debug_mic.py
    live_transcriber/        # existing CLI/core code, or shared code if cleaner
    requirements.txt         # CLI deps, including pyaudio/rich
  backend/
    app/
      main.py                # FastAPI app
      soniox.py              # Soniox WebSocket bridge
      sessions.py            # session persistence/reuse wrapper
      languages.py           # language list/reuse wrapper
    requirements.txt
  frontend/
    app/ or src/app/         # Next.js app router
    components/
    lib/
    package.json
  README.md
  .env.example
```

If a different structure is simpler after reading the repo, use it, but explain why before making broad moves.

## UI Requirements

- First screen should be the usable translator, not a landing page.
- Desktop layout: compact header controls, main transcript feed, session/status area.
- Mobile layout: controls collapse cleanly above the transcript; transcript remains the primary surface.
- Transcript message cards/rows should show speaker, detected language, original text, translated text, and timestamp if available.
- Japanese text should be easy to read; include romaji only if the existing helper makes it cheap and useful.
- Add clear states: idle, requesting microphone, connecting, listening, stopping, error.
- Include obvious start/stop controls.
- Avoid nested cards and oversized hero styling.

## Verification Requirements

- Run Python syntax/import checks for the moved CLI and backend.
- Run backend tests or at least start/import FastAPI successfully.
- Run frontend typecheck/build/lint depending on what scripts exist.
- Start the local dev servers if practical and verify the UI loads in a browser.
- Verify the CLI still has a plausible runnable command after the move.
- If live Soniox testing cannot be completed because of microphone/API/runtime constraints, clearly say exactly what was and was not verified.

## Documentation Requirements

- Update README with separate CLI, backend, and frontend local run commands.
- Update `.env.example` if needed.
- Document the local development flow in the simplest possible way.
- Keep notes concise.

## Constraints

- Minimal diffs, preserve existing structure where possible.
- Do not overengineer.
- Do not add auth or database.
- Do not break the existing CLI.
- Use React + Next.js for frontend and FastAPI for backend.
- Keep English/Japanese in Japan as the core user scenario.
- Work end to end: inspect, implement, verify, and report exactly what changed and what commands passed.
