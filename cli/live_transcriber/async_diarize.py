"""Run Soniox async transcription over a saved audio file to redo diarization.

The streaming `stt-rt-v3` model assigns speaker IDs chunk-by-chunk and tends
to collapse similar voices into Speaker 1/2 when run on a far-field mic. The
async `stt-async-v4` model gets the full audio in one shot, so it can
cluster voice embeddings globally and often separates speakers the realtime
model merged. Neither API exposes a min/max speaker hint anymore (those
fields belong to the legacy gRPC service); diarization is fully automatic.

This module is opt-in and runs after the live session ends.
"""

from __future__ import annotations

import os
import time
from typing import Optional, Callable

import requests

SONIOX_API_BASE = "https://api.soniox.com/v1"
ASYNC_MODEL = "stt-async-v4"

# Polling cadence: short enough to feel responsive, long enough to avoid
# hammering the API on multi-minute jobs.
POLL_INTERVAL_SEC = 3.0
POLL_TIMEOUT_SEC = 600.0  # 10 min hard cap; the user can Ctrl+C earlier

ProgressFn = Callable[[str], None]


class AsyncDiarizeError(RuntimeError):
    pass


def redo_diarization(
    api_key: str,
    audio_path: str,
    source_languages: list[str],
    target_language: str,
    context: Optional[str] = None,
    progress: Optional[ProgressFn] = None,
) -> list[dict]:
    """Upload `audio_path` and return a fresh token list with diarization.

    The returned tokens use the same schema the streaming API emits
    (`text`, `start_ms`, `end_ms`, `speaker`, `language`, `translation_status`),
    so they can drop into Session.final_tokens / render_plain_text unchanged.

    Raises AsyncDiarizeError on any non-recoverable failure.
    """
    if not os.path.exists(audio_path):
        raise AsyncDiarizeError(f"Audio file not found: {audio_path}")

    log = progress or (lambda _msg: None)
    headers = {"Authorization": f"Bearer {api_key}"}

    file_id = _upload_file(audio_path, headers, log)
    log(f"Uploaded {os.path.basename(audio_path)} (file_id={file_id[:8]}...)")

    transcription_id = _create_transcription(
        file_id, source_languages, target_language, context, headers, log
    )
    log(f"Transcription queued (id={transcription_id[:8]}...)")

    _wait_for_completion(transcription_id, headers, log)
    return _fetch_transcript_tokens(transcription_id, headers)


def _upload_file(audio_path: str, headers: dict, log: ProgressFn) -> str:
    log("Uploading audio...")
    with open(audio_path, "rb") as f:
        resp = requests.post(
            f"{SONIOX_API_BASE}/files",
            headers=headers,
            files={"file": (os.path.basename(audio_path), f)},
            timeout=300,
        )
    if resp.status_code != 201:
        raise AsyncDiarizeError(
            f"Upload failed: {resp.status_code} {resp.text[:200]}"
        )
    file_id = resp.json().get("id")
    if not file_id:
        raise AsyncDiarizeError("Upload succeeded but response had no file id")
    return file_id


def _create_transcription(
    file_id: str,
    source_languages: list[str],
    target_language: str,
    context: Optional[str],
    headers: dict,
    log: ProgressFn,
) -> str:
    log("Requesting transcription with diarization...")
    body: dict = {
        "model": ASYNC_MODEL,
        "file_id": file_id,
        "enable_speaker_diarization": True,
        "enable_language_identification": True,
    }
    if source_languages:
        body["language_hints"] = source_languages
    if target_language:
        body["translation"] = {
            "type": "one_way",
            "target_language": target_language,
        }
    if context:
        body["context"] = context

    resp = requests.post(
        f"{SONIOX_API_BASE}/transcriptions",
        headers={**headers, "Content-Type": "application/json"},
        json=body,
        timeout=60,
    )
    if resp.status_code not in (200, 201):
        raise AsyncDiarizeError(
            f"Create transcription failed: {resp.status_code} {resp.text[:300]}"
        )
    tid = resp.json().get("id")
    if not tid:
        raise AsyncDiarizeError("Create transcription returned no id")
    return tid


def _wait_for_completion(transcription_id: str, headers: dict, log: ProgressFn) -> None:
    start = time.monotonic()
    last_status = ""
    while True:
        elapsed = time.monotonic() - start
        if elapsed > POLL_TIMEOUT_SEC:
            raise AsyncDiarizeError(
                f"Transcription timed out after {POLL_TIMEOUT_SEC:.0f}s"
            )
        resp = requests.get(
            f"{SONIOX_API_BASE}/transcriptions/{transcription_id}",
            headers=headers,
            timeout=30,
        )
        if resp.status_code != 200:
            raise AsyncDiarizeError(
                f"Poll failed: {resp.status_code} {resp.text[:200]}"
            )
        body = resp.json()
        status = body.get("status", "unknown")
        if status != last_status:
            log(f"Status: {status} ({elapsed:.0f}s)")
            last_status = status
        if status == "completed":
            return
        if status == "error":
            err = body.get("error_message") or body.get("error_type") or "unknown"
            raise AsyncDiarizeError(f"Transcription failed: {err}")
        time.sleep(POLL_INTERVAL_SEC)


def _fetch_transcript_tokens(transcription_id: str, headers: dict) -> list[dict]:
    resp = requests.get(
        f"{SONIOX_API_BASE}/transcriptions/{transcription_id}/transcript",
        headers=headers,
        timeout=60,
    )
    if resp.status_code != 200:
        raise AsyncDiarizeError(
            f"Fetch transcript failed: {resp.status_code} {resp.text[:200]}"
        )
    return resp.json().get("tokens", [])
