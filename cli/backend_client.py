"""Terminal client for the FastAPI transcription backend."""

from __future__ import annotations

import json
import threading
from urllib.parse import urlparse, urlunparse

import pyaudio  # type: ignore
from websockets.sync.client import connect

from live_transcriber.transcription import CHUNK_SIZE, NUM_CHANNELS, SAMPLE_RATE


def backend_ws_url(base_url: str) -> str:
    """Convert a backend HTTP or WS base URL into the transcript WebSocket URL."""
    parsed = urlparse(base_url.strip())
    if not parsed.scheme:
        parsed = urlparse(f"http://{base_url.strip()}")
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunparse((scheme, parsed.netloc, "/ws/transcribe", "", "", ""))


class BackendTerminalClient:
    """Capture microphone audio and stream it through the local FastAPI backend."""

    def __init__(
        self,
        *,
        backend_url: str,
        session_name: str,
        source_languages: list[str],
        target_language: str,
        context: str,
        device_index: int | None = None,
    ) -> None:
        self.websocket_url = backend_ws_url(backend_url)
        self.session_name = session_name
        self.source_languages = source_languages
        self.target_language = target_language
        self.context = context
        self.device_index = device_index
        self._running = threading.Event()
        self._audio: pyaudio.PyAudio | None = None
        self._stream: pyaudio.Stream | None = None
        self._socket = None
        self._mic_thread: threading.Thread | None = None
        self._recv_thread: threading.Thread | None = None

    def run(self) -> None:
        device_index = self._open_microphone()
        if device_index is None:
            raise RuntimeError("No microphone found")

        print(f"Connecting terminal client to {self.websocket_url}")
        with connect(self.websocket_url) as websocket:
            self._socket = websocket
            websocket.send(json.dumps({
                "type": "start",
                "session_name": self.session_name,
                "source_languages": self.source_languages,
                "target_language": self.target_language,
                "context": self.context,
            }))
            self._running.set()
            self._mic_thread = threading.Thread(target=self._stream_microphone, daemon=True)
            self._recv_thread = threading.Thread(target=self._receive_events, daemon=True)
            self._mic_thread.start()
            self._recv_thread.start()

            print("Listening through backend. Press Enter to stop.")
            try:
                input()
            except (KeyboardInterrupt, EOFError):
                print()
            finally:
                self.stop()

    def stop(self) -> None:
        self._running.clear()
        if self._socket:
            try:
                self._socket.send(json.dumps({"type": "stop"}))
            except Exception:
                pass
        if self._mic_thread:
            self._mic_thread.join(timeout=1)
        if self._recv_thread:
            self._recv_thread.join(timeout=2)
        if self._stream:
            self._stream.stop_stream()
            self._stream.close()
            self._stream = None
        if self._audio:
            self._audio.terminate()
            self._audio = None

    def _open_microphone(self) -> int | None:
        self._audio = pyaudio.PyAudio()
        device_index = self.device_index if self.device_index is not None else self._default_input_device()
        if device_index is None:
            return None
        self._stream = self._audio.open(
            format=pyaudio.paInt16,
            channels=NUM_CHANNELS,
            rate=SAMPLE_RATE,
            input=True,
            input_device_index=device_index,
            frames_per_buffer=CHUNK_SIZE,
        )
        return device_index

    def _default_input_device(self) -> int | None:
        assert self._audio is not None
        try:
            return int(self._audio.get_default_input_device_info()["index"])
        except OSError:
            for index in range(self._audio.get_device_count()):
                info = self._audio.get_device_info_by_index(index)
                if info.get("maxInputChannels", 0) > 0:
                    return index
        return None

    def _stream_microphone(self) -> None:
        assert self._stream is not None
        while self._running.is_set() and self._socket:
            data = self._stream.read(CHUNK_SIZE, exception_on_overflow=False)
            self._socket.send(data)

    def _receive_events(self) -> None:
        while self._running.is_set() and self._socket:
            try:
                event = json.loads(self._socket.recv())
            except Exception:
                return
            self._print_event(event)

    def _print_event(self, event: dict) -> None:
        event_type = event.get("type")
        if event_type == "status":
            print(f"[backend] {event.get('status')}")
            return
        if event_type == "session":
            session = event.get("session", {})
            print(f"[session] {session.get('name')} ({session.get('source_languages')} -> {session.get('target_language')})")
            return
        if event_type == "error":
            print(f"[error] {event.get('message')}")
            self._running.clear()
            return
        if event_type == "saved":
            print(f"[saved] {event.get('path')}")
            return
        if event_type != "transcript":
            return

        phrases = event.get("phrases") or []
        if not phrases:
            return
        phrase = phrases[-1]
        state = "final" if phrase.get("is_final") else "live"
        speaker = phrase.get("speaker_label") or "Unknown"
        texts = phrase.get("texts") or {}
        left = texts.get(self.source_languages[0], "")
        right = texts.get(self.source_languages[1], "")
        print(f"[{state}] {speaker}: {left} | {right}")
