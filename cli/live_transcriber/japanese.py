"""Japanese-specific helpers: kanji/kana to Hepburn romaji."""

from __future__ import annotations

from typing import Optional


_KAKASI = None
_KAKASI_INIT_FAILED = False


def _get_kakasi():
    """Lazy-load pykakasi. Returns None if the dep is missing.

    Loading is deferred until the first Japanese token so that users who
    never see Japanese audio don't pay the import cost or hit the import
    error path.
    """
    global _KAKASI, _KAKASI_INIT_FAILED
    if _KAKASI is not None:
        return _KAKASI
    if _KAKASI_INIT_FAILED:
        return None
    try:
        import pykakasi  # type: ignore
        _KAKASI = pykakasi.kakasi()
        return _KAKASI
    except ImportError:
        _KAKASI_INIT_FAILED = True
        return None


def to_romaji(text: str) -> Optional[str]:
    """Convert Japanese text (kanji/hiragana/katakana mix) to Hepburn romaji.

    Returns None if the text has no Japanese-script content or if pykakasi
    is not installed. Joins segments with spaces; pykakasi splits on word
    boundaries so this gives readable output like "konnichiwa sekai".
    """
    if not text or not _contains_japanese(text):
        return None
    kks = _get_kakasi()
    if kks is None:
        return None
    parts = []
    for segment in kks.convert(text):
        hepburn = segment.get("hepburn", "").strip()
        if hepburn:
            parts.append(hepburn)
    return " ".join(parts) if parts else None


def _contains_japanese(text: str) -> bool:
    """True if text contains any hiragana, katakana, or CJK ideographs.

    Skips the pykakasi call for pure-ASCII strings (which Soniox sometimes
    emits even for Japanese audio — e.g. romanized brand names).
    """
    for ch in text:
        code = ord(ch)
        # Hiragana 3040-309F, Katakana 30A0-30FF, CJK Unified 4E00-9FFF,
        # Katakana Phonetic Extensions 31F0-31FF, half-width Katakana FF66-FF9F.
        if (0x3040 <= code <= 0x309F
                or 0x30A0 <= code <= 0x30FF
                or 0x4E00 <= code <= 0x9FFF
                or 0x31F0 <= code <= 0x31FF
                or 0xFF66 <= code <= 0xFF9F):
            return True
    return False
