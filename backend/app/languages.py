"""Language API helpers."""

from __future__ import annotations

from . import shared  # noqa: F401
from cli.live_transcriber.languages import SONIOX_LANGUAGES


DEFAULT_SOURCE_LANGUAGES = ["en", "ja"]
DEFAULT_TARGET_LANGUAGE = "en"


def list_languages() -> list[dict[str, str]]:
    """Return supported languages in frontend-friendly shape."""
    return [
        {
            "code": code,
            "name": data["name"],
            "flag": data["flag"],
            "priority": "core" if code in DEFAULT_SOURCE_LANGUAGES else "available",
        }
        for code, data in sorted(SONIOX_LANGUAGES.items(), key=lambda item: item[1]["name"])
    ]


def validate_language_pair(source_languages: list[str], target_language: str) -> tuple[list[str], str]:
    """Validate and normalize the two-way language pair."""
    valid = set(SONIOX_LANGUAGES)
    clean_sources = [lang.strip().lower() for lang in source_languages if lang.strip()]
    clean_target = target_language.strip().lower()

    if not clean_sources:
        clean_sources = DEFAULT_SOURCE_LANGUAGES[:]
    if not clean_target:
        clean_target = DEFAULT_TARGET_LANGUAGE

    invalid = [lang for lang in clean_sources + [clean_target] if lang not in valid]
    if invalid:
        raise ValueError(f"Unsupported language code: {', '.join(sorted(set(invalid)))}")

    deduped_sources: list[str] = []
    for lang in clean_sources:
        if lang not in deduped_sources:
            deduped_sources.append(lang)
    clean_sources = deduped_sources

    if clean_target not in clean_sources:
        clean_sources.append(clean_target)

    non_target_sources = [lang for lang in clean_sources if lang != clean_target]
    if not non_target_sources:
        other = "ja" if clean_target == "en" else "en"
        clean_sources = [other, clean_target]
    else:
        clean_sources = [*non_target_sources, clean_target]

    if len(clean_sources) < 2 or len(set(clean_sources)) < 2:
        raise ValueError("Choose two different languages for two-way translation.")

    return clean_sources, clean_target
