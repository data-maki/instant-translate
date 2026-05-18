"""
WebSocket transcription and audio capture module.
"""

import json
import sys
import threading
from typing import Optional, Callable
from queue import Queue

from websockets import ConnectionClosedOK
from websockets.sync.client import connect
import pyaudio  # type: ignore

from .session import Session, resolve_language


def print_macos_mic_mode_advisory() -> None:
    """Warn macOS users to disable Voice Isolation before transcribing.

    Voice Isolation and Wide Spectrum apply heavy spectral processing that
    flattens voice timbre, which causes Soniox diarization to merge similar
    speakers into one cluster. macOS exposes this only via Control Center
    while the capturing app is running, so we can't toggle it programmatically.
    """
    if sys.platform != "darwin":
        return
    print(
        "\n  macOS mic mode check (multi-speaker accuracy):\n"
        "    While this app is running, open Control Center (menu bar)\n"
        "      -> click the Mic tile -> select \"Standard\".\n"
        "    Avoid \"Voice Isolation\" and \"Wide Spectrum\"; both merge similar voices.\n"
    )

SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket"
SONIOX_MODEL = "stt-rt-v3"
AUDIO_FORMAT = "pcm_s16le"

# Audio settings
SAMPLE_RATE = 16000
NUM_CHANNELS = 1
CHUNK_SIZE = 3200  # ~200ms at 16kHz


def get_soniox_config(
    api_key: str,
    source_languages: list[str],
    context: Optional[str] = None,
) -> dict:
    """Get Soniox STT config for two-way translation between two source
    languages (e.g. en↔ja). If more than two are passed (legacy session
    state from before the two-way switch), only the first two are used.
    """
    if len(source_languages) < 2:
        raise ValueError(
            f"need at least 2 source languages for two-way translation, "
            f"got {source_languages}"
        )
    lang_a, lang_b = source_languages[0], source_languages[1]

    config = {
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


def list_audio_devices() -> list[tuple[int, str]]:
    """List all available input devices. Returns list of (index, name) tuples."""
    audio = pyaudio.PyAudio()
    devices = []
    for i in range(audio.get_device_count()):
        info = audio.get_device_info_by_index(i)
        if info.get("maxInputChannels", 0) > 0:
            devices.append((i, str(info.get("name", "Unknown"))))
    audio.terminate()
    return devices


class Transcriber:
    """Handles WebSocket connection and audio streaming for transcription."""

    def __init__(
        self,
        api_key: str,
        session: Session,
        source_languages: list[str],
        on_tokens: Optional[Callable[[list[dict], list[dict]], None]] = None,
        on_error: Optional[Callable[[str], None]] = None,
        on_connected: Optional[Callable[[], None]] = None,
        context: Optional[str] = None,
        device_index: Optional[int] = None,
    ):
        self.api_key = api_key
        self.session = session
        self.source_languages = source_languages
        self.on_tokens = on_tokens
        self.on_error = on_error
        self.on_connected = on_connected
        self.context = context
        self.device_index = device_index
        
        self._running = threading.Event()
        self._pyaudio: Optional[pyaudio.PyAudio] = None
        self._stream: Optional[pyaudio.Stream] = None
        self._websocket = None
        self._mic_thread: Optional[threading.Thread] = None
        self._recv_thread: Optional[threading.Thread] = None
        self._device_name: Optional[str] = None
        
    @property
    def is_running(self) -> bool:
        return self._running.is_set()
    
    @property
    def device_name(self) -> Optional[str]:
        return self._device_name
    
    def _get_input_devices(self) -> list[tuple[int, dict]]:
        """Get all available input devices."""
        devices = []
        for i in range(self._pyaudio.get_device_count()):
            info = self._pyaudio.get_device_info_by_index(i)
            if info.get("maxInputChannels", 0) > 0:
                devices.append((i, info))
        return devices

    def _select_device(self, idx: int, info: dict) -> int:
        """Select a device and set its name."""
        self._device_name = str(info.get("name", "Unknown"))
        return idx

    def _find_microphone(self) -> Optional[int]:
        """Find input device - uses specified device_index, or prefers MacBook mic."""
        self._pyaudio = pyaudio.PyAudio()

        # If a specific device was requested, use it
        if self.device_index is not None:
            try:
                info = self._pyaudio.get_device_info_by_index(self.device_index)
                if info.get("maxInputChannels", 0) > 0:
                    return self._select_device(self.device_index, info)
            except OSError:
                pass
            return None

        # Get all input devices
        input_devices = self._get_input_devices()
        if not input_devices:
            return None

        # Prefer MacBook's built-in microphone
        for idx, info in input_devices:
            name = str(info.get("name", "")).lower()
            if "macbook" in name and "microphone" in name:
                return self._select_device(idx, info)

        # Fall back to system default
        try:
            default_info = self._pyaudio.get_default_input_device_info()
            default_name = default_info.get("name")
            for idx, info in input_devices:
                if info.get("name") == default_name:
                    return self._select_device(idx, info)
        except OSError:
            pass

        # Last resort: first available
        idx, info = input_devices[0]
        return self._select_device(idx, info)
    
    def _stream_microphone(self) -> None:
        """Capture audio from microphone and send to websocket."""
        try:
            while self._running.is_set() and self._stream and self._websocket:
                data = self._stream.read(CHUNK_SIZE, exception_on_overflow=False)
                self.session.add_audio_frame(data)
                self._websocket.send(data)
        except (OSError, ConnectionError):
            pass

        # Signal end-of-audio
        try:
            if self._websocket:
                self._websocket.send("")
        except (OSError, ConnectionError):
            pass
    
    def _receive_messages(self) -> None:
        """Receive and process messages from websocket."""
        try:
            while self._running.is_set() and self._websocket:
                message = self._websocket.recv()
                res = json.loads(message)
                
                # Error from server
                if res.get("error_code") is not None:
                    if self.on_error:
                        self.on_error(f"{res['error_code']} - {res.get('error_message', 'Unknown error')}")
                    break
                
                # Parse tokens
                final_tokens: list[dict] = []
                non_final_tokens: list[dict] = []
                
                for token in res.get("tokens", []):
                    if token.get("text"):
                        # Resolve language using speaker history
                        resolved_lang = resolve_language(token, self.session)
                        token["resolved_language"] = resolved_lang
                        
                        if token.get("is_final"):
                            self.session.add_token(token)
                            final_tokens.append(token)
                        else:
                            non_final_tokens.append(token)
                
                # Notify callback
                if self.on_tokens:
                    self.on_tokens(final_tokens, non_final_tokens)
                
                if res.get("finished"):
                    break
                    
        except ConnectionClosedOK:
            pass
        except Exception as e:
            if self.on_error and self._running.is_set():
                self.on_error(str(e))
    
    def start(self) -> bool:
        """Start transcription. Returns True if started successfully."""
        device_idx = self._find_microphone()
        
        if device_idx is None or self._pyaudio is None:
            if self.on_error:
                self.on_error("No microphone found")
            return False
        
        # Open audio stream
        self._stream = self._pyaudio.open(
            format=pyaudio.paInt16,
            channels=NUM_CHANNELS,
            rate=SAMPLE_RATE,
            input=True,
            input_device_index=device_idx,
            frames_per_buffer=CHUNK_SIZE
        )
        
        self._running.set()
        
        try:
            # Connect to WebSocket
            config = get_soniox_config(
                self.api_key,
                self.source_languages,
                self.context,
            )
            self._websocket = connect(SONIOX_WEBSOCKET_URL)
            self._websocket.send(json.dumps(config))
            
            if self.on_connected:
                self.on_connected()
            
            # Start microphone streaming thread
            self._mic_thread = threading.Thread(
                target=self._stream_microphone,
                daemon=True,
            )
            self._mic_thread.start()
            
            # Start receive thread
            self._recv_thread = threading.Thread(
                target=self._receive_messages,
                daemon=True,
            )
            self._recv_thread.start()
            
            return True
            
        except Exception as e:
            self.stop()
            if self.on_error:
                self.on_error(str(e))
            return False
    
    def stop(self) -> None:
        """Stop transcription and clean up resources."""
        self._running.clear()

        if self._websocket:
            try:
                self._websocket.close()
            except (OSError, ConnectionError):
                pass
            self._websocket = None

        if self._stream:
            try:
                self._stream.stop_stream()
                self._stream.close()
            except OSError:
                pass
            self._stream = None

        if self._pyaudio:
            try:
                self._pyaudio.terminate()
            except OSError:
                pass
            self._pyaudio = None
    
    def wait(self) -> None:
        """Wait for transcription to complete."""
        if self._recv_thread:
            self._recv_thread.join()

