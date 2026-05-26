# Backend Refactor: Split `main.py` into Routers + Services

**Date:** 2026-05-26
**Branch:** `feat/simplifying`
**Status:** Approved design

## Problem

`backend/app/main.py` is a single ~1565-line module holding the FastAPI app
instance, CORS config, all 20 HTTP/WebSocket endpoints, and every piece of
business logic (Google Places scraping, ElevenLabs TTS, OpenAI name-katakana,
OpenAI realtime session minting, OpenAI translation revision, session token /
artifact processing, speaker-review logic). This makes the file hard to read,
hard to test in isolation, and hard to change without touching unrelated code.

## Goal

Reorganize into domain `routers/` (HTTP concerns only) and `services/` (pure
logic) following FastAPI's `APIRouter` conventions and OpenAPI operation
grouping (each router carries `tags`). **No public endpoint paths change. No
functionality is removed.**

## Scope decisions (confirmed)

- **Keep all endpoints, including the three currently unused by any client**
  (`GET /tts/voices`, `POST /sessions/{name}/auto-title`,
  `POST /sessions/{name}/speakers`). This is a pure relocation — delete nothing.
- **Two layers:** routers (HTTP) + services (logic). Existing top-level modules
  (`auth`, `languages`, `sessions`, `phrase_upgrade`, `soniox`,
  `provider_streams`, `shared`) already serve as part of the service layer and
  stay where they are.
- **Approach A (proper relocation):** move helpers to their real modules and
  update the handful of namespace-sensitive test targets to match. No
  re-export shims in `main.py`.

## Hard constraints (must not break)

1. `app` must remain importable as `from app.main import app` (tests + uvicorn
   entrypoint `app.main:app`).
2. Every final route path stays byte-identical. Routers use `prefix=` such that
   `prefix="/context"` + `@router.post("/places")` → `/context/places`.
   Frontend (`frontend/src/lib/api.ts`) and CLI (`cli/backend_client.py`,
   uses `/ws/transcribe`) keep working unchanged.
3. `require_user` (from `app.auth`) stays the dependency object used by every
   protected route, so `app.dependency_overrides[require_user]` in
   `conftest.py` keeps working.
4. The full backend test suite (`backend/tests/`) passes after the refactor.

## Target structure

```
backend/app/
├── main.py              # app = FastAPI(...), CORS, include_router() x6. ~25 lines.
├── shared.py            # unchanged
├── auth.py              # unchanged
├── languages.py         # unchanged (service-layer helper module)
├── sessions.py          # unchanged (session persistence / summaries)
├── phrase_upgrade.py    # unchanged (Groq rewrite + DeepL translate service)
├── soniox.py            # unchanged
├── provider_streams.py  # unchanged
├── routers/
│   ├── __init__.py
│   ├── health.py        # GET /health                       tags=["health"]
│   ├── languages.py     # GET /languages                    tags=["languages"]
│   ├── context.py       # POST /context/*                   prefix="/context" tags=["context"]
│   ├── tts.py           # GET /tts/voices, POST /tts/speak  prefix="/tts" tags=["tts"]
│   ├── sessions.py      # all /sessions/*                   prefix="/sessions" tags=["sessions"]
│   └── transcribe.py    # POST /realtime/translation-session, WS /ws/transcribe  tags=["realtime"]
└── services/
    ├── __init__.py
    ├── places.py        # Google Places + Maps-list scraping
    ├── tts.py           # ElevenLabs voice/model maps + speak orchestration
    ├── katakana.py      # OpenAI name -> katakana options
    ├── realtime.py      # OpenAI realtime client-secret minting
    └── transcripts.py   # session token/artifact reading, retranslate, rediarize, speaker review
```

## Endpoint -> router map (all retained)

| Endpoint | Router |
|---|---|
| `GET /health` | `health.py` |
| `GET /languages` | `languages.py` |
| `POST /context/places` | `context.py` |
| `POST /context/maps-list` | `context.py` |
| `POST /context/rewrite` | `context.py` |
| `POST /context/translate` | `context.py` |
| `POST /context/name-katakana` | `context.py` |
| `GET /tts/voices` | `tts.py` |
| `POST /tts/speak` | `tts.py` |
| `GET /sessions` | `sessions.py` |
| `GET /sessions/{session_name}` | `sessions.py` |
| `POST /sessions/{session_name}/adaptations` | `sessions.py` |
| `PATCH /sessions/{session_name}` | `sessions.py` |
| `POST /sessions/{session_name}/auto-title` | `sessions.py` |
| `DELETE /sessions/{session_name}` | `sessions.py` |
| `POST /sessions/{session_name}/rediarize` | `sessions.py` |
| `POST /sessions/{session_name}/retranslate` | `sessions.py` |
| `POST /sessions/{session_name}/speakers` | `sessions.py` |
| `POST /realtime/translation-session` | `transcribe.py` |
| `WS /ws/transcribe` | `transcribe.py` |

## Helper -> service map

**`services/places.py`** (from `main.py`): `_google_maps_api_key`,
`_payload_float`, `_google_place_types`, `_fetch_google_places`,
`_places_context`, `_place_name`, `_fetch_google_maps_list`, `_http_text`,
`_extract_google_maps_list_title`, `_extract_google_maps_list_places`,
`_google_maps_list_place_from_node`, `_base_terms_for_place_signal`,
`_base_translation_terms_for_place_signal`, `_dedupe`.
(`_payload_float` / `_dedupe` are generic; keep them here as places-local
helpers since places is their only caller.)

**`services/tts.py`** (from `main.py`): `ELEVENLABS_*` constants and voice maps,
`_elevenlabs_request`, the `/tts/voices` payload builder, and the model-fallback
speak orchestration (returns audio bytes/base64 + chosen model; the router does
the `HTTPException` wrapping).

**`services/katakana.py`** (from `main.py`): `_openai_name_katakana_options`
(imports `extract_openai_text` from `app.sessions`).

**`services/realtime.py`** (from `main.py`): the OpenAI
`/v1/realtime/translations/client_secrets` request logic.

**`services/transcripts.py`** (from `main.py`): `_latest_audio_path`,
`_atomic_write_text`, `_latest_tokens_for_session`, `_read_session_adaptations`,
`_write_session_adaptations`, `_latest_transcript_artifact`,
`_improved_artifacts_by_recency`, `_session_from_tokens`,
`_apply_async_speakers`, `_best_speaker_for_window`,
`_translation_samples_from_tokens`, `_revise_translation_samples`,
`_apply_revised_translations`, `_speaker_key`, `_coerce_speaker`,
`_apply_speaker_review`, `_apply_speaker_labels`.

**Stays in `routers/sessions.py`** (HTTP-specific, raises `HTTPException`):
`_require_owner`.

**Stays in `phrase_upgrade.py`** (already there; context router imports
directly): `_translate_with_deepl`, `_adapt_phrase_with_groq`, `_deepl_context`,
`_deepl_formality`, `_deepl_translate_url`, `DEEPL_PRO_TRANSLATE_URL`, etc.

### Service function naming

Functions moved into a service get their leading underscore dropped (they become
that module's public API), e.g. `_fetch_google_places` ->
`places.fetch_google_places`, `_revise_translation_samples` ->
`transcripts.revise_translation_samples`. Routers call them as
`places.fetch_google_places(...)`. Internal-only helpers may keep the
underscore.

## Test changes required (Approach A)

These are the only test edits; they retarget namespace-sensitive references to
the symbols' new homes. No assertions change.

1. `conftest.py`: `app.main.session_belongs_to` ->
   `app.routers.sessions.session_belongs_to`.
2. `conftest.py`: `app.main.resolve_user_from_token` ->
   `app.routers.transcribe.resolve_user_from_token`.
3. `test_app.py`: `app_main._deepl_translate_url`,
   `app_main._deepl_formality`, `app_main.DEEPL_PRO_TRANSLATE_URL` -> import
   from `app.phrase_upgrade` (their true source).
4. `test_app.py:700`: monkeypatch `app_main._revise_translation_samples` ->
   `app.services.transcripts.revise_translation_samples` (the name the sessions
   router actually calls).

`from app.main import app` and the `require_user` dependency override are
unchanged.

## Risks

- **Namespace-sensitive monkeypatch:** the retranslate test patches the revise
  function; the patch must target the module the router looks it up in. The
  sessions router must reference it as `transcripts.revise_translation_samples`
  (module attribute access), not a bare imported name, so the monkeypatch takes
  effect. Mirror this for any other patched helper.
- **WebSocket on APIRouter:** `@router.websocket("/ws/transcribe")` is supported;
  verify the auth-before-accept flow and `resolve_user_from_token` import path
  still work.
- **Circular imports:** services must not import routers. Routers import
  services and existing modules only.

## Verification

- `cd backend && python -m pytest` is green.
- `uvicorn app.main:app --app-dir backend` boots; `GET /health` and
  `GET /openapi.json` respond, and the OpenAPI doc shows the six tag groups.
- Route list (`app.routes`) matches the pre-refactor set exactly — same paths,
  same methods.
