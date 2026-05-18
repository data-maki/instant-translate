"""Shared CLI transcription helpers.

Keep this package import light so the web backend can reuse pyaudio-free
modules such as ``languages`` and ``session`` without loading microphone or
terminal UI dependencies.
"""

from .languages import SONIOX_LANGUAGES, get_all_language_codes, get_language_flag, get_language_name
from .session import Session, SpeakerProfile

__all__ = [
    "Session",
    "SpeakerProfile",
    "SONIOX_LANGUAGES",
    "get_language_name",
    "get_language_flag",
    "get_all_language_codes",
]
