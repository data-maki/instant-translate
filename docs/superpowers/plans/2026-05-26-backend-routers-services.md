# Backend Routers + Services Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the ~1565-line `backend/app/main.py` into domain `routers/` (HTTP only) and `services/` (pure logic), changing no endpoint paths and removing no functionality.

**Architecture:** `main.py` becomes a ~25-line app assembler (`FastAPI()`, CORS, six `include_router()` calls). Each router uses `APIRouter(prefix=..., tags=[...])` so final paths stay byte-identical while OpenAPI groups operations by tag. Business logic moves into a `services/` package; existing modules (`auth`, `languages`, `sessions`, `phrase_upgrade`, `soniox`, `provider_streams`, `shared`) are already part of the service layer and stay put.

**Tech Stack:** Python 3, FastAPI ≥0.115, Starlette, pytest + `fastapi.testclient.TestClient`.

**Strategy (keeps every commit green):**
1. Add a route-snapshot test (baseline safety net).
2. Create empty `routers/` + `services/` packages.
3. Extract each service module; `main.py` imports the moved names back as module-level aliases so endpoints and existing test references keep resolving.
4. Carve out routers one domain at a time, deleting the moved endpoint defs from `main.py` and retargeting the handful of namespace-sensitive test patches in the *same* commit.
5. Final cleanup pass: `main.py` drops to the assembler form; full verification.

**Spec:** `docs/superpowers/specs/2026-05-26-backend-routers-services-design.md`

**Run all commands from the repo root** `/Users/jcarbs/Code/mother_in_law_decoder` unless noted. Tests run with:
```bash
cd backend && python -m pytest -q
```

---

## Task 1: Route-snapshot safety-net test

Locks the exact set of `(path, method)` pairs so any accidental path drift or dropped endpoint fails loudly. This test must pass unchanged before and after the whole refactor.

**Files:**
- Create: `backend/tests/test_routes_snapshot.py`

- [ ] **Step 1: Write the snapshot test**

```python
# backend/tests/test_routes_snapshot.py
"""Guards the public route surface during the routers/services refactor.

The set below must never shrink. Final paths and methods are frozen here so a
misplaced prefix or a dropped endpoint fails immediately.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app

EXPECTED_ROUTES = {
    ("/health", "GET"),
    ("/languages", "GET"),
    ("/context/places", "POST"),
    ("/context/maps-list", "POST"),
    ("/context/rewrite", "POST"),
    ("/context/translate", "POST"),
    ("/context/name-katakana", "POST"),
    ("/tts/voices", "GET"),
    ("/tts/speak", "POST"),
    ("/sessions", "GET"),
    ("/sessions/{session_name}", "GET"),
    ("/sessions/{session_name}", "PATCH"),
    ("/sessions/{session_name}", "DELETE"),
    ("/sessions/{session_name}/adaptations", "POST"),
    ("/sessions/{session_name}/auto-title", "POST"),
    ("/sessions/{session_name}/rediarize", "POST"),
    ("/sessions/{session_name}/retranslate", "POST"),
    ("/sessions/{session_name}/speakers", "POST"),
    ("/realtime/translation-session", "POST"),
    ("/ws/transcribe", "WEBSOCKET"),
}


def _collect_routes() -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for route in app.routes:
        path = getattr(route, "path", None)
        if not path:
            continue
        methods = getattr(route, "methods", None)
        if methods:
            for method in methods:
                pairs.add((path, method))
        elif path == "/ws/transcribe":
            pairs.add((path, "WEBSOCKET"))
    return pairs


def test_public_route_surface_is_stable():
    collected = _collect_routes()
    missing = EXPECTED_ROUTES - collected
    assert not missing, f"routes disappeared: {sorted(missing)}"
```

- [ ] **Step 2: Run it to verify it passes against current `main.py`**

Run: `cd backend && python -m pytest tests/test_routes_snapshot.py -q`
Expected: PASS (1 passed). If it fails, the `EXPECTED_ROUTES` set is wrong — fix it to match reality before proceeding; do not change `main.py`.

- [ ] **Step 3: Confirm the whole suite is green (baseline)**

Run: `cd backend && python -m pytest -q`
Expected: all pass. Record the count; it must not drop later.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_routes_snapshot.py
git commit -m "test: freeze public route surface before routers refactor"
```

---

## Task 2: Create empty routers/ and services/ packages

**Files:**
- Create: `backend/app/routers/__init__.py`
- Create: `backend/app/services/__init__.py`

- [ ] **Step 1: Create the package markers**

```python
# backend/app/routers/__init__.py
"""HTTP routers. Each module owns one domain and exposes a `router: APIRouter`."""
```

```python
# backend/app/services/__init__.py
"""Service layer: business logic with no FastAPI/HTTP types."""
```

- [ ] **Step 2: Verify import works**

Run: `cd backend && python -c "import app.routers, app.services; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/__init__.py backend/app/services/__init__.py
git commit -m "chore: add empty routers and services packages"
```

---

## Task 3: Extract `services/places.py`

Move all Google Places + Google Maps-list logic out of `main.py`. `main.py` re-imports the names it still uses so its endpoints keep working until Task 9 carves the context router.

**Files:**
- Create: `backend/app/services/places.py`
- Modify: `backend/app/main.py`

Functions to move (verbatim bodies; drop the leading underscore to make them the module's public API): `_google_maps_api_key`→`google_maps_api_key`, `_payload_float`→`payload_float`, `_google_place_types`→`google_place_types`, `_fetch_google_places`→`fetch_google_places`, `_places_context`→`places_context`, `_place_name`→`place_name`, `_fetch_google_maps_list`→`fetch_google_maps_list`, `_http_text`→`http_text`, `_extract_google_maps_list_title`→`extract_google_maps_list_title`, `_extract_google_maps_list_places`→`extract_google_maps_list_places`, `_google_maps_list_place_from_node`→`google_maps_list_place_from_node`, `_base_terms_for_place_signal`→`base_terms_for_place_signal`, `_base_translation_terms_for_place_signal`→`base_translation_terms_for_place_signal`, `_dedupe`→`dedupe`.

(In `main.py` these are lines 52, 571–806 in the current file.)

- [ ] **Step 1: Create the service module**

Create `backend/app/services/places.py` with this header, then paste the bodies of the 14 functions above (renamed, and updating their internal calls to each other to the new names — e.g. `_places_context` calls `_base_terms_for_place_signal` → now `places_context` calls `base_terms_for_place_signal`):

```python
"""Google Places (Nearby) and shared-list scraping for context enrichment."""

from __future__ import annotations

import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

GOOGLE_PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"


def google_maps_api_key() -> str | None:
    return os.environ.get("GOOGLE_MAPS_API_KEY")


# ... paste the remaining 13 functions here, renamed, internal call-sites updated ...
```

Move the `GOOGLE_PLACES_NEARBY_URL` constant (currently `main.py:52`) here too.

- [ ] **Step 2: Rewire `main.py` to import from the service**

In `main.py`, delete the 14 moved function defs and the `GOOGLE_PLACES_NEARBY_URL` constant. At the top of `main.py` add:

```python
from .services import places as places_service
```

Then update the three call sites still in `main.py` (the `/health`, `/context/places`, `/context/maps-list` endpoints, which stay in `main.py` until Tasks 8–9):
- `_google_maps_api_key()` → `places_service.google_maps_api_key()`
- `_payload_float(payload, "lat")` → `places_service.payload_float(payload, "lat")` (and `"lng"`)
- `_google_place_types(...)` → `places_service.google_place_types(...)`
- `_fetch_google_places(...)` → `places_service.fetch_google_places(...)`
- `_places_context(...)` → `places_service.places_context(...)`
- `_fetch_google_maps_list(url)` → `places_service.fetch_google_maps_list(url)`

Remove now-unused imports from `main.py` only if nothing else uses them. Note `html`, `re`, `urllib.*` may still be referenced elsewhere in `main.py` (they are — `_http_text` was the only `html`/`re` user, so after this move check with grep before deleting any import).

- [ ] **Step 3: Verify nothing in `main.py` references the old names**

Run: `grep -nE "_google_maps_api_key|_payload_float|_google_place_types|_fetch_google_places|_places_context|_fetch_google_maps_list|_http_text|_extract_google_maps_list|_google_maps_list_place_from_node|_base_terms_for_place_signal|_base_translation_terms_for_place_signal|_dedupe|_place_name" backend/app/main.py`
Expected: no output (all moved/renamed).

- [ ] **Step 4: Run the full suite**

Run: `cd backend && python -m pytest -q`
Expected: same pass count as Task 1 baseline. The places tests (`test_app.py` places cases) exercise the live endpoints, so a green run confirms the move.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/places.py backend/app/main.py
git commit -m "refactor: extract Google Places/Maps logic into services/places"
```

---

## Task 4: Extract `services/tts.py`

**Files:**
- Create: `backend/app/services/tts.py`
- Modify: `backend/app/main.py`

Move (current `main.py:389–471, 491–510`): all `ELEVENLABS_*` constants and the `ELEVENLABS_LANGUAGE_DEFAULT_VOICES` map, `_ADAM`/`_SHOHEI`, `ELEVENLABS_UNSUPPORTED_LANGUAGES`, and `_elevenlabs_request`→`elevenlabs_request`. Also add a `voices_payload()` builder (the dict currently returned by the `/tts/voices` endpoint, `main.py:477–488`) and a `synthesize_speech()` function holding the model-fallback loop from `/tts/speak` (`main.py:539–562`) that returns `(audio_bytes, used_model, attempted)` and lets the router raise `HTTPException`.

- [ ] **Step 1: Create the service module**

```python
"""ElevenLabs voice/model configuration and TTS synthesis."""

from __future__ import annotations

import urllib.parse

ELEVENLABS_PRIMARY_MODEL = "eleven_v3"
ELEVENLABS_FALLBACK_MODEL = "eleven_multilingual_v2"
ELEVENLABS_V3_UNSUPPORTED = {"eu"}
ELEVENLABS_DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB"
_ADAM = ELEVENLABS_DEFAULT_VOICE_ID
_SHOHEI = "NO5A3b3sSzDyJQF7MiNS"

ELEVENLABS_LANGUAGE_DEFAULT_VOICES: dict[str, str] = {
    # ... paste the full map verbatim from main.py:409-466 ...
}
ELEVENLABS_UNSUPPORTED_LANGUAGES = set(ELEVENLABS_V3_UNSUPPORTED)


def elevenlabs_request(api_key: str, voice_id: str, text: str, model_id: str):
    import requests

    settings = {"stability": 0.5, "similarity_boost": 0.75}
    return requests.post(
        f"https://api.elevenlabs.io/v1/text-to-speech/{urllib.parse.quote(voice_id)}",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        json={"text": text, "model_id": model_id, "voice_settings": settings},
        timeout=30,
    )


def voices_payload() -> dict:
    return {
        "default_voice_id": ELEVENLABS_DEFAULT_VOICE_ID,
        "primary_model_id": ELEVENLABS_PRIMARY_MODEL,
        "fallback_model_id": ELEVENLABS_FALLBACK_MODEL,
        "language_voices": dict(ELEVENLABS_LANGUAGE_DEFAULT_VOICES),
        "officially_supported_languages": sorted(
            code
            for code in ELEVENLABS_LANGUAGE_DEFAULT_VOICES
            if code not in ELEVENLABS_UNSUPPORTED_LANGUAGES
        ),
        "best_effort_languages": sorted(ELEVENLABS_UNSUPPORTED_LANGUAGES),
    }


def resolve_voice_id(target_language: str, requested_voice: str) -> str:
    return (
        requested_voice
        or ELEVENLABS_LANGUAGE_DEFAULT_VOICES.get(target_language)
        or ELEVENLABS_DEFAULT_VOICE_ID
    )


def synthesize_speech(api_key: str, voice_id: str, text: str, requested_model: str):
    """Try the requested model then the fallback. Returns (response, used_model, attempted).

    `response` is None if every candidate failed; `attempted` is a list of
    (model, status_code, body_snippet) for building an error message.
    """
    import requests

    candidates = [requested_model]
    if ELEVENLABS_FALLBACK_MODEL not in candidates:
        candidates.append(ELEVENLABS_FALLBACK_MODEL)
    attempted: list[tuple[str, int, str]] = []
    for candidate in candidates:
        attempt = elevenlabs_request(api_key, voice_id, text, candidate)
        if attempt.status_code < 400:
            return attempt, candidate, attempted
        attempted.append((candidate, attempt.status_code, attempt.text[:160]))
    return None, None, attempted
```

- [ ] **Step 2: Rewire `main.py`**

Delete the moved constants/map and `_elevenlabs_request` from `main.py`. The `/tts/voices` and `/tts/speak` endpoints stay in `main.py` until Task 10, so add:

```python
from .services import tts as tts_service
```

and update those two endpoint bodies:
- `/tts/voices` returns `tts_service.voices_payload()`.
- `/tts/speak`: replace the voice resolution with `voice_id = tts_service.resolve_voice_id(target_language, requested_voice)` and the model-fallback loop with `response, used_model, attempted = tts_service.synthesize_speech(api_key, voice_id, text, requested_model)`, keeping the existing `requests.RequestException` try/except and the `HTTPException` raises around it.

- [ ] **Step 3: Verify and test**

Run: `grep -nE "ELEVENLABS_|_elevenlabs_request" backend/app/main.py` → expect only the `tts_service` import line / no stale defs.
Run: `cd backend && python -m pytest -q` → same pass count.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/tts.py backend/app/main.py
git commit -m "refactor: extract ElevenLabs TTS into services/tts"
```

---

## Task 5: Extract `services/katakana.py`

**Files:**
- Create: `backend/app/services/katakana.py`
- Modify: `backend/app/main.py`

Move `_openai_name_katakana_options` (`main.py:202–312`) → `katakana.name_katakana_options`. It calls `extract_openai_text`, currently imported into `main.py` from `app.sessions`; import it directly in the service.

- [ ] **Step 1: Create the module**

```python
"""OpenAI-backed katakana spelling suggestions for a person's name."""

from __future__ import annotations

import json
import os

from ..sessions import extract_openai_text


def name_katakana_options(api_key: str, first_name: str, last_name: str) -> list[dict[str, str]]:
    # ... paste the body of _openai_name_katakana_options verbatim (main.py:203-312) ...
```

- [ ] **Step 2: Rewire `main.py`**

Delete `_openai_name_katakana_options` from `main.py`. The `/context/name-katakana` endpoint stays until Task 9; add `from .services import katakana as katakana_service` and call `katakana_service.name_katakana_options(api_key, first_name, last_name)`.

- [ ] **Step 3: Verify and test**

Run: `grep -n "_openai_name_katakana_options" backend/app/main.py` → no output.
Run: `cd backend && python -m pytest -q` → same pass count (covers `test_app.py` katakana cases).

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/katakana.py backend/app/main.py
git commit -m "refactor: extract name-katakana logic into services/katakana"
```

---

## Task 6: Extract `services/realtime.py`

**Files:**
- Create: `backend/app/services/realtime.py`
- Modify: `backend/app/main.py`

Move the OpenAI realtime client-secret request from `/realtime/translation-session` (`main.py:337–377`) into a service function that raises `RuntimeError` on failure; the router/endpoint maps that to `HTTPException`.

- [ ] **Step 1: Create the module**

```python
"""Mint OpenAI Realtime translation client secrets."""

from __future__ import annotations


def create_translation_session(api_key: str, target_language: str, user_hash: str) -> dict:
    import requests

    try:
        response = requests.post(
            "https://api.openai.com/v1/realtime/translations/client_secrets",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "OpenAI-Safety-Identifier": user_hash,
            },
            json={
                "session": {
                    "model": "gpt-realtime-translate",
                    "audio": {"output": {"language": target_language}},
                },
            },
            timeout=15,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"OpenAI realtime session request failed: {exc}") from exc
    if response.status_code >= 400:
        raise RuntimeError(
            f"OpenAI realtime session request failed: {response.status_code} {response.text[:240]}"
        )
    return response.json()
```

- [ ] **Step 2: Rewire `main.py`**

The `/realtime/translation-session` endpoint stays in `main.py` until Task 12. Replace its inner request block with:

```python
    from .services import realtime as realtime_service
    try:
        return realtime_service.create_translation_session(api_key, target_language, user_hash)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
```

(keep the existing `api_key`, `target_language`, `user_hash` extraction and the missing-key 400).

- [ ] **Step 3: Test**

Run: `cd backend && python -m pytest -q` → same pass count (covers `test_app.py:381,409`).

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/realtime.py backend/app/main.py
git commit -m "refactor: extract OpenAI realtime session minting into services/realtime"
```

---

## Task 7: Extract `services/transcripts.py`

Move session post-processing logic. Keep the public name `revise_translation_samples` (the retranslate test monkeypatches it). `main.py` re-imports moved names as module aliases so the still-resident session endpoints — and the existing `app_main._revise_translation_samples` patch — keep resolving until Task 11.

**Files:**
- Create: `backend/app/services/transcripts.py`
- Modify: `backend/app/main.py`

Move (current `main.py:1197–1513`, drop leading underscores): `_latest_audio_path`→`latest_audio_path`, `_atomic_write_text`→`atomic_write_text`, `_latest_tokens_for_session`→`latest_tokens_for_session`, `_read_session_adaptations`→`read_session_adaptations`, `_write_session_adaptations`→`write_session_adaptations`, `_latest_transcript_artifact`→`latest_transcript_artifact`, `_improved_artifacts_by_recency`→`improved_artifacts_by_recency`, `_session_from_tokens`→`session_from_tokens`, `_apply_async_speakers`→`apply_async_speakers`, `_best_speaker_for_window`→`best_speaker_for_window`, `_translation_samples_from_tokens`→`translation_samples_from_tokens`, `_revise_translation_samples`→`revise_translation_samples`, `_apply_revised_translations`→`apply_revised_translations`, `_speaker_key`→`speaker_key`, `_coerce_speaker`→`coerce_speaker`, `_apply_speaker_review`→`apply_speaker_review`, `_apply_speaker_labels`→`apply_speaker_labels`. `_session_from_tokens` calls `make_session` (from `app.sessions`).

- [ ] **Step 1: Create the module**

```python
"""Post-processing over saved session transcripts: artifact/token reading,
retranslation, diarization remapping, and speaker review."""

from __future__ import annotations

import json
import os
from typing import Any

from ..sessions import make_session


# ... paste the 17 functions, renamed, internal call-sites updated to the new
# names (e.g. session_from_tokens uses make_session; latest_transcript_artifact
# calls improved_artifacts_by_recency; rediarize/retranslate helpers chain
# through their renamed peers). Keep all logic identical. ...
```

- [ ] **Step 2: Rewire `main.py`**

Delete the 17 moved functions from `main.py`. Add:

```python
from .services import transcripts as transcripts_service
```

Update every call site in the still-resident session endpoints (`/sessions/*`, which move in Task 11) and the detail endpoint to go through `transcripts_service.<name>(...)`. Map of renamed calls:
`_latest_tokens_for_session`→`transcripts_service.latest_tokens_for_session`, `_read_session_adaptations`→`...read_session_adaptations`, `_write_session_adaptations`→`...write_session_adaptations`, `_latest_transcript_artifact`→`...latest_transcript_artifact`, `_session_from_tokens`→`...session_from_tokens`, `_latest_audio_path`→`...latest_audio_path`, `_apply_async_speakers`→`...apply_async_speakers`, `_translation_samples_from_tokens`→`...translation_samples_from_tokens`, `_revise_translation_samples`→`...revise_translation_samples`, `_apply_revised_translations`→`...apply_revised_translations`, `_apply_speaker_review`→`...apply_speaker_review`, `_apply_speaker_labels`→`...apply_speaker_labels`, `_speaker_key`→`...speaker_key`, `_coerce_speaker`→`...coerce_speaker`.

`_require_owner` stays in `main.py` for now (moves to the sessions router in Task 11).

- [ ] **Step 3: Update the retranslate test's monkeypatch target**

The test at `backend/tests/test_app.py:700` currently patches `app_main._revise_translation_samples`. Because the endpoint now calls `transcripts_service.revise_translation_samples`, patch the service module instead.

```python
    monkeypatch.setattr(
        "app.services.transcripts.revise_translation_samples",
        lambda *_args: ["This is delicious."],
    )
```

(Replace the existing `monkeypatch.setattr(app_main, "_revise_translation_samples", ...)` line.)

- [ ] **Step 4: Verify and test**

Run: `grep -nE "_latest_tokens_for_session|_revise_translation_samples|_apply_revised_translations|_session_from_tokens|_apply_async_speakers|_translation_samples_from_tokens|_apply_speaker_review|_apply_speaker_labels|_read_session_adaptations|_write_session_adaptations|_latest_transcript_artifact|_improved_artifacts_by_recency|_best_speaker_for_window|_latest_audio_path|_atomic_write_text" backend/app/main.py`
Expected: no output.
Run: `cd backend && python -m pytest -q` → same pass count (retranslate test at line ~700 must still pass via the new patch target).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/transcripts.py backend/app/main.py backend/tests/test_app.py
git commit -m "refactor: extract session transcript post-processing into services/transcripts"
```

---

## Task 8: Create `routers/health.py` and `routers/languages.py`

First two routers. These have no module-sensitive test patches, so they're the safest to carve.

**Files:**
- Create: `backend/app/routers/health.py`
- Create: `backend/app/routers/languages.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create `routers/health.py`**

```python
"""Health / capability probe."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter

from ..languages import DEFAULT_SOURCE_LANGUAGES, DEFAULT_TARGET_LANGUAGE
from ..services import places as places_service
from ..soniox import NUM_CHANNELS, SAMPLE_RATE

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "has_soniox_key": bool(os.environ.get("SONIOX_API_KEY")),
        "has_groq_key": bool(os.environ.get("GROQ_API_KEY")),
        "has_deepl_key": bool(os.environ.get("DEEPL_API_KEY")),
        "has_deepgram_key": bool(os.environ.get("DEEPGRAM_API_KEY")),
        "has_openai_key": bool(os.environ.get("OPENAI_API_KEY")),
        "has_elevenlabs_key": bool(os.environ.get("ELEVENLABS_API_KEY")),
        "has_google_maps_api_key": bool(places_service.google_maps_api_key()),
        "audio": {
            "sample_rate": SAMPLE_RATE,
            "num_channels": NUM_CHANNELS,
            "format": "pcm_s16le",
        },
        "defaults": {
            "source_languages": DEFAULT_SOURCE_LANGUAGES,
            "target_language": DEFAULT_TARGET_LANGUAGE,
        },
    }
```

- [ ] **Step 2: Create `routers/languages.py`**

```python
"""Supported-language listing."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..languages import DEFAULT_SOURCE_LANGUAGES, DEFAULT_TARGET_LANGUAGE, list_languages

router = APIRouter(tags=["languages"])


@router.get("/languages")
def languages() -> dict[str, Any]:
    return {
        "default_source_languages": DEFAULT_SOURCE_LANGUAGES,
        "default_target_language": DEFAULT_TARGET_LANGUAGE,
        "languages": list_languages(),
    }
```

- [ ] **Step 3: Wire into `main.py` and delete the moved endpoints**

In `main.py`: delete the `health()` (lines ~71–91) and `languages()` (lines ~380–386) defs. Add near the app creation:

```python
from .routers import health as health_router
from .routers import languages as languages_router

app.include_router(health_router.router)
app.include_router(languages_router.router)
```

- [ ] **Step 4: Test**

Run: `cd backend && python -m pytest tests/test_routes_snapshot.py tests/test_app.py -q`
Expected: PASS, including `test_health_and_language_defaults`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/health.py backend/app/routers/languages.py backend/app/main.py
git commit -m "refactor: move health and languages endpoints into routers"
```

---

## Task 9: Create `routers/context.py`

Holds the five `/context/*` endpoints. Uses `prefix="/context"` so each handler declares the sub-path only.

**Files:**
- Create: `backend/app/routers/context.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_app.py` (retarget the `_deepl_*` references)

- [ ] **Step 1: Create the router**

```python
"""Context-enrichment endpoints: places, maps lists, rewrite, translate, name katakana."""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..auth import require_user
from ..phrase_upgrade import (
    adapt_phrase_with_groq as _adapt_phrase_with_groq,
    deepl_context as _deepl_context,
    translate_with_deepl as _translate_with_deepl,
)
from ..services import katakana as katakana_service
from ..services import places as places_service

router = APIRouter(prefix="/context", tags=["context"])


@router.post("/places")
def places_context(payload: dict[str, Any], user_id: str = Depends(require_user)) -> dict[str, Any]:
    # body of main.py /context/places, with helpers via places_service.* and
    # the final return using places_service.places_context(...)
    ...


@router.post("/maps-list")
def maps_list_context(payload: dict[str, Any], user_id: str = Depends(require_user)) -> dict[str, Any]:
    # body of main.py /context/maps-list, via places_service.fetch_google_maps_list(url)
    ...


@router.post("/rewrite")
def rewrite_context(payload: dict[str, Any], user_id: str = Depends(require_user)) -> dict[str, str]:
    # body of main.py /context/rewrite verbatim (uses _adapt_phrase_with_groq,
    # _translate_with_deepl, _deepl_context imported above)
    ...


@router.post("/translate")
def translate_context(payload: dict[str, Any], user_id: str = Depends(require_user)) -> dict[str, str]:
    # body of main.py /context/translate verbatim
    ...


@router.post("/name-katakana")
def name_katakana_context(payload: dict[str, Any], user_id: str = Depends(require_user)) -> dict[str, Any]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing OPENAI_API_KEY.")
    first_name = str(payload.get("first_name") or "").strip()
    last_name = str(payload.get("last_name") or "").strip()
    if not first_name and not last_name:
        raise HTTPException(status_code=400, detail="Expected first_name and/or last_name.")
    try:
        options = katakana_service.name_katakana_options(api_key, first_name, last_name)
    except (RuntimeError, json.JSONDecodeError, KeyError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"options": options}
```

Paste the full bodies for the four `...` handlers verbatim from `main.py` (`/context/places` 94–117, `/context/maps-list` 120–131, `/context/rewrite` 134–169, `/context/translate` 172–199), changing only: `places_service.*` for the places calls, and the `_deepl_context(rewrite_context, payload)` / `_adapt_phrase_with_groq` / `_translate_with_deepl` names already imported above. `rewrite`/`translate` also reference `os.environ` (imported) and may read a deepl key — keep that logic identical.

- [ ] **Step 2: Wire into `main.py`, delete the five endpoints and now-unused imports**

In `main.py`: delete the five `/context/*` endpoint defs. Add:

```python
from .routers import context as context_router

app.include_router(context_router.router)
```

`main.py` no longer needs `katakana_service`, the `phrase_upgrade` imports, or `places_service` for context — but `places_service` is still used by `/health`'s? No: health moved in Task 8. After this task, check whether `main.py` still uses `places_service` anywhere; if not, remove that import. Likewise remove the `from .phrase_upgrade import (...)` block from `main.py` if nothing else uses it. **Verify with grep before deleting** (Step 4).

- [ ] **Step 3: Retarget the deepl test references**

In `backend/tests/test_app.py`, the test that asserts on `app_main._deepl_translate_url`, `app_main._deepl_formality`, and `app_main.DEEPL_PRO_TRANSLATE_URL` (lines ~220–229) must now import these from their real home. At the top of `test_app.py` add:

```python
from app.phrase_upgrade import (
    DEEPL_PRO_TRANSLATE_URL,
    deepl_formality,
    deepl_translate_url,
)
```

and rewrite those assertions to use the bare names, e.g.:

```python
    assert deepl_translate_url() == DEEPL_PRO_TRANSLATE_URL
    assert deepl_formality({"tone": {"deepl_formality": "less", "register": "polite_neutral"}}) == "less"
    # ... and the remaining deepl_formality assertions, unchanged except the name ...
```

- [ ] **Step 4: Verify and test**

Run: `grep -nE "context_router|places_service|phrase_upgrade|katakana_service" backend/app/main.py` — confirm only still-needed imports remain (none of these should remain after this task except the `context_router` include).
Run: `cd backend && python -m pytest -q` → same pass count.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/context.py backend/app/main.py backend/tests/test_app.py
git commit -m "refactor: move /context/* endpoints into routers/context"
```

---

## Task 10: Create `routers/tts.py`

**Files:**
- Create: `backend/app/routers/tts.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create the router**

```python
"""Text-to-speech endpoints."""

from __future__ import annotations

import base64
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..auth import require_user
from ..services import tts as tts_service

router = APIRouter(prefix="/tts", tags=["tts"])


@router.get("/voices")
def tts_voices() -> dict[str, Any]:
    """Report which languages have a configured male voice and which do not."""
    return tts_service.voices_payload()


@router.post("/speak")
def tts_speak(payload: dict[str, Any], user_id: str = Depends(require_user)) -> dict[str, Any]:
    import requests

    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing ELEVENLABS_API_KEY.")

    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Expected non-empty text.")
    if len(text) > 1500:
        text = text[:1500]

    target_language = str(payload.get("target_language") or "").strip().lower()
    requested_voice = str(payload.get("voice_id") or "").strip()
    voice_id = tts_service.resolve_voice_id(target_language, requested_voice)
    requested_model = str(payload.get("model_id") or "").strip() or tts_service.ELEVENLABS_PRIMARY_MODEL

    try:
        response, used_model, attempted = tts_service.synthesize_speech(
            api_key, voice_id, text, requested_model
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"ElevenLabs request failed: {exc}") from exc

    if response is None or used_model is None:
        detail = "; ".join(f"{m}: {s} {t}" for m, s, t in attempted) or "no response"
        raise HTTPException(status_code=502, detail=f"ElevenLabs TTS failed ({detail})")

    audio_b64 = base64.b64encode(response.content).decode("ascii")
    return {
        "audio_base64": audio_b64,
        "mime_type": "audio/mpeg",
        "voice_id": voice_id,
        "model_id": used_model,
    }
```

- [ ] **Step 2: Wire into `main.py`, delete the two endpoints**

Delete `/tts/voices` and `/tts/speak` from `main.py`. Add:

```python
from .routers import tts as tts_router

app.include_router(tts_router.router)
```

Remove `main.py`'s `from .services import tts as tts_service` import if now unused (grep first).

- [ ] **Step 3: Test**

Run: `cd backend && python -m pytest -q` → same pass count. (`/tts/*` has no dedicated test, so rely on the route-snapshot test confirming both paths still exist.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/tts.py backend/app/main.py
git commit -m "refactor: move /tts/* endpoints into routers/tts"
```

---

## Task 11: Create `routers/sessions.py`

The largest router: all eight `/sessions/*` endpoints plus the HTTP-only `_require_owner` helper. Uses `prefix="/sessions"`. This task also retargets the `session_belongs_to` conftest patch.

**Files:**
- Create: `backend/app/routers/sessions.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Create the router skeleton + imports + `_require_owner`**

```python
"""Session listing, detail, rename, delete, and re-processing endpoints."""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import require_user
from ..languages import DEFAULT_SOURCE_LANGUAGES, DEFAULT_TARGET_LANGUAGE
from .. import shared
from ..sessions import (
    DEFAULT_CONTEXT,
    build_phrases,
    generate_session_summary,
    list_sessions,
    make_session,
    read_session_state,
    read_session_summary,
    sanitize_session_name,
    session_belongs_to,
    session_display_title,
    session_duration_seconds,
    write_session_summary,
)
from ..services import transcripts as transcripts_service
from cli.live_transcriber.async_diarize import AsyncDiarizeError, redo_diarization

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _require_owner(state: dict[str, Any] | None, user_id: str) -> None:
    """Enforce that the authenticated user owns this session. (Docstring verbatim
    from main.py.)"""
    if state is None:
        return
    if not session_belongs_to(state, user_id):
        raise HTTPException(status_code=404, detail="Session not found.")
```

- [ ] **Step 2: Paste the eight endpoints, adjusting paths and call sites**

Paste each handler body verbatim from `main.py`, with two mechanical changes: (a) the decorator path drops the `/sessions` prefix, (b) any `_…` helper call goes through `transcripts_service.…`. Decorator mapping:

| main.py decorator | router decorator |
|---|---|
| `@app.get("/sessions")` | `@router.get("")` |
| `@app.get("/sessions/{session_name}")` | `@router.get("/{session_name}")` |
| `@app.post("/sessions/{session_name}/adaptations")` | `@router.post("/{session_name}/adaptations")` |
| `@app.patch("/sessions/{session_name}")` | `@router.patch("/{session_name}")` |
| `@app.post("/sessions/{session_name}/auto-title")` | `@router.post("/{session_name}/auto-title")` |
| `@app.delete("/sessions/{session_name}")` | `@router.delete("/{session_name}")` |
| `@app.post("/sessions/{session_name}/rediarize")` | `@router.post("/{session_name}/rediarize")` |
| `@app.post("/sessions/{session_name}/retranslate")` | `@router.post("/{session_name}/retranslate")` |
| `@app.post("/sessions/{session_name}/speakers")` | `@router.post("/{session_name}/speakers")` |

(Note: `@router.get("")` with `prefix="/sessions"` yields exactly `/sessions` — verified by the snapshot test.)

Call-site renames inside these bodies: `_latest_tokens_for_session`→`transcripts_service.latest_tokens_for_session`, `_read_session_adaptations`→`transcripts_service.read_session_adaptations`, `_write_session_adaptations`→`transcripts_service.write_session_adaptations`, `_session_from_tokens`→`transcripts_service.session_from_tokens`, `_latest_transcript_artifact`→`transcripts_service.latest_transcript_artifact`, `_latest_audio_path`→`transcripts_service.latest_audio_path`, `_apply_async_speakers`→`transcripts_service.apply_async_speakers`, `_translation_samples_from_tokens`→`transcripts_service.translation_samples_from_tokens`, `_revise_translation_samples`→`transcripts_service.revise_translation_samples`, `_apply_revised_translations`→`transcripts_service.apply_revised_translations`, `_apply_speaker_review`→`transcripts_service.apply_speaker_review`, `_apply_speaker_labels`→`transcripts_service.apply_speaker_labels`, `_speaker_key`→`transcripts_service.speaker_key`, `_coerce_speaker`→`transcripts_service.coerce_speaker`. `_require_owner` stays a local call (defined in Step 1).

- [ ] **Step 3: Wire into `main.py`, delete the eight endpoints + `_require_owner`**

Delete from `main.py`: all eight `/sessions/*` endpoint defs and the `_require_owner` function. Add:

```python
from .routers import sessions as sessions_router

app.include_router(sessions_router.router)
```

Remove now-unused `main.py` imports (`sanitize_session_name`, `read_session_summary`, `generate_session_summary`, `write_session_summary`, `session_display_title`, `session_duration_seconds`, `session_belongs_to`, `build_phrases`, `make_session`, `redo_diarization`, `AsyncDiarizeError`, `DEFAULT_CONTEXT`, `shared`, `transcripts_service`, etc.) — **grep each before deleting**, since `/realtime` + `/ws` endpoints still live in `main.py` until Task 12 and use `shared`/`make_session`? They do not — confirm via Step 5 grep.

- [ ] **Step 4: Retarget the `session_belongs_to` conftest patch**

In `backend/tests/conftest.py:37`, change:

```python
    monkeypatch.setattr("app.main.session_belongs_to", lambda *_args, **_kwargs: True, raising=False)
```
to:
```python
    monkeypatch.setattr("app.routers.sessions.session_belongs_to", lambda *_args, **_kwargs: True, raising=False)
```

(Leave the `resolve_user_from_token` patch on `app.main` for now — Task 12 handles it.)

- [ ] **Step 5: Verify and test**

Run: `grep -nE "_require_owner|@app\.(get|post|patch|delete)\(\"/sessions" backend/app/main.py` → no output.
Run: `cd backend && python -m pytest -q` → same pass count. Session CRUD, auto-title, rediarize, retranslate, and speakers tests in `test_app.py` all exercise these routes, so green confirms the move and the new patch target.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/sessions.py backend/app/main.py backend/tests/conftest.py
git commit -m "refactor: move /sessions/* endpoints into routers/sessions"
```

---

## Task 12: Create `routers/transcribe.py`

Holds `POST /realtime/translation-session` and the `WS /ws/transcribe` WebSocket. Retargets the `resolve_user_from_token` conftest patch.

**Files:**
- Create: `backend/app/routers/transcribe.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/conftest.py`

- [ ] **Step 1: Create the router**

```python
"""Realtime translation session minting and the live transcription WebSocket."""

from __future__ import annotations

import json
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from ..auth import require_user, resolve_user_from_token
from ..services import realtime as realtime_service
from ..soniox import run_transcription_bridge

router = APIRouter(tags=["realtime"])


@router.post("/realtime/translation-session")
def realtime_translation_session(
    payload: dict[str, Any], user_id: str = Depends(require_user)
) -> dict[str, Any]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing OPENAI_API_KEY.")
    target_language = str(payload.get("target_language") or "ja").strip() or "ja"
    user_hash = str(payload.get("user_hash") or "anonymous-user").strip() or "anonymous-user"
    try:
        return realtime_service.create_translation_session(api_key, target_language, user_hash)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.websocket("/ws/transcribe")
async def transcribe(websocket: WebSocket) -> None:
    # Paste the body of main.py's transcribe() verbatim (main.py:1518-1564),
    # including the `from .auth import _resolve_session` line — change it to
    # `from ..auth import _resolve_session`.
    ...
```

Paste the full `transcribe()` body from `main.py:1518–1564`. The one import inside it (`from .auth import _resolve_session`) becomes `from ..auth import _resolve_session`.

- [ ] **Step 2: Wire into `main.py`, delete both endpoints**

Delete `/realtime/translation-session` and the `transcribe` websocket from `main.py`. Add:

```python
from .routers import transcribe as transcribe_router

app.include_router(transcribe_router.router)
```

- [ ] **Step 3: Retarget the `resolve_user_from_token` conftest patch**

In `backend/tests/conftest.py:43`, change:
```python
    monkeypatch.setattr("app.main.resolve_user_from_token", _stub_token)
```
to:
```python
    monkeypatch.setattr("app.routers.transcribe.resolve_user_from_token", _stub_token)
```

- [ ] **Step 4: Verify and test**

Run: `grep -nE "translation-session|ws/transcribe|resolve_user_from_token|run_transcription_bridge" backend/app/main.py` → no output.
Run: `cd backend && python -m pytest -q` → same pass count (covers the websocket test at `test_app.py:761` and realtime test).

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/transcribe.py backend/app/main.py backend/tests/conftest.py
git commit -m "refactor: move realtime + ws/transcribe endpoints into routers/transcribe"
```

---

## Task 13: Final `main.py` cleanup + full verification

After Task 12, `main.py` has no endpoints left. Reduce it to the assembler and confirm the whole system.

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Reduce `main.py` to the assembler form**

`main.py` should now read essentially:

```python
"""FastAPI app for the cottonoha web UI."""

from __future__ import annotations

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import (
    context as context_router,
    health as health_router,
    languages as languages_router,
    sessions as sessions_router,
    transcribe as transcribe_router,
    tts as tts_router,
)

load_dotenv()

app = FastAPI(title="cottonoha API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):30\d{2}$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router.router)
app.include_router(languages_router.router)
app.include_router(context_router.router)
app.include_router(tts_router.router)
app.include_router(sessions_router.router)
app.include_router(transcribe_router.router)
```

Delete every now-orphaned import and helper still lingering in `main.py`.

- [ ] **Step 2: Static check for dead references**

Run: `cd backend && python -c "import app.main; print('import ok')"`
Expected: `import ok` (no ImportError / NameError).
Run: `grep -nE "^def |^async def |@app\.(get|post|patch|delete|websocket)" backend/app/main.py`
Expected: no output (no endpoint defs or stray functions remain).

- [ ] **Step 3: Full test suite**

Run: `cd backend && python -m pytest -q`
Expected: same pass count as the Task 1 baseline. Zero failures.

- [ ] **Step 4: Boot + OpenAPI smoke test**

Run:
```bash
cd backend && python -c "
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
assert c.get('/health').json()['status'] == 'ok'
spec = c.get('/openapi.json').json()
tags = sorted({t for p in spec['paths'].values() for op in p.values() for t in op.get('tags', [])})
print('tags:', tags)
assert {'health','languages','context','tts','sessions','realtime'} <= set(tags)
print('smoke ok')
"
```
Expected: prints the six tags and `smoke ok`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py
git commit -m "refactor: reduce main.py to the FastAPI app assembler"
```

---

## Self-review notes (for the implementer)

- **No paths change.** The route-snapshot test (Task 1) is the guardrail; it runs in every task's test step.
- **Every commit is green.** Services are extracted with `main.py` aliasing the moved names, so endpoints keep working until their router lands.
- **Namespace-sensitive patches** are retargeted in the same commit that moves the symbol: `_revise_translation_samples` (Task 7), `_deepl_*` (Task 9), `session_belongs_to` (Task 11), `resolve_user_from_token` (Task 12).
- **`_require_owner`** stays HTTP-layer (in `routers/sessions.py`), per the spec.
- **Grep-before-delete**: when removing imports from `main.py`, always grep first — several modules (`shared`, `make_session`, `os`, `json`) are used by more than one endpoint and must survive until the last user moves.
- If any test fails after a move, do not patch the test to pass — re-check the move preserved behavior, and apply systematic-debugging.
```
