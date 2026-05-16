"""
Session management and speaker profiling for transcription sessions.
"""

import json
import os
import wave
import subprocess
from datetime import datetime
from typing import Optional
from collections import defaultdict

# Audio settings (shared with transcription module)
SAMPLE_RATE = 16000
NUM_CHANNELS = 1
AUDIO_SAMPLE_WIDTH = 2  # 16-bit PCM

# Language confidence threshold
LANGUAGE_CONFIDENCE_THRESHOLD = 0.5

# Timestamp format for segment filenames
SEGMENT_TIMESTAMP_FORMAT = '%Y%m%d_%H%M%S'


class SpeakerProfile:
    """Track language usage for a speaker."""
    
    def __init__(self, speaker_id: int):
        self.speaker_id = speaker_id
        self.language_counts: dict[str, int] = defaultdict(int)
        self.last_language: Optional[str] = None
        self.total_samples = 0
        self.display_name: Optional[str] = None

    def add_sample(self, language: str) -> None:
        """Record a language sample for this speaker."""
        self.language_counts[language] += 1
        self.last_language = language
        self.total_samples += 1

    def get_dominant_language(self) -> Optional[str]:
        """Get the most used language, or None if no samples."""
        if not self.language_counts:
            return None
        return max(self.language_counts, key=self.language_counts.get)

    def get_label(self) -> str:
        """Get display label for speaker."""
        if self.display_name:
            return self.display_name
        return f"Speaker {self.speaker_id}"

    def to_dict(self) -> dict:
        """Serialize to dictionary."""
        return {
            "language_counts": dict(self.language_counts),
            "last_language": self.last_language,
            "total_samples": self.total_samples,
            "display_name": self.display_name,
        }

    @classmethod
    def from_dict(cls, speaker_id: int, data: dict) -> "SpeakerProfile":
        """Deserialize from dictionary."""
        profile = cls(speaker_id)
        profile.language_counts = defaultdict(int, data.get("language_counts", {}))
        profile.last_language = data.get("last_language")
        profile.total_samples = data.get("total_samples", 0)
        profile.display_name = data.get("display_name")
        return profile


class Session:
    """Manage a transcription session with state persistence."""

    def __init__(
        self,
        name: str,
        base_dir: str,
        source_languages: list[str],
        target_language: str,
    ):
        self.name = name
        self.base_dir = base_dir
        self.source_languages = source_languages
        self.target_language = target_language
        self.session_dir = os.path.join(base_dir, "output", name)
        self.state_file = os.path.join(self.session_dir, "session_state.json")
        self.speaker_profiles: dict[int, SpeakerProfile] = {}
        self.final_tokens: list[dict] = []
        self.segment_count = 0
        self.audio_frames: list[bytes] = []
        self._was_resumed = False
        self._dirty = False

        # Create session directory
        os.makedirs(self.session_dir, exist_ok=True)

        # Load existing state if resuming
        self._load_state()
    
    @property
    def was_resumed(self) -> bool:
        """Check if session was resumed from existing state."""
        return self._was_resumed
    
    def _load_state(self) -> None:
        """Load session state if it exists."""
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    state = json.load(f)

                self.segment_count = state.get("segment_count", 0)
                self.final_tokens = state.get("tokens", [])

                # Load language config if available (backward compatibility)
                if "source_languages" in state and "target_language" in state:
                    self.source_languages = state["source_languages"]
                    self.target_language = state["target_language"]

                # Restore speaker profiles
                for sid, profile_data in state.get("speaker_profiles", {}).items():
                    self.speaker_profiles[int(sid)] = SpeakerProfile.from_dict(
                        int(sid), profile_data
                    )

                self._was_resumed = True
            except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                pass  # Start fresh if state is corrupted
    
    def get_resume_info(self) -> Optional[dict]:
        """Get information about resumed session."""
        if not self._was_resumed:
            return None
        return {
            "segment_count": self.segment_count,
            "token_count": len(self.final_tokens),
            "speaker_count": len(self.speaker_profiles),
        }
    
    def save_state(self) -> None:
        """Save current session state atomically.

        Writes to a sibling .tmp file and renames into place so a Ctrl+C
        (or crash) mid-write can never leave a half-written state file.
        """
        state = {
            "name": self.name,
            "updated": datetime.now().isoformat(),
            "source_languages": self.source_languages,
            "target_language": self.target_language,
            "segment_count": self.segment_count,
            "tokens": self.final_tokens,
            "speaker_profiles": {
                sid: profile.to_dict()
                for sid, profile in self.speaker_profiles.items()
            }
        }

        tmp_path = self.state_file + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, self.state_file)
        self._dirty = False

    @property
    def is_dirty(self) -> bool:
        """True if there are unsaved changes since the last save_state()."""
        return self._dirty
    
    def get_speaker_profile(self, speaker_id: int) -> SpeakerProfile:
        """Get or create speaker profile."""
        if speaker_id not in self.speaker_profiles:
            self.speaker_profiles[speaker_id] = SpeakerProfile(speaker_id)
        return self.speaker_profiles[speaker_id]
    
    def add_audio_frame(self, frame: bytes) -> None:
        """Add audio frame to buffer."""
        self.audio_frames.append(frame)

    def add_token(self, token: dict) -> None:
        """Add a finalized token to the session."""
        self.final_tokens.append(token)
        self._dirty = True
    
    def get_tokens_by_speaker(self, speaker_id: int) -> list[dict]:
        """Get all tokens from a specific speaker."""
        return [t for t in self.final_tokens if t.get("speaker") == speaker_id]
    
    def save_segment(self) -> str:
        """Save current segment (transcript + audio).

        Ordered by interrupt-cost: the resumable state file is written first
        (cheapest, most important), then snapshot files, then WAV, then the
        slow ffmpeg MP3 conversion last. A Ctrl+C partway through at worst
        skips the MP3 step; the transcript is already on disk.
        """
        self.segment_count += 1
        timestamp = datetime.now().strftime(SEGMENT_TIMESTAMP_FORMAT)
        base_name = f"segment_{self.segment_count:03d}_{timestamp}"

        # 1. Resumable state first (atomic, fastest path to durability).
        self.save_state()

        # 2. Snapshot transcript JSON.
        json_path = os.path.join(self.session_dir, f"{base_name}.json")
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump({
                "session": self.name,
                "segment": self.segment_count,
                "saved": datetime.now().isoformat(),
                "tokens": self.final_tokens,
                "speaker_profiles": {
                    sid: {
                        "label": profile.get_label(),
                        "language_counts": dict(profile.language_counts),
                    }
                    for sid, profile in self.speaker_profiles.items()
                }
            }, f, ensure_ascii=False, indent=2)

        # 3. Snapshot plain text.
        txt_path = os.path.join(self.session_dir, f"{base_name}.txt")
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(self.render_plain_text())

        # 4. Audio: WAV is quick; MP3 conversion (inside _save_audio) is the
        # slowest step and may be interrupted by a second Ctrl+C. That's OK -
        # the WAV will still be on disk.
        if self.audio_frames:
            self._save_audio(base_name)

        return json_path
    
    def _save_audio(self, base_name: str) -> str:
        """Save audio frames to WAV, then convert to MP3 if possible."""
        wav_path = os.path.join(self.session_dir, f"{base_name}.wav")
        mp3_path = os.path.join(self.session_dir, f"{base_name}.mp3")
        
        # Save WAV
        with wave.open(wav_path, "wb") as wf:
            wf.setnchannels(NUM_CHANNELS)
            wf.setsampwidth(AUDIO_SAMPLE_WIDTH)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(b"".join(self.audio_frames))
        
        # Try to convert to MP3 using ffmpeg
        try:
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-qscale:a", "2", mp3_path],
                capture_output=True,
                timeout=60
            )
            if result.returncode == 0:
                os.remove(wav_path)  # Remove WAV if MP3 succeeded
                return mp3_path
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass  # ffmpeg not available or timed out
        
        return wav_path
    
    def render_plain_text(self) -> str:
        """Render tokens as plain text, one block per speaker turn.

        Each block lists every language present (original + mirrored
        translation, in lexicographic order). Two-way translation means we
        don't try to distinguish original from translation here — both are
        the same content, the reader picks the one they understand.
        """
        blocks: list[tuple[Optional[int], dict[str, str]]] = []
        current_speaker: Optional[int] = None
        current_texts: dict[str, str] = {}

        def flush() -> None:
            nonlocal current_texts
            if any(t.strip() for t in current_texts.values()):
                blocks.append((current_speaker, dict(current_texts)))
            current_texts = {}

        for token in self.final_tokens:
            text = token.get("text", "")
            speaker = token.get("speaker")
            language = token.get("language")
            if speaker != current_speaker:
                flush()
                current_speaker = speaker
            if language:
                current_texts[language] = current_texts.get(language, "") + text
        flush()

        lines: list[str] = []
        for speaker, texts in blocks:
            if speaker is not None:
                label = self.get_speaker_profile(speaker).get_label()
            else:
                label = "Unknown"
            lines.append(f"{label}:")
            for lang in sorted(texts):
                snippet = texts[lang].strip()
                if snippet:
                    lines.append(f"  [{lang}] {snippet}")
            lines.append("")
        return "\n".join(lines).strip()


def resolve_language(token: dict, session: Session) -> str:
    """
    Resolve the language for a token, using speaker history if confidence is low.
    Also tracks the language sample for the speaker.
    """
    speaker = token.get("speaker")
    language: Optional[str] = token.get("language")
    confidence: float = token.get("language_confidence", 1.0)
    
    if speaker is None:
        return language if language is not None else "en"
    
    profile = session.get_speaker_profile(speaker)
    last_lang = profile.last_language
    
    # If confidence is below threshold, use last known language
    if confidence < LANGUAGE_CONFIDENCE_THRESHOLD and last_lang is not None:
        return last_lang
    
    # Record this language sample
    if language is not None:
        profile.add_sample(language)
        return language
    
    if last_lang is not None:
        return last_lang
    return "en"

