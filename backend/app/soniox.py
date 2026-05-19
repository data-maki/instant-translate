"""Soniox realtime bridge for browser audio."""

from __future__ import annotations

import asyncio
import audioop
import base64
import json
import os
from typing import Any, Awaitable, Callable

import websockets

from .sessions import DEFAULT_CONTEXT, build_phrases, make_session, process_soniox_tokens, summarize_finished_session


SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
DEEPGRAM_WEBSOCKET_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-3&language=en&encoding=linear16&sample_rate=16000&channels=1"
    "&interim_results=true&smart_format=true&endpointing=300"
)
OPENAI_TRANSLATION_WEBSOCKET_URL = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate"
SONIOX_MODEL = "stt-rt-v4"
AUDIO_FORMAT = "pcm_s16le"
SAMPLE_RATE = 16000
OPENAI_TRANSLATION_SAMPLE_RATE = 24000
NUM_CHANNELS = 1

SendEvent = Callable[[dict[str, Any]], Awaitable[None]]
ReceiveAudio = Callable[[], Awaitable[bytes | str | None]]


def get_soniox_config(
    api_key: str,
    source_languages: list[str],
    context: str | dict[str, Any] | None = None,
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
            provider_queues: list[asyncio.Queue[bytes | None]] = []
            provider_tasks: list[asyncio.Task[None]] = []
            deepgram_key = os.environ.get("DEEPGRAM_API_KEY")
            openai_key = os.environ.get("OPENAI_API_KEY")
            if deepgram_key:
                deepgram_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=80)
                provider_queues.append(deepgram_queue)
                provider_tasks.append(asyncio.create_task(run_deepgram_bridge(deepgram_key, deepgram_queue, safe_send_event)))
            if openai_key:
                openai_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=80)
                provider_queues.append(openai_queue)
                provider_tasks.append(asyncio.create_task(run_openai_translation_bridge(openai_key, openai_queue, safe_send_event)))

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
                        for queue in provider_queues:
                            try:
                                queue.put_nowait(payload)
                            except asyncio.QueueFull:
                                pass
                stop_event.set()
                for queue in provider_queues:
                    try:
                        queue.put_nowait(None)
                    except asyncio.QueueFull:
                        pass
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
            for task in provider_tasks:
                task.cancel()

    except Exception as exc:
        await safe_send_event({"type": "error", "message": str(exc)})
    finally:
        if session.final_tokens:
            try:
                path = session.save_segment()
                summary = summarize_finished_session(session)
                await safe_send_event(saved_transcript_event(session, path, summary))
            except OSError as exc:
                await safe_send_event({"type": "error", "message": f"Failed to save session: {exc}"})
        await safe_send_event({"type": "status", "status": "stopped"})


async def run_deepgram_bridge(
    api_key: str,
    audio_queue: asyncio.Queue[bytes | None],
    send_event: SendEvent,
) -> None:
    try:
        async with websockets.connect(
            DEEPGRAM_WEBSOCKET_URL,
            additional_headers={"Authorization": f"Token {api_key}"},
            ping_interval=20,
        ) as deepgram:
            sender = asyncio.create_task(send_audio_queue(deepgram, audio_queue))

            async for message in deepgram:
                data = json.loads(message)
                channel = data.get("channel") if isinstance(data, dict) else None
                alternatives = channel.get("alternatives") if isinstance(channel, dict) else None
                if not alternatives:
                    continue
                transcript = str(alternatives[0].get("transcript") or "").strip()
                if transcript:
                    await send_event({
                        "type": "provider_update",
                        "provider": "deepgram",
                        "kind": "transcript",
                        "text": transcript,
                        "is_final": bool(data.get("is_final")),
                    })
                if sender.done():
                    break
    except Exception as exc:
        await send_event({"type": "provider_update", "provider": "deepgram", "kind": "error", "text": str(exc), "is_final": True})


async def run_openai_translation_bridge(
    api_key: str,
    audio_queue: asyncio.Queue[bytes | None],
    send_event: SendEvent,
) -> None:
    try:
        async with websockets.connect(
            OPENAI_TRANSLATION_WEBSOCKET_URL,
            additional_headers={"Authorization": f"Bearer {api_key}"},
            ping_interval=20,
        ) as openai:
            await openai.send(json.dumps({
                "type": "session.update",
                "session": {
                    "audio": {
                        "input": {
                            "transcription": {"model": "gpt-realtime-whisper"},
                            "noise_reduction": {"type": "near_field"},
                        },
                        "output": {"language": "ja"},
                    }
                },
            }))
            sender = asyncio.create_task(send_openai_translation_audio(openai, audio_queue))
            input_text = ""
            output_text = ""
            async for message in openai:
                data = json.loads(message)
                event_type = data.get("type")
                if event_type == "session.input_transcript.delta":
                    input_text += str(data.get("delta") or "")
                    if input_text.strip():
                        await send_event({
                            "type": "provider_update",
                            "provider": "openai_realtime",
                            "kind": "transcript",
                            "text": input_text.strip(),
                            "is_final": False,
                        })
                elif event_type == "session.output_transcript.delta":
                    output_text += str(data.get("delta") or "")
                    if output_text.strip():
                        await send_event({
                            "type": "provider_update",
                            "provider": "openai_realtime",
                            "kind": "translation",
                            "text": output_text.strip(),
                            "is_final": False,
                        })
                elif event_type and event_type.endswith(".done"):
                    if input_text.strip():
                        await send_event({
                            "type": "provider_update",
                            "provider": "openai_realtime",
                            "kind": "transcript",
                            "text": input_text.strip(),
                            "is_final": True,
                        })
                    if output_text.strip():
                        await send_event({
                            "type": "provider_update",
                            "provider": "openai_realtime",
                            "kind": "translation",
                            "text": output_text.strip(),
                            "is_final": True,
                        })
                elif event_type == "error":
                    await send_event({
                        "type": "provider_update",
                        "provider": "openai_realtime",
                        "kind": "error",
                        "text": str(data.get("error") or data),
                        "is_final": True,
                    })
                if sender.done():
                    break
    except Exception as exc:
        await send_event({"type": "provider_update", "provider": "openai_realtime", "kind": "error", "text": str(exc), "is_final": True})


async def send_audio_queue(socket: Any, audio_queue: asyncio.Queue[bytes | None]) -> None:
    while True:
        payload = await audio_queue.get()
        if payload is None:
            break
        await socket.send(payload)


async def send_openai_translation_audio(socket: Any, audio_queue: asyncio.Queue[bytes | None]) -> None:
    while True:
        payload = await audio_queue.get()
        if payload is None:
            break
        resampled = audioop.ratecv(payload, 2, NUM_CHANNELS, SAMPLE_RATE, OPENAI_TRANSLATION_SAMPLE_RATE, None)[0]
        await socket.send(json.dumps({
            "type": "session.input_audio_buffer.append",
            "audio": base64.b64encode(resampled).decode("ascii"),
        }))


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
