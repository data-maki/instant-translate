"""FastAPI app for the cottonoha web UI."""

from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .languages import DEFAULT_SOURCE_LANGUAGES, DEFAULT_TARGET_LANGUAGE, list_languages
from .sessions import read_session_state, list_sessions
from .soniox import NUM_CHANNELS, SAMPLE_RATE, run_transcription_bridge


load_dotenv()

app = FastAPI(title="cottonoha API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):30\d{2}$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "has_soniox_key": bool(os.environ.get("SONIOX_API_KEY")),
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


@app.get("/languages")
def languages() -> dict[str, Any]:
    return {
        "default_source_languages": DEFAULT_SOURCE_LANGUAGES,
        "default_target_language": DEFAULT_TARGET_LANGUAGE,
        "languages": list_languages(),
    }


@app.get("/sessions")
def sessions() -> dict[str, Any]:
    return {"sessions": list_sessions()}


@app.get("/sessions/{session_name}")
def session_detail(session_name: str) -> dict[str, Any]:
    state = read_session_state(session_name)
    return {"session": state}


@app.websocket("/ws/transcribe")
async def transcribe(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        first = await websocket.receive_text()
        start_message = json.loads(first)
    except (WebSocketDisconnect, json.JSONDecodeError):
        await websocket.close(code=1003)
        return

    async def receive_audio() -> bytes | str | None:
        try:
            message = await websocket.receive()
        except WebSocketDisconnect:
            return None
        if message.get("bytes") is not None:
            return message["bytes"]
        if message.get("text") is not None:
            return message["text"]
        return None

    async def send_event(event: dict[str, Any]) -> None:
        await websocket.send_json(event)

    await run_transcription_bridge(
        start_message=start_message,
        receive_audio=receive_audio,
        send_event=send_event,
    )
