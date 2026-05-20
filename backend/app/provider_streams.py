"""Optional realtime provider fanout for candidate transcripts/translations."""

from __future__ import annotations

import asyncio
import audioop
import base64
import json
import os
from typing import Any, Awaitable, Callable

import websockets


DEEPGRAM_WEBSOCKET_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?model=nova-3&language=en&encoding=linear16&sample_rate=16000&channels=1"
    "&interim_results=true&smart_format=true&endpointing=300"
)
OPENAI_TRANSLATION_WEBSOCKET_URL = "wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate"
SAMPLE_RATE = 16000
OPENAI_TRANSLATION_SAMPLE_RATE = 24000
NUM_CHANNELS = 1

SendEvent = Callable[[dict[str, Any]], Awaitable[None]]
OpenAISegmentSink = Callable[[str, str], Awaitable[None]]


class ProviderFanout:
    def __init__(
        self,
        send_event: SendEvent,
        *,
        enable_openai_realtime: bool = False,
        enable_deepgram: bool = True,
        on_openai_final_segment: OpenAISegmentSink | None = None,
    ):
        self.send_event = send_event
        self.enable_openai_realtime = enable_openai_realtime
        self.enable_deepgram = enable_deepgram
        self.on_openai_final_segment = on_openai_final_segment
        self.queues: list[asyncio.Queue[bytes | None]] = []
        self.tasks: list[asyncio.Task[None]] = []

    def start(self) -> None:
        deepgram_key = os.environ.get("DEEPGRAM_API_KEY")
        if self.enable_deepgram and deepgram_key:
            self._add_stream(run_deepgram_bridge(deepgram_key, self.send_event))

        openai_key = os.environ.get("OPENAI_API_KEY")
        if self.enable_openai_realtime and openai_key:
            self._add_stream(run_openai_translation_bridge(
                openai_key,
                self.send_event,
                on_final_segment=self.on_openai_final_segment,
            ))

    def publish(self, payload: bytes) -> None:
        for queue in self.queues:
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    def close_inputs(self) -> None:
        for queue in self.queues:
            try:
                queue.put_nowait(None)
            except asyncio.QueueFull:
                pass

    def cancel(self) -> None:
        for task in self.tasks:
            task.cancel()

    async def wait(self) -> None:
        if self.tasks:
            await asyncio.gather(*self.tasks)

    def _add_stream(self, coro_factory: Callable[[asyncio.Queue[bytes | None]], Awaitable[None]]) -> None:
        queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=80)
        self.queues.append(queue)
        self.tasks.append(asyncio.create_task(coro_factory(queue)))


def provider_update(provider: str, kind: str, text: str, is_final: bool) -> dict[str, Any]:
    return {
        "type": "provider_update",
        "provider": provider,
        "kind": kind,
        "text": text,
        "is_final": is_final,
    }


def openai_realtime_audio(delta: str) -> dict[str, Any]:
    return {
        "type": "openai_realtime_audio",
        "audio": delta,
        "format": "pcm_s16le",
        "sample_rate": OPENAI_TRANSLATION_SAMPLE_RATE,
    }


def run_deepgram_bridge(api_key: str, send_event: SendEvent):
    async def bridge(audio_queue: asyncio.Queue[bytes | None]) -> None:
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
                    if alternatives:
                        transcript = str(alternatives[0].get("transcript") or "").strip()
                        if transcript:
                            await send_event(provider_update("deepgram", "transcript", transcript, bool(data.get("is_final"))))
                    if sender.done():
                        break
        except Exception as exc:
            await send_event(provider_update("deepgram", "error", str(exc), True))

    return bridge


def run_openai_translation_bridge(
    api_key: str,
    send_event: SendEvent,
    *,
    on_final_segment: OpenAISegmentSink | None = None,
):
    async def bridge(audio_queue: asyncio.Queue[bytes | None]) -> None:
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
                last_input_committed = ""
                last_output_committed = ""

                async def commit_segment(kind: str, text: str) -> None:
                    if not text or not on_final_segment:
                        return
                    try:
                        await on_final_segment(kind, text)
                    except Exception:
                        pass

                async for message in openai:
                    data = json.loads(message)
                    event_type = data.get("type")
                    if event_type == "session.input_transcript.delta":
                        input_text += str(data.get("delta") or "")
                        if input_text.strip():
                            await send_event(provider_update("openai_realtime", "transcript", input_text.strip(), False))
                    elif event_type == "session.output_transcript.delta":
                        output_text += str(data.get("delta") or "")
                        if output_text.strip():
                            await send_event(provider_update("openai_realtime", "translation", output_text.strip(), False))
                    elif event_type == "session.output_audio.delta":
                        delta = str(data.get("delta") or "")
                        if delta:
                            await send_event(openai_realtime_audio(delta))
                    elif event_type == "session.closed":
                        break
                    elif event_type == "session.input_transcript.done":
                        final_text = input_text.strip()
                        if final_text and final_text != last_input_committed:
                            await send_event(provider_update("openai_realtime", "transcript", final_text, True))
                            await commit_segment("transcript", final_text)
                            last_input_committed = final_text
                        input_text = ""
                    elif event_type == "session.output_transcript.done":
                        final_text = output_text.strip()
                        if final_text and final_text != last_output_committed:
                            await send_event(provider_update("openai_realtime", "translation", final_text, True))
                            await commit_segment("translation", final_text)
                            last_output_committed = final_text
                        output_text = ""
                    elif event_type and event_type.endswith(".done"):
                        if input_text.strip():
                            await send_event(provider_update("openai_realtime", "transcript", input_text.strip(), True))
                        if output_text.strip():
                            await send_event(provider_update("openai_realtime", "translation", output_text.strip(), True))
                    elif event_type == "error":
                        await send_event(provider_update("openai_realtime", "error", str(data.get("error") or data), True))
                # Flush any in-flight partial as a final segment when the stream closes.
                if input_text.strip() and input_text.strip() != last_input_committed:
                    await commit_segment("transcript", input_text.strip())
                if output_text.strip() and output_text.strip() != last_output_committed:
                    await commit_segment("translation", output_text.strip())
                await sender
        except Exception as exc:
            await send_event(provider_update("openai_realtime", "error", str(exc), True))

    return bridge


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
            await socket.send(json.dumps({"type": "session.close"}))
            break
        resampled = audioop.ratecv(payload, 2, NUM_CHANNELS, SAMPLE_RATE, OPENAI_TRANSLATION_SAMPLE_RATE, None)[0]
        await socket.send(json.dumps({
            "type": "session.input_audio_buffer.append",
            "audio": base64.b64encode(resampled).decode("ascii"),
        }))
