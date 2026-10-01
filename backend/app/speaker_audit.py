"""Independent, local acoustic checks on saved speaker labels.

This is a review aid, not a second source of ground-truth identities. WeSpeaker
embeddings can flag inconsistent voice samples without changing Soniox text or
labels. Run after recording: the live translation/audio path never waits for it.
"""

from __future__ import annotations

from collections import defaultdict
from functools import lru_cache
import math
import os
from pathlib import Path
import subprocess
import time
from typing import Any


DEFAULT_MODEL = Path.home() / ".cache/cottonoha/speakers/wespeaker_en_voxceleb_resnet34_LM.onnx"
MIN_WINDOW_MS = 1500
MAX_WINDOW_MS = 3500
MAX_WINDOWS_PER_SPEAKER = 96
# Conservative review triggers, not calibrated probabilities of identity.
SAME_VOICE_SUPPORT = 0.65
VOICE_CONFLICT = 0.35


def voice_windows(tokens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Use spoken-word times, never translation timestamps or language identity."""
    words = []
    for token in tokens:
        start, end = token.get("start_ms"), token.get("end_ms")
        if (token.get("translation_status") == "translation" or token.get("speaker") is None
                or str(token.get("text", "")).strip().lower() in ("", "<end>")
                or not isinstance(start, (int, float)) or not isinstance(end, (int, float))
                or not math.isfinite(start) or not math.isfinite(end) or end <= start):
            continue
        words.append({"speaker": str(token["speaker"]), "start_ms": max(0, start), "end_ms": end})
    words.sort(key=lambda word: word["start_ms"])
    windows = []
    current = None

    def finish():
        if current and current["end_ms"] - current["start_ms"] >= MIN_WINDOW_MS:
            # A known overlapping voice is not a clean reference sample.
            if not any(w["speaker"] != current["speaker"]
                       and w["start_ms"] < current["end_ms"] and w["end_ms"] > current["start_ms"]
                       for w in words):
                windows.append(dict(current))

    for word in words:
        if (current is None or word["speaker"] != current["speaker"]
                or word["start_ms"] - current["end_ms"] > 450
                or word["end_ms"] - current["start_ms"] > MAX_WINDOW_MS):
            finish()
            current = dict(word)
        else:
            current["end_ms"] = max(current["end_ms"], word["end_ms"])
    finish()
    return windows


def find_voice_conflicts(samples: list[dict[str, Any]], embeddings: list[list[float]]) -> list[dict[str, Any]]:
    """Flag a merged label only when BOTH conflicting voices have repeat support.

    One short/noisy outlier cannot establish another person. Even corroborated
    disagreements remain review suggestions: mic position and language changes
    may affect embeddings, particularly outside the model's training domain.
    """
    by_speaker: dict[str, list[int]] = defaultdict(list)
    normalized = []
    for sample, vector in zip(samples, embeddings, strict=True):
        norm = math.sqrt(sum(x * x for x in vector))
        if not norm or not math.isfinite(norm):
            normalized.append(None)
            continue
        by_speaker[sample["speaker"]].append(len(normalized))
        normalized.append([x / norm for x in vector])

    def similarity(i, j):
        return sum(a * b for a, b in zip(normalized[i], normalized[j], strict=True))

    conflicts = []
    for speaker, indices in by_speaker.items():
        if len(indices) < 4:
            continue
        pairs = sorted((similarity(i, j), i, j) for pos, i in enumerate(indices) for j in indices[pos + 1:])
        for score, left, right in pairs:
            if score > VOICE_CONFLICT:
                break
            left_support = [i for i in indices if i not in (left, right) and similarity(left, i) >= SAME_VOICE_SUPPORT]
            right_support = [i for i in indices if i not in (left, right) and similarity(right, i) >= SAME_VOICE_SUPPORT]
            if not left_support or not right_support or set(left_support) & set(right_support):
                continue
            conflicts.append({
                "speaker": speaker,
                "kind": "possible_merged_voices",
                "similarity": round(score, 3),
                "first": samples[left],
                "second": samples[right],
                "support": [samples[left_support[0]], samples[right_support[0]]],
            })
            break
    return conflicts


@lru_cache(maxsize=1)
def _extractor(model: str):
    import sherpa_onnx
    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=model, num_threads=2, provider="cpu")
    if not config.validate():
        raise ValueError("Invalid speaker embedding model")
    return sherpa_onnx.SpeakerEmbeddingExtractor(config)


def audit_speakers(audio_path: str | Path, tokens: list[dict[str, Any]]) -> dict[str, Any]:
    model = Path(os.environ.get("SPEAKER_EMBEDDING_MODEL") or DEFAULT_MODEL)
    base = {"model": model.name, "conflicts": [], "automatically_relabelled": False}
    if not model.is_file():
        return {**base, "status": "unavailable", "reason": "Speaker embedding model is not installed."}
    windows = voice_windows(tokens)
    by_speaker: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for window in windows:
        by_speaker[window["speaker"]].append(window)
    selected = []
    for rows in by_speaker.values():
        # Spread samples across the recording, rather than checking only its start.
        count = min(MAX_WINDOWS_PER_SPEAKER, len(rows))
        selected.extend(rows[round(i * (len(rows) - 1) / max(1, count - 1))] for i in range(count))
    if not any(len(rows) >= 4 for rows in by_speaker.values()):
        return {**base, "status": "insufficient_audio", "sample_count": 0, "candidate_windows": len(windows)}
    started = time.monotonic()
    try:
        import numpy as np
        extractor = _extractor(str(model))
        audio = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(audio_path), "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
            check=True, capture_output=True, timeout=90,
        ).stdout
        waveform = np.frombuffer(audio, dtype="<i2").astype(np.float32) / 32768.0
        samples, embeddings = [], []
        for window in selected:
            start, end = round(window["start_ms"] * 16), round(window["end_ms"] * 16)
            # Never silently clip an out-of-range timestamp into a different sample.
            if start < 0 or end > len(waveform):
                continue
            chunk = waveform[start:end]
            if len(chunk) < MIN_WINDOW_MS * 16 or float(np.max(np.abs(chunk))) < 0.001:
                continue
            stream = extractor.create_stream()
            stream.accept_waveform(sample_rate=16000, waveform=chunk)
            stream.input_finished()
            if not extractor.is_ready(stream):
                continue
            vector = list(extractor.compute(stream))
            if not vector or not any(v != 0 for v in vector) or not all(math.isfinite(v) for v in vector):
                continue
            samples.append(window)
            embeddings.append(vector)
        conflicts = find_voice_conflicts(samples, embeddings)
        counts = {speaker: sum(s["speaker"] == speaker for s in samples) for speaker in by_speaker}
        enough = any(count >= 4 for count in counts.values())
        return {**base, "status": "needs_review" if conflicts else "no_conflicts_detected" if enough else "insufficient_audio",
                "conflicts": conflicts, "sample_count": len(samples), "samples_per_speaker": counts,
                "candidate_windows": len(windows), "sampled": len(samples) < len(windows),
                "elapsed_seconds": round(time.monotonic() - started, 3),
                "note": "Acoustic review triggers, not verified identities. No-conflict results do not prove correct diarization."}
    except (ImportError, OSError, ValueError, RuntimeError, subprocess.SubprocessError) as exc:
        return {**base, "status": "unavailable", "reason": f"Independent voice check failed: {type(exc).__name__}."}


def audit_summary(report: dict[str, Any]) -> str:
    conflicts = report.get("conflicts") or []
    if conflicts:
        first = conflicts[0]
        def clock(window):
            seconds = round(window["start_ms"] / 1000)
            return f"{seconds // 60}:{seconds % 60:02d}"
        return (f"Independent voice check flagged {len(conflicts)} possible merged speaker label(s). "
                f"Compare audio near {clock(first['first'])} and {clock(first['second'])}; labels need review.")
    if report.get("status") == "no_conflicts_detected":
        return f"No voice conflicts found in {report['sample_count']} audio samples. This does not verify all speaker labels."
    if report.get("status") == "insufficient_audio":
        return "Not enough clean speech for an independent voice check. Speaker labels remain unverified."
    return "Independent voice check unavailable. Speaker labels remain unverified."
