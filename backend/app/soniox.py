"""Soniox realtime bridge for browser audio."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Awaitable, Callable

import websockets

from .provider_streams import ProviderFanout
from .sessions import (
    DEFAULT_CONTEXT,
    build_phrases,
    make_session,
    process_soniox_tokens,
    read_session_summary,
    schedule_session_summary,
)


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
    context: str | dict[str, Any] | None = None,
    language_hints: list[str] | None = None,
) -> dict[str, Any]:
    lang_b = source_languages[-1]
    lang_a = next((language for language in source_languages if language != lang_b), source_languages[0])
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
        config["context"] = normalize_soniox_context(context)
    return config


def normalize_soniox_context(context: str | dict[str, Any]) -> dict[str, Any]:
    if isinstance(context, str):
        return {"text": context}
    normalized: dict[str, Any] = {}
    general = context.get("general")
    if isinstance(general, list):
        entries = [
            {"key": str(item.get("key") or "").strip(), "value": str(item.get("value") or "").strip()}
            for item in general
            if isinstance(item, dict)
        ]
        normalized["general"] = [item for item in entries if item["key"] and item["value"]][:15]
    terms = context.get("terms")
    if isinstance(terms, list):
        normalized["terms"] = [str(term).strip() for term in terms if str(term).strip()][:60]
    text = context.get("text")
    if isinstance(text, str) and text.strip():
        normalized["text"] = text.strip()
    translation_terms = context.get("translation_terms")
    if isinstance(translation_terms, list):
        entries = [
            {"source": str(item.get("source") or "").strip(), "target": str(item.get("target") or "").strip()}
            for item in translation_terms
            if isinstance(item, dict)
        ]
        normalized["translation_terms"] = [item for item in entries if item["source"] and item["target"]][:20]
    return normalized


async def run_transcription_bridge(
    *,
    start_message: dict[str, Any],
    receive_audio: ReceiveAudio,
    send_event: SendEvent,
) -> None:
    if start_message.get("enable_openai_realtime"):
        await run_openai_realtime_overdub_bridge(
            start_message=start_message,
            receive_audio=receive_audio,
            send_event=send_event,
        )
        return

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
    user_id = str(start_message.get("user_id") or "").strip()
    if user_id:
        session.user_id = user_id
    context = normalize_start_context(start_message.get("context"))
    session.context = context_summary(context)
    session.expected_speaker_count = parse_expected_speaker_count(start_message.get("expected_speaker_count"))
    session.expected_speaker_names = parse_expected_speaker_names(start_message.get("expected_speaker_names"))
    send_lock = asyncio.Lock()

    async def safe_send_event(event: dict[str, Any]) -> None:
        async with send_lock:
            await send_event(event)

    await safe_send_event({
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
            await safe_send_event({"type": "status", "status": "listening"})

            stop_event = asyncio.Event()
            partial_tokens: list[dict[str, Any]] = []
            providers = ProviderFanout(
                safe_send_event,
                enable_openai_realtime=bool(start_message.get("enable_openai_realtime")),
            )
            providers.start()

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
                        providers.publish(payload)
                stop_event.set()
                providers.close_inputs()
                try:
                    await soniox.send("")
                except Exception:
                    pass

            async def soniox_to_browser() -> None:
                nonlocal partial_tokens
                async for message in soniox:
                    response = json.loads(message)
                    if response.get("error_code") is not None:
                        await safe_send_event({
                            "type": "error",
                            "message": f"{response['error_code']} - {response.get('error_message', 'Unknown error')}",
                        })
                        stop_event.set()
                        break

                    _final, partial_tokens = process_soniox_tokens(
                        session,
                        response.get("tokens", []),
                    )
                    await safe_send_event({
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
            providers.cancel()

    except Exception as exc:
        await safe_send_event({"type": "error", "message": str(exc)})
    finally:
        if session.final_tokens:
            try:
                path = session.save_segment()
            except OSError as exc:
                await safe_send_event({"type": "error", "message": f"Failed to save session: {exc}"})
            else:
                cached = read_session_summary(Path(session.session_dir))
                await safe_send_event(saved_transcript_event(session, path, cached))

                async def push_rename(summary: dict[str, str]) -> None:
                    try:
                        await safe_send_event({
                            "type": "session_renamed",
                            "session": session.name,
                            "title": summary["title"],
                            "summary": summary.get("summary"),
                        })
                    except Exception:
                        pass

                schedule_session_summary(session, push_rename)
        await safe_send_event({"type": "status", "status": "stopped"})


async def run_openai_realtime_overdub_bridge(
    *,
    start_message: dict[str, Any],
    receive_audio: ReceiveAudio,
    send_event: SendEvent,
) -> None:
    if not os.environ.get("OPENAI_API_KEY"):
        await send_event({
            "type": "error",
            "message": "Missing OPENAI_API_KEY. Add it to .env or the backend environment.",
        })
        return

    requested_languages = start_message.get("source_languages") or ["en", "ja"]
    target_language = start_message.get("target_language") or "en"
    session = make_session(start_message.get("session_name") or "", requested_languages, target_language)
    user_id = str(start_message.get("user_id") or "").strip()
    if user_id:
        session.user_id = user_id
    send_lock = asyncio.Lock()
    started_at = asyncio.get_running_loop().time()
    primary_source = session.source_languages[0] if session.source_languages else "en"

    async def safe_send_event(event: dict[str, Any]) -> None:
        async with send_lock:
            await send_event(event)

    async def capture_openai_segment(kind: str, text: str) -> None:
        if not text:
            return
        elapsed_ms = max(0, int((asyncio.get_running_loop().time() - started_at) * 1000))
        if kind == "transcript":
            language = primary_source
            translation_status = "original"
        else:
            language = session.target_language or "en"
            translation_status = "translation"
        token = {
            "text": text,
            "start_ms": elapsed_ms,
            "end_ms": elapsed_ms,
            "confidence": 1.0,
            "is_final": True,
            "speaker": "1",
            "language": language,
            "translation_status": translation_status,
            "resolved_language": language,
            "source": "openai_realtime",
        }
        session.add_token(token)

    await safe_send_event({
        "type": "session",
        "session": {
            "name": session.name,
            "title": "New chat",
            "source_languages": session.source_languages,
            "target_language": session.target_language,
            "expected_speaker_count": parse_expected_speaker_count(start_message.get("expected_speaker_count")),
            "expected_speaker_names": parse_expected_speaker_names(start_message.get("expected_speaker_names")),
            "was_resumed": False,
            "token_count": 0,
        },
    })

    providers = ProviderFanout(
        safe_send_event,
        enable_openai_realtime=True,
        enable_deepgram=False,
        on_openai_final_segment=capture_openai_segment,
    )
    providers.start()
    await safe_send_event({"type": "status", "status": "listening"})

    try:
        while True:
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
                providers.publish(payload)
    finally:
        providers.close_inputs()
        try:
            await providers.wait()
        except Exception as exc:
            await safe_send_event({"type": "error", "message": str(exc)})
        providers.cancel()
        if session.final_tokens:
            try:
                path = session.save_segment()
            except OSError as exc:
                await safe_send_event({"type": "error", "message": f"Failed to save session: {exc}"})
            else:
                cached = read_session_summary(Path(session.session_dir))
                await safe_send_event(saved_transcript_event(session, path, cached))

                async def push_rename(summary: dict[str, str]) -> None:
                    try:
                        await safe_send_event({
                            "type": "session_renamed",
                            "session": session.name,
                            "title": summary["title"],
                            "summary": summary.get("summary"),
                        })
                    except Exception:
                        pass

                schedule_session_summary(session, push_rename)
        await safe_send_event({"type": "status", "status": "stopped"})


def normalize_start_context(context: Any) -> str | dict[str, Any]:
    if isinstance(context, dict):
        normalized = normalize_soniox_context(context)
        return normalized or DEFAULT_CONTEXT
    if isinstance(context, str) and context.strip():
        return context.strip()
    return DEFAULT_CONTEXT


def context_summary(context: str | dict[str, Any]) -> str:
    if isinstance(context, str):
        return context
    parts: list[str] = []
    for item in context.get("general", []):
        if isinstance(item, dict) and item.get("key") and item.get("value"):
            parts.append(f"{item['key']}: {item['value']}")
    terms = context.get("terms", [])
    if isinstance(terms, list) and terms:
        parts.append("terms: " + ", ".join(str(term) for term in terms[:20]))
    translation_terms = context.get("translation_terms", [])
    if isinstance(translation_terms, list) and translation_terms:
        rendered = [
            f"{item.get('source')} -> {item.get('target')}"
            for item in translation_terms[:10]
            if isinstance(item, dict) and item.get("source") and item.get("target")
        ]
        if rendered:
            parts.append("translation_terms: " + "; ".join(rendered))
    text = context.get("text")
    if isinstance(text, str) and text.strip():
        parts.append(text.strip())
    return "\n".join(parts) or DEFAULT_CONTEXT


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
