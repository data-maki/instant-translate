"""Soniox realtime bridge for browser audio."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Awaitable, Callable

import websockets

from .sessions import DEFAULT_CONTEXT, build_phrases, make_session, process_soniox_tokens


SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
SONIOX_MODEL = "stt-rt-v3"
AUDIO_FORMAT = "pcm_s16le"
SAMPLE_RATE = 16000
NUM_CHANNELS = 1

SendEvent = Callable[[dict[str, Any]], Awaitable[None]]
ReceiveAudio = Callable[[], Awaitable[bytes | str | None]]


def get_soniox_config(
    api_key: str,
    source_languages: list[str],
    context: str | None = None,
) -> dict[str, Any]:
    lang_a, lang_b = source_languages[0], source_languages[1]
    config: dict[str, Any] = {
        "api_key": api_key,
        "model": SONIOX_MODEL,
        "audio_format": AUDIO_FORMAT,
        "sample_rate": SAMPLE_RATE,
        "num_channels": NUM_CHANNELS,
        "language_hints": [lang_a, lang_b],
        "enable_language_identification": True,
        "enable_speaker_diarization": True,
        "enable_endpoint_detection": True,
        "translation": {
            "type": "two_way",
            "language_a": lang_a,
            "language_b": lang_b,
        },
    }
    if context:
        config["context"] = {"text": context}
    return config


async def run_transcription_bridge(
    *,
    start_message: dict[str, Any],
    receive_audio: ReceiveAudio,
    send_event: SendEvent,
) -> None:
    api_key = os.environ.get("SONIOX_API_KEY")
    if not api_key:
        await send_event({
            "type": "error",
            "message": "Missing SONIOX_API_KEY. Add it to .env or the backend environment.",
        })
        return

    session = make_session(
        start_message.get("session_name") or "",
        start_message.get("source_languages") or ["en", "ja"],
        start_message.get("target_language") or "en",
    )
    context = (start_message.get("context") or DEFAULT_CONTEXT).strip()

    await send_event({
        "type": "session",
        "session": {
            "name": session.name,
            "source_languages": session.source_languages,
            "target_language": session.target_language,
            "was_resumed": session.was_resumed,
            "token_count": len(session.final_tokens),
        },
    })

    try:
        async with websockets.connect(SONIOX_WEBSOCKET_URL, ping_interval=20) as soniox:
            await soniox.send(json.dumps(get_soniox_config(api_key, session.source_languages, context)))
            await send_event({"type": "status", "status": "listening"})

            stop_event = asyncio.Event()
            partial_tokens: list[dict[str, Any]] = []

            async def browser_to_soniox() -> None:
                while not stop_event.is_set():
                    payload = await receive_audio()
                    if payload is None:
                        break
                    if isinstance(payload, str):
                        try:
                            control = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        if control.get("type") == "stop":
                            break
                        continue
                    if payload:
                        session.add_audio_frame(payload)
                        await soniox.send(payload)
                stop_event.set()
                try:
                    await soniox.send("")
                except Exception:
                    pass

            async def soniox_to_browser() -> None:
                nonlocal partial_tokens
                async for message in soniox:
                    response = json.loads(message)
                    if response.get("error_code") is not None:
                        await send_event({
                            "type": "error",
                            "message": f"{response['error_code']} - {response.get('error_message', 'Unknown error')}",
                        })
                        stop_event.set()
                        break

                    _final, partial_tokens = process_soniox_tokens(
                        session,
                        response.get("tokens", []),
                    )
                    await send_event({
                        "type": "transcript",
                        "phrases": build_phrases(session, partial_tokens),
                        "final_token_count": len(session.final_tokens),
                    })

                    if response.get("finished"):
                        stop_event.set()
                        break

            sender = asyncio.create_task(browser_to_soniox())
            receiver = asyncio.create_task(soniox_to_browser())
            done, pending = await asyncio.wait(
                {sender, receiver},
                return_when=asyncio.FIRST_COMPLETED,
            )
            stop_event.set()
            for task in pending:
                task.cancel()
            for task in done:
                task.result()

    except Exception as exc:
        await send_event({"type": "error", "message": str(exc)})
    finally:
        if session.final_tokens:
            try:
                path = session.save_segment()
                await send_event({
                    "type": "saved",
                    "path": str(path),
                    "phrases": build_phrases(session, []),
                })
            except OSError as exc:
                await send_event({"type": "error", "message": f"Failed to save session: {exc}"})
        await send_event({"type": "status", "status": "stopped"})
