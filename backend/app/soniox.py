"""Soniox realtime bridge for browser audio."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Awaitable, Callable

import websockets

from .sessions import DEFAULT_CONTEXT, build_phrases, make_session, process_soniox_tokens, summarize_finished_session


SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
SONIOX_MODEL = "stt-rt-v4"
AUDIO_FORMAT = "pcm_s16le"
SAMPLE_RATE = 16000
NUM_CHANNELS = 1

SendEvent = Callable[[dict[str, Any]], Awaitable[None]]
ReceiveAudio = Callable[[], Awaitable[bytes | str | None]]


def get_soniox_config(
    api_key: str,
    source_languages: list[str],
    context: str | None = None,
    language_hints: list[str] | None = None,
) -> dict[str, Any]:
    lang_a, lang_b = source_languages[0], source_languages[1]
    hints = list(dict.fromkeys(language_hints or source_languages))
    config: dict[str, Any] = {
        "api_key": api_key,
        "model": SONIOX_MODEL,
        "audio_format": AUDIO_FORMAT,
        "sample_rate": SAMPLE_RATE,
        "num_channels": NUM_CHANNELS,
        "language_hints": hints,
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

    requested_languages = start_message.get("source_languages") or ["en", "ja"]
    target_language = start_message.get("target_language") or "en"
    session = make_session(start_message.get("session_name") or "", requested_languages, target_language)
    context = (start_message.get("context") or DEFAULT_CONTEXT).strip()
    session.context = context
    session.expected_speaker_count = parse_expected_speaker_count(start_message.get("expected_speaker_count"))
    session.expected_speaker_names = parse_expected_speaker_names(start_message.get("expected_speaker_names"))

    await send_event({
        "type": "session",
        "session": {
            "name": session.name,
            "title": "New chat",
            "source_languages": session.source_languages,
            "target_language": session.target_language,
            "expected_speaker_count": session.expected_speaker_count,
            "expected_speaker_names": session.expected_speaker_names,
            "was_resumed": session.was_resumed,
            "token_count": len(session.final_tokens),
        },
    })

    try:
        async with websockets.connect(SONIOX_WEBSOCKET_URL, ping_interval=20) as soniox:
            await soniox.send(json.dumps(get_soniox_config(
                api_key,
                session.source_languages,
                context,
                list(requested_languages) + [target_language],
            )))
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
                summary = summarize_finished_session(session)
                await send_event(saved_transcript_event(session, path, summary))
            except OSError as exc:
                await send_event({"type": "error", "message": f"Failed to save session: {exc}"})
        await send_event({"type": "status", "status": "stopped"})


def saved_transcript_event(session, path, summary: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "type": "saved",
        "session": session.name,
        "path": str(path),
        "title": summary.get("title") if summary else "New chat",
        "summary": summary.get("summary") if summary else None,
        "phrases": build_phrases(session, []),
        "token_count": len(session.final_tokens),
    }


def parse_expected_speaker_count(value: Any) -> int | None:
    if value in {None, ""}:
        return None
    try:
        count = int(value)
    except (TypeError, ValueError):
        return None
    return count if count > 0 else None


def parse_expected_speaker_names(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(name).strip() for name in value if str(name).strip()]
