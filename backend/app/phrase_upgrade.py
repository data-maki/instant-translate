"""Fast live phrase upgrades: English rewrite plus DeepL translation."""

from __future__ import annotations

import json
import os
from typing import Any


GROQ_REWRITE_TIMEOUT_SECONDS = 2.5
DEEPL_PRO_TRANSLATE_URL = "https://api.deepl.com/v2/translate"
DEEPL_TRANSLATE_TIMEOUT_SECONDS = 2.0
DEEPL_FORMALITY_TARGETS = {"DE", "ES", "FR", "IT", "JA", "NL", "PL", "PT-BR", "PT-PT", "RU"}
LANGUAGE_NAMES = {
    "en": "English",
    "ja": "Japanese",
    "my": "Burmese",
    "th": "Thai",
    "vi": "Vietnamese",
}


def adapt_phrase_with_groq(
    api_key: str,
    source_language: str,
    target_language: str,
    source_text: str,
    rewrite_context: dict[str, Any],
) -> dict[str, str]:
    import requests

    prompt = build_rewrite_prompt(source_language, target_language, source_text, rewrite_context)
    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": os.environ.get("GROQ_REWRITE_MODEL", "qwen/qwen3-32b"),
                "messages": [
                    {
                        "role": "system",
                        "content": "You adapt live English utterances into better English for downstream translation. Return only valid JSON with source_rewrite only.",
                    },
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
                "response_format": {"type": "json_object"},
                "reasoning_effort": "none",
                "temperature": 0.2,
                "max_completion_tokens": 300,
            },
            timeout=GROQ_REWRITE_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Groq phrase adaptation failed: {exc}") from exc
    if response.status_code != 200:
        raise RuntimeError(f"Groq phrase adaptation failed: {response.status_code} {response.text[:200]}")

    try:
        text = response.json()["choices"][0]["message"]["content"]
        payload = json.loads(strip_reasoning_block(str(text)))
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Groq phrase adaptation response had no message content") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError("Groq phrase adaptation returned invalid JSON") from exc
    return {"source_rewrite": str(payload.get("source_rewrite") or "").strip()}


def build_rewrite_prompt(
    source_language: str,
    target_language: str,
    source_text: str,
    rewrite_context: dict[str, Any],
) -> dict[str, Any]:
    target_label = language_label(target_language)
    return {
        "task": (
            f"Rewrite a live English utterance into better English for downstream {target_label} translation. "
            f"Do not translate to {target_label} or any other language. Preserve the user's intent, but adapt the English phrasing "
            "to the relationship, setting, politeness, and spoken context. Do not add new facts, explanations, emotions, "
            "apologies, gratitude, or inferred objects that were not said. Preserve explicit referents like 'this', 'that', "
            "'here', and named items unless the recent dialogue makes the referent explicit. If the source English is already "
            "natural and clear, keep source_rewrite very close to the original. Write English that will lift cleanly into "
            "natural spoken translation: explicit action, clear object, simple sentence shape, and the right politeness cue. "
            "Preserve time relations exactly: 'until 3' means through 3, while 'by 3' means no later than 3. "
            "For restaurant payment, rewrite ambiguous 'check' as 'bill' before downstream translation. "
            "Return only the concise English rewrite. No explanations. Return JSON only."
        ),
        "source_language": source_language,
        "downstream_translation_language": target_language,
        "source_text": source_text,
        "rewrite_context": rewrite_context,
        "source_candidates": clean_list(rewrite_context.get("transcription_candidates"))[:4],
        "translation_candidates": clean_list(rewrite_context.get("translation_candidates"))[:4],
        "hard_constraints": [
            "source_rewrite must stay close to source_text unless the original is rude, awkward, or unclear.",
            "Do not infer unstated objects. Keep this/that/here/there unless recent_dialogue explicitly resolves it.",
            "Preserve who is doing the action: 'could we' asks permission; 'can you' asks the listener to act.",
            f"Do not output {target_label} or any non-English text.",
            "Do not add apologies or thanks unless source_text says them or the situation absolutely requires a conventional attention-getter.",
            "Preserve until/by distinctions exactly.",
            "Use strong deference mainly for senior/client/external contexts, not ordinary coworkers.",
            "Do not make source_rewrite unnatural English solely to force target-language honorifics or business formulas.",
        ],
        "examples": [
            {"source_text": "I want the check.", "source_rewrite": "I'd like the bill, please."},
            {"source_text": "I can't eat that because I have a shrimp allergy.", "source_rewrite": "I can't eat that — I'm allergic to shrimp."},
            {"source_text": "Could we move the meeting to Friday?", "source_rewrite": "Could we reschedule the meeting to Friday?"},
            {"source_text": "Where is platform three?", "source_rewrite": "Excuse me, where is train platform three?"},
        ],
        "output_schema": {"source_rewrite": "natural English rewrite of the intended utterance"},
    }


def translate_with_deepl(
    api_key: str,
    text: str,
    source_language: str,
    target_language: str,
    context: str,
    rewrite_context: dict[str, Any] | None = None,
) -> str:
    import requests

    body: dict[str, Any] = {
        "text": [text],
        "source_lang": deepl_language(source_language),
        "target_lang": deepl_language(target_language),
        "model_type": "latency_optimized",
    }
    if context:
        body["context"] = context[:4000]
    formality = deepl_formality(rewrite_context or {}, target_language)
    if formality:
        body["formality"] = formality
    glossary_id = os.environ.get("DEEPL_GLOSSARY_ID")
    if glossary_id:
        body["glossary_id"] = glossary_id

    try:
        response = requests.post(
            deepl_translate_url(),
            headers={"Authorization": f"DeepL-Auth-Key {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=DEEPL_TRANSLATE_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"DeepL translation failed: {exc}") from exc
    if response.status_code != 200:
        raise RuntimeError(f"DeepL translation failed: {response.status_code} {response.text[:200]}")

    try:
        return str(response.json()["translations"][0]["text"] or "").strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("DeepL translation response had no translated text") from exc


def deepl_context(rewrite_context: dict[str, Any], payload: dict[str, Any]) -> str:
    parts: list[str] = []
    draft_translation = str(payload.get("draft_translation") or "").strip()
    target_language = str(payload.get("target_language") or "").strip()
    if draft_translation:
        label = f"Previous {language_label(target_language)} draft" if target_language else "Previous target-language draft"
        parts.append(f"{label}: {draft_translation}")
    tone = rewrite_context.get("tone")
    if isinstance(tone, dict):
        for label, key in (("Setting", "setting"), ("Audience", "audience")):
            value = str(tone.get(key) or "").strip()
            if value:
                parts.append(f"{label}: {value}")
    recent = rewrite_context.get("recent_dialogue")
    if isinstance(recent, list):
        for item in recent[-10:]:
            if not isinstance(item, dict):
                continue
            english = str(item.get("english") or "").strip()
            target = str(item.get("target") or item.get("japanese") or "").strip()
            if english or target:
                parts.append(f"Previous turn: {english} / {target}".strip())
    return "\n".join(parts)


def deepl_language(language: str) -> str:
    return {"en": "EN", "ja": "JA"}.get(language.lower(), language.upper())


def language_label(language: str) -> str:
    return LANGUAGE_NAMES.get(language.lower(), language.upper())


def deepl_translate_url() -> str:
    return os.environ.get("DEEPL_API_URL") or DEEPL_PRO_TRANSLATE_URL


def deepl_formality(rewrite_context: dict[str, Any], target_language: str = "ja") -> str:
    if deepl_language(target_language) not in DEEPL_FORMALITY_TARGETS:
        return ""
    configured = os.environ.get("DEEPL_FORMALITY")
    if configured:
        return configured
    tone = rewrite_context.get("tone")
    if isinstance(tone, dict):
        explicit = str(tone.get("deepl_formality") or "").strip()
        if explicit and explicit != "auto":
            return explicit
        register = str(tone.get("register") or "").strip()
        audience = str(tone.get("audience") or "").strip().lower()
        if register == "casual_intimate" and not any(marker in audience for marker in ("in-law", "older", "staff", "client", "customer")):
            return "less"
    return "more"


def clean_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def strip_reasoning_block(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("<think>") and "</think>" in stripped:
        return stripped.split("</think>", 1)[1].strip()
    return stripped
