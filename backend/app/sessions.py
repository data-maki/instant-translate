"""Web session persistence and transcript shaping."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

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
        raw = str(uuid4())
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_", " ") else "-" for ch in raw)
    return "-".join(safe.split())[:80] or "web-session"


def list_sessions() -> list[dict[str, Any]]:
    output_dir = shared.REPO_ROOT / "output"
    if not output_dir.exists():
        return []

    sessions: list[dict[str, Any]] = []
    for path in output_dir.iterdir():
        if not path.is_dir():
            continue
        state = read_session_state(path.name)
        if not state:
            continue
        title = session_display_title(path, state)
        updated = session_updated_iso(path, state.get("updated"))
        sessions.append({
            "name": path.name,
            "title": title,
            "updated": updated,
            "token_count": len(state.get("tokens", [])),
            "duration_seconds": session_duration_seconds(state.get("tokens", [])),
            "source_languages": state.get("source_languages"),
            "target_language": state.get("target_language"),
        })
    return sorted(sessions, key=lambda session: session_sort_time(output_dir / session["name"], session), reverse=True)


def session_updated_iso(session_dir: Path, updated: Any) -> str | None:
    if isinstance(updated, str) and parse_session_time(updated) is not None:
        return updated
    try:
        return datetime.fromtimestamp(session_dir.stat().st_mtime, timezone.utc).isoformat()
    except OSError:
        return None


def session_sort_time(session_dir: Path, session: dict[str, Any]) -> float:
    parsed = parse_session_time(session.get("updated"))
    if parsed is not None:
        return parsed
    try:
        return session_dir.stat().st_mtime
    except OSError:
        return 0


def parse_session_time(value: Any) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def session_display_title(session_dir: Path, state: dict[str, Any] | None) -> str:
    if state and state.get("title"):
        return str(state["title"])[:48]
    summary = read_session_summary(session_dir)
    if summary and summary.get("title"):
        return str(summary["title"])[:48]
    if state and state.get("tokens"):
        return fallback_session_title(session_dir.name)
    return "New chat"


def read_session_summary(session_dir: Path) -> dict[str, Any] | None:
    path = session_dir / "session_summary.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def write_session_summary(session_dir: Path, summary: str, title: str, model: str) -> None:
    clean_title = title.strip()[:48]
    clean_summary = summary.strip()
    if not clean_title or not clean_summary:
        return
    path = session_dir / "session_summary.json"
    path.write_text(
        json.dumps(
            {
                "summary": clean_summary,
                "title": clean_title,
                "model": model,
                "updated": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def summarize_finished_session(session: Session) -> dict[str, str] | None:
    existing = read_session_summary(Path(session.session_dir))
    if existing and existing.get("title") and existing.get("summary"):
        return {"title": str(existing["title"]), "summary": str(existing["summary"])}
    if not os.environ.get("OPENAI_API_KEY"):
        return None

    result = generate_session_summary(session.name, session.final_tokens)
    if result:
        write_session_summary(
            Path(session.session_dir),
            result["summary"],
            result["title"],
            os.environ.get("OPENAI_SESSION_TITLE_MODEL", "gpt-4o-mini"),
        )
    return result


def generate_session_summary(session_name: str, tokens: list[dict[str, Any]]) -> dict[str, str] | None:
    import requests

    transcript = session_title_sample(tokens)
    if not transcript:
        return None

    prompt = {
        "task": (
            "Summarize this bilingual transcript and generate a short sidebar title. "
            "The title should be 2 to 6 words, concrete, and max 48 characters. "
            "The summary should be one concise sentence."
        ),
        "session_id": session_name,
        "transcript": transcript,
        "output_schema": {"summary": "...", "title": "..."},
    }
    model = os.environ.get("OPENAI_SESSION_TITLE_MODEL", "gpt-4o-mini")
    try:
        response = requests.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "input": json.dumps(prompt, ensure_ascii=False),
                "text": {"format": {"type": "json_object"}},
                "max_output_tokens": 160,
            },
            timeout=30,
        )
        if response.status_code != 200:
            return None
        payload = json.loads(extract_openai_text(response.json()))
    except (OSError, KeyError, ValueError, requests.RequestException):
        return None
    summary = str(payload.get("summary") or "").strip()
    title = str(payload.get("title") or "").strip().strip('"').strip()
    if not summary or not title:
        return None
    return {"summary": summary, "title": title[:48]}


def session_title_sample(tokens: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for token in tokens:
        text = str(token.get("text") or "").replace("<end>", "").replace("<END>", "").strip()
        if not text or token.get("is_audio_event"):
            continue
        language = token.get("language") or token.get("source_language") or ""
        parts.append(f"[{language}] {text}")
        if sum(len(part) for part in parts) > 1200:
            break
    return "\n".join(parts)[:1200]


def extract_openai_text(data: dict[str, Any]) -> str:
    text = data.get("output_text")
    if isinstance(text, str):
        return text
    parts = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                parts.append(content["text"])
    return "".join(parts)


def fallback_session_title(name: str) -> str:
    if len(name) >= 32 and name.count("-") >= 4:
        return "New chat"
    clean = name.replace("web-", "").replace("-", " ").replace("_", " ").strip()
    if not clean:
        return "Untitled session"
    return clean[:48]


def read_session_state(name: str) -> dict[str, Any] | None:
    path = shared.REPO_ROOT / "output" / sanitize_session_name(name) / "session_state.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def session_duration_seconds(tokens: list[dict[str, Any]]) -> int | None:
    end_ms = 0.0
    for token in tokens:
        for key in ("end_ms", "start_ms"):
            value = token.get(key)
            if isinstance(value, (int, float)):
                end_ms = max(end_ms, float(value))
        for key in ("end_time", "start_time", "time"):
            value = token.get(key)
            if isinstance(value, (int, float)):
                end_ms = max(end_ms, float(value) * 1000)
    if end_ms <= 0:
        return None
    return max(1, round(end_ms / 1000))


def process_soniox_tokens(
    session: Session,
    raw_tokens: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    final_tokens: list[dict[str, Any]] = []
    partial_tokens: list[dict[str, Any]] = []

    session.record_translation_update(raw_tokens)
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
