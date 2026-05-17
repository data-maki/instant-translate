"""Web session persistence and transcript shaping."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import shared
from .languages import validate_language_pair
from cli.live_transcriber.japanese import to_romaji
from cli.live_transcriber.session import Session, resolve_language


DEFAULT_CONTEXT = (
    "This is a natural bilingual conversation in Japan. Preserve nuance, "
    "casual tone, names, places, food, family context, and culturally specific references."
)


def make_session(
    name: str,
    source_languages: list[str],
    target_language: str,
) -> Session:
    sources, target = validate_language_pair(source_languages, target_language)
    safe_name = sanitize_session_name(name)
    return Session(safe_name, str(shared.REPO_ROOT), sources, target)


def sanitize_session_name(name: str | None) -> str:
    raw = (name or "").strip()
    if not raw:
        raw = datetime.now(timezone.utc).strftime("web-%Y%m%d-%H%M%S")
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_", " ") else "-" for ch in raw)
    return "-".join(safe.split())[:80] or "web-session"


def list_sessions() -> list[dict[str, Any]]:
    output_dir = shared.REPO_ROOT / "output"
    if not output_dir.exists():
        return []

    sessions: list[dict[str, Any]] = []
    for path in sorted(output_dir.iterdir(), key=lambda item: item.stat().st_mtime, reverse=True):
        if not path.is_dir():
            continue
        state = read_session_state(path.name)
        sessions.append({
            "name": path.name,
            "updated": state.get("updated") if state else None,
            "token_count": len(state.get("tokens", [])) if state else 0,
            "source_languages": state.get("source_languages") if state else None,
            "target_language": state.get("target_language") if state else None,
        })
    return sessions


def read_session_state(name: str) -> dict[str, Any] | None:
    path = shared.REPO_ROOT / "output" / sanitize_session_name(name) / "session_state.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def process_soniox_tokens(
    session: Session,
    raw_tokens: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    final_tokens: list[dict[str, Any]] = []
    partial_tokens: list[dict[str, Any]] = []

    for raw in raw_tokens:
        token = dict(raw)
        if not token.get("text"):
            continue
        token["resolved_language"] = resolve_language(token, session)
        if token.get("is_final"):
            session.add_token(token)
            final_tokens.append(token)
        else:
            partial_tokens.append(token)

    return final_tokens, partial_tokens


def build_phrases(session: Session, partial_tokens: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Group Soniox tokens into bilingual phrase cards for the UI."""
    phrases: list[dict[str, Any]] = []
    current_speaker: int | str | None = None
    current_source_lang: str | None = None
    texts: dict[str, str] = {}
    seen_translation = False
    buffer_is_final = True
    last_time: Any = None

    all_tokens = list(session.final_tokens)
    if partial_tokens:
        all_tokens.extend(partial_tokens)

    def clean(text: str) -> str:
        return text.replace("<end>", "").replace("<END>", "").strip()

    def flush() -> None:
        nonlocal texts, seen_translation, buffer_is_final, last_time
        cleaned = {lang: clean(text) for lang, text in texts.items()}
        cleaned = {lang: text for lang, text in cleaned.items() if text}
        if cleaned:
            speaker_label = "Unknown"
            if current_speaker is not None:
                speaker_label = session.get_speaker_profile(current_speaker).get_label()
            phrases.append({
                "id": f"{len(phrases)}-{current_speaker}-{current_source_lang}",
                "speaker": current_speaker,
                "speaker_label": speaker_label,
                "source_lang": current_source_lang,
                "texts": cleaned,
                "romaji_ja": to_romaji(cleaned.get("ja", "")) if "ja" in cleaned else None,
                "is_final": buffer_is_final,
                "time": last_time,
            })
        texts = {}
        seen_translation = False
        buffer_is_final = True
        last_time = None

    for token in all_tokens:
        token_text = token.get("text", "")
        speaker = token.get("speaker")
        language = token.get("language")
        is_translation = token.get("translation_status") == "translation"
        is_final = token.get("is_final", True)
        source_lang = token.get("source_language")
        utterance_source = source_lang if is_translation else language
        token_time = token.get("start_ms") or token.get("start_time") or token.get("time")

        if speaker is not None and speaker != current_speaker:
            flush()
            current_speaker = speaker
            current_source_lang = utterance_source
            token_text = token_text.lstrip()

        if (
            not is_translation
            and seen_translation
            and utterance_source
            and current_source_lang
            and utterance_source == current_source_lang
        ):
            flush()
            current_source_lang = utterance_source

        if (
            not is_translation
            and utterance_source
            and current_source_lang
            and utterance_source != current_source_lang
        ):
            flush()
            current_source_lang = utterance_source

        if current_source_lang is None:
            current_source_lang = utterance_source

        if not is_final:
            buffer_is_final = False
        if token_time is not None:
            last_time = token_time
        if language:
            texts[language] = texts.get(language, "") + token_text
        if is_translation:
            seen_translation = True

    flush()
    return phrases
