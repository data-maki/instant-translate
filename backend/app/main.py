"""FastAPI app for the cottonoha web UI."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .languages import DEFAULT_SOURCE_LANGUAGES, DEFAULT_TARGET_LANGUAGE, list_languages
from . import shared
from .sessions import DEFAULT_CONTEXT, build_phrases, make_session, read_session_state, list_sessions, sanitize_session_name, session_display_title, session_duration_seconds
from .soniox import NUM_CHANNELS, SAMPLE_RATE, run_transcription_bridge
from cli.live_transcriber.async_diarize import AsyncDiarizeError, redo_diarization


GOOGLE_PLACES_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
GROQ_REWRITE_TIMEOUT_SECONDS = 2.5
DEEPL_PRO_TRANSLATE_URL = "https://api.deepl.com/v2/translate"
DEEPL_TRANSLATE_TIMEOUT_SECONDS = 2.0

load_dotenv()

app = FastAPI(title="cottonoha API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):30\d{2}$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "has_soniox_key": bool(os.environ.get("SONIOX_API_KEY")),
        "has_groq_key": bool(os.environ.get("GROQ_API_KEY")),
        "has_deepl_key": bool(os.environ.get("DEEPL_API_KEY")),
        "has_deepgram_key": bool(os.environ.get("DEEPGRAM_API_KEY")),
        "has_openai_key": bool(os.environ.get("OPENAI_API_KEY")),
        "has_google_maps_api_key": bool(_google_maps_api_key()),
        "audio": {
            "sample_rate": SAMPLE_RATE,
            "num_channels": NUM_CHANNELS,
            "format": "pcm_s16le",
        },
        "defaults": {
            "source_languages": DEFAULT_SOURCE_LANGUAGES,
            "target_language": DEFAULT_TARGET_LANGUAGE,
        },
    }


@app.post("/context/places")
def places_context(payload: dict[str, Any]) -> dict[str, Any]:
    api_key = _google_maps_api_key()
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing GOOGLE_MAPS_API_KEY for Google Places enrichment.")

    lat = _payload_float(payload, "lat")
    lng = _payload_float(payload, "lng")
    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="Expected lat and lng.")

    intent = str(payload.get("intent") or "").strip().lower()
    poi_type = str(payload.get("poi_type") or "").strip().lower()
    included_types = _google_place_types(intent, poi_type)

    try:
        places = _fetch_google_places(api_key, lat, lng, included_types)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return _places_context(places, intent, poi_type)


@app.post("/context/rewrite")
def rewrite_context(payload: dict[str, Any]) -> dict[str, str]:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing GROQ_API_KEY for phrase adaptation.")

    source_text = str(payload.get("source_text") or "").strip()
    source_language = str(payload.get("source_language") or "").strip()
    target_language = str(payload.get("target_language") or "").strip()
    rewrite_context = payload.get("rewrite_context") if isinstance(payload.get("rewrite_context"), dict) else {}
    if not source_text or not source_language or not target_language:
        raise HTTPException(status_code=400, detail="Expected source_language, target_language, and source_text.")

    try:
        result = _adapt_phrase_with_groq(api_key, source_language, target_language, source_text, rewrite_context)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    target_translation = ""
    if target_language == "ja" and result.get("source_rewrite"):
        deepl_key = os.environ.get("DEEPL_API_KEY")
        if deepl_key:
            try:
                target_translation = _translate_with_deepl(
                    deepl_key,
                    result["source_rewrite"],
                    source_language,
                    target_language,
                    _deepl_context(rewrite_context, payload),
                    rewrite_context,
                )
            except RuntimeError:
                target_translation = ""
    return {**result, "target_translation": target_translation}


@app.post("/context/translate")
def translate_context(payload: dict[str, Any]) -> dict[str, str]:
    api_key = os.environ.get("DEEPL_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing DEEPL_API_KEY for phrase translation.")

    source_text = str(payload.get("source_text") or "").strip()
    source_language = str(payload.get("source_language") or "").strip()
    target_language = str(payload.get("target_language") or "").strip()
    rewrite_context = payload.get("rewrite_context") if isinstance(payload.get("rewrite_context"), dict) else {}
    if not source_text or not source_language or not target_language:
        raise HTTPException(status_code=400, detail="Expected source_language, target_language, and source_text.")

    try:
        target_translation = _translate_with_deepl(
            api_key,
            source_text,
            source_language,
            target_language,
            _deepl_context(rewrite_context, payload),
            rewrite_context,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"target_translation": target_translation}


@app.get("/languages")
def languages() -> dict[str, Any]:
    return {
        "default_source_languages": DEFAULT_SOURCE_LANGUAGES,
        "default_target_language": DEFAULT_TARGET_LANGUAGE,
        "languages": list_languages(),
    }


def _google_maps_api_key() -> str | None:
    return os.environ.get("GOOGLE_MAPS_API_KEY")


def _payload_float(payload: dict[str, Any], key: str) -> float | None:
    try:
        return float(payload[key])
    except (KeyError, TypeError, ValueError):
        return None


def _google_place_types(intent: str, poi_type: str) -> list[str]:
    signal = f"{intent} {poi_type}"
    if "train" in signal or "station" in signal:
        return ["train_station", "subway_station", "bus_station"]
    if "restaurant" in signal or "food" in signal:
        return ["restaurant", "cafe"]
    if "hotel" in signal:
        return ["hotel"]
    if "shrine" in signal or "temple" in signal:
        return ["tourist_attraction", "place_of_worship"]
    if "shop" in signal or "shopping" in signal:
        return ["store", "shopping_mall"]
    if "doctor" in signal or "clinic" in signal or "hospital" in signal:
        return ["hospital", "doctor"]
    return []


def _fetch_google_places(api_key: str, lat: float, lng: float, included_types: list[str]) -> list[dict[str, Any]]:
    body: dict[str, Any] = {
        "maxResultCount": 8,
        "rankPreference": "DISTANCE",
        "locationRestriction": {
            "circle": {
                "center": {"latitude": lat, "longitude": lng},
                "radius": 500.0,
            }
        },
    }
    if included_types:
        body["includedTypes"] = included_types
    request = urllib.request.Request(
        GOOGLE_PLACES_NEARBY_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": api_key,
            "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.primaryType,places.types",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Google Places request failed ({exc.code}): {detail[:300]}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Google Places request failed: {exc}") from exc
    places = data.get("places", [])
    return places if isinstance(places, list) else []


def _places_context(places: list[dict[str, Any]], intent: str, poi_type: str) -> dict[str, Any]:
    names: list[str] = []
    general: list[str] = []
    terms = _base_terms_for_place_signal(intent, poi_type)
    translation_terms = _base_translation_terms_for_place_signal(intent, poi_type)
    for place in places:
        if not isinstance(place, dict):
            continue
        name = _place_name(place)
        if not name:
            continue
        names.append(name)
        primary_type = str(place.get("primaryType") or "").replace("_", " ")
        address = str(place.get("formattedAddress") or "").strip()
        general.append(f"Nearby POI: {name}" + (f" ({primary_type})" if primary_type else ""))
        if address:
            general.append(f"Nearby address: {address}")
    return {
        "places": _dedupe(names),
        "general": _dedupe(general),
        "terms": _dedupe(names + terms),
        "translation_terms": _dedupe(translation_terms),
    }


def _place_name(place: dict[str, Any]) -> str:
    display = place.get("displayName")
    if isinstance(display, dict):
        return str(display.get("text") or "").strip()
    return ""


def _base_terms_for_place_signal(intent: str, poi_type: str) -> list[str]:
    signal = f"{intent} {poi_type}"
    if "train" in signal or "station" in signal:
        return ["改札", "乗り換え", "終電", "ホーム", "乗り場", "出口"]
    if "restaurant" in signal or "food" in signal:
        return ["予約", "お会計", "アレルギー", "卵", "小麦", "ナッツ"]
    if "hotel" in signal:
        return ["予約名", "荷物預かり", "チェックイン", "チェックアウト"]
    if "shrine" in signal or "temple" in signal:
        return ["御朱印", "お守り", "おみくじ", "鳥居"]
    return []


def _base_translation_terms_for_place_signal(intent: str, poi_type: str) -> list[str]:
    signal = f"{intent} {poi_type}"
    if "train" in signal or "station" in signal:
        return ["platform -> ホーム / 乗り場", "ticket gate -> 改札", "last train -> 終電"]
    if "restaurant" in signal or "food" in signal:
        return ["check/bill -> お会計", "no meat/fish broth -> 肉や魚の出汁もなし"]
    if "hotel" in signal:
        return ["leave luggage -> 荷物を預ける"]
    if "shrine" in signal or "temple" in signal:
        return ["goshuin -> 御朱印", "amulet -> お守り"]
    return []


def _dedupe(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        clean = value.strip()
        if clean and clean not in seen:
            seen.add(clean)
            result.append(clean)
    return result


def _adapt_phrase_with_groq(
    api_key: str,
    source_language: str,
    target_language: str,
    source_text: str,
    rewrite_context: dict[str, Any],
) -> dict[str, str]:
    import requests

    prompt = {
        "task": (
            "Rewrite a live English utterance into better English for downstream Japanese translation. "
            "Do not translate to Japanese or any other language. "
            "Preserve the user's intent, but adapt the English phrasing to the relationship, setting, politeness, and spoken context. "
            "Do not add new facts, explanations, emotions, apologies, gratitude, or inferred objects that were not said. "
            "Preserve explicit referents like 'this', 'that', 'here', and named items unless the recent dialogue makes the referent explicit. "
            "If the source English is already natural and clear, keep source_rewrite very close to the original; do not make it stiff or clinical. "
            "Write English that will lift cleanly into natural spoken Japanese: explicit action, clear object, simple sentence shape, and the right politeness cue. "
            "Preserve time relations exactly: 'until 3' means through 3, while 'by 3' means no later than 3. "
            "For 'soon' in the sense of 'before long / about time to', prefer English like 'soon' or 'before long'; do not rewrite it as 'right away' unless the source means immediately starting something. "
            "For everyday travel, prefer common English terms that map cleanly to Japanese, such as 'train platform' and 'ticket gate'. "
            "Only add minimal English politeness markers when they are required by the tone or setting, such as 'could', 'would', 'please', or 'I'd like'. "
            "For in-laws, elders, staff, strangers, doctors, and public counters, make requests and statements softly polite in English. "
            "For coworkers, use professional but ordinary English; do not make it sound like a legal notice or formal email. "
            "For employee/student/downward-clear speech, use clear polite English commands such as 'Please send...' rather than deferential phrasing. "
            "For restaurant payment, rewrite ambiguous 'check' as 'bill' so the later Japanese translation maps to お会計. "
            "For external-company speech, keep the speaker's side clear when needed, but do not make the English unnatural just to encode Japanese honorifics. "
            "Prefer short, spoken English over stiff literal phrasing. "
            "Return only the concise English rewrite. "
            "No explanations. Return JSON only."
        ),
        "source_language": source_language,
        "downstream_translation_language": target_language,
        "source_text": source_text,
            "rewrite_context": rewrite_context,
            "source_candidates": payload_list(rewrite_context.get("transcription_candidates"))[:4],
            "translation_candidates": payload_list(rewrite_context.get("translation_candidates"))[:4],
            "hard_constraints": [
            "source_rewrite must stay close to source_text unless the original is rude, awkward, or unclear.",
            "Do not infer unstated objects. Keep this/that/here/there unless recent_dialogue explicitly resolves it.",
            "Preserve who is doing the action: 'could we' means the speaker's side requests permission to do something; 'can you' asks the listener to do it.",
            "Do not output Japanese.",
            "Do not add apologies or thanks unless source_text says them or the situation absolutely requires a conventional attention-getter.",
            "Preserve until/by distinctions exactly.",
            "Use strong deference mainly for senior/client/external contexts, not ordinary coworkers.",
            "Do not make source_rewrite unnatural English solely to force a Japanese honorific or business formula.",
        ],
        "examples": [
            {
                "source_text": "I want the check.",
                "rewrite_context": {"tone": {"setting": "restaurant", "audience": "staff"}},
                "source_rewrite": "I'd like the bill, please.",
            },
            {
                "source_text": "I can't eat that because I have a shrimp allergy.",
                "rewrite_context": {"tone": {"audience": "Family / in-laws"}},
                "source_rewrite": "I can't eat that — I'm allergic to shrimp.",
            },
            {
                "source_text": "My stomach hurts a lot.",
                "rewrite_context": {"tone": {"setting": "clinic or hospital"}},
                "source_rewrite": "My stomach hurts a lot.",
            },
            {
                "source_text": "Could we leave our bags here until three?",
                "rewrite_context": {"tone": {"setting": "hotel front desk", "audience": "staff"}},
                "source_rewrite": "Could we leave our bags here until three?",
            },
            {
                "source_text": "Can you check this before the meeting?",
                "rewrite_context": {"tone": {"audience": "Coworker"}},
                "source_rewrite": "Can you check this before the meeting?",
            },
            {
                "source_text": "Our manager will send the document today.",
                "rewrite_context": {"tone": {"audience": "External company"}},
                "source_rewrite": "Our manager will send the document today.",
            },
            {
                "source_text": "Send me the file by five.",
                "rewrite_context": {"tone": {"audience": "Employee / student"}},
                "source_rewrite": "Please send me the file by five.",
            },
            {
                "source_text": "Could we move the meeting to Friday?",
                "rewrite_context": {"tone": {"audience": "Client / customer"}},
                "source_rewrite": "Could we reschedule the meeting to Friday?",
            },
            {
                "source_text": "I’m tired, so let’s go home soon.",
                "rewrite_context": {"tone": {"audience": "Spouse / partner"}},
                "source_rewrite": "I’m tired, so let’s go home soon.",
            },
            {
                "source_text": "Where is platform three?",
                "rewrite_context": {"tone": {"setting": "train station", "audience": "Older stranger"}},
                "source_rewrite": "Excuse me, where is train platform three?",
            },
        ],
        "output_schema": {
            "source_rewrite": "natural English rewrite of the intended utterance",
        },
    }
    try:
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": os.environ.get("GROQ_REWRITE_MODEL", "qwen/qwen3-32b"),
                "messages": [
                    {
                        "role": "system",
                        "content": "You adapt live English utterances into better English for downstream Japanese translation. Return only valid JSON with source_rewrite only.",
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
    data = response.json()
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Groq phrase adaptation response had no message content") from exc
    try:
        payload = json.loads(_strip_reasoning_block(str(text)))
    except json.JSONDecodeError as exc:
        raise RuntimeError("Groq phrase adaptation returned invalid JSON") from exc
    return {
        "source_rewrite": str(payload.get("source_rewrite") or "").strip(),
    }


def _translate_with_deepl(
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
        "source_lang": _deepl_language(source_language),
        "target_lang": _deepl_language(target_language),
        "model_type": "latency_optimized",
    }
    if context:
        body["context"] = context[:4000]
    formality = _deepl_formality(rewrite_context or {})
    if formality:
        body["formality"] = formality
    glossary_id = os.environ.get("DEEPL_GLOSSARY_ID")
    if glossary_id:
        body["glossary_id"] = glossary_id
    try:
        response = requests.post(
            _deepl_translate_url(api_key),
            headers={"Authorization": f"DeepL-Auth-Key {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=DEEPL_TRANSLATE_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"DeepL translation failed: {exc}") from exc
    if response.status_code != 200:
        raise RuntimeError(f"DeepL translation failed: {response.status_code} {response.text[:200]}")
    data = response.json()
    try:
        translated = data["translations"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("DeepL translation response had no translated text") from exc
    return str(translated or "").strip()


def _deepl_language(language: str) -> str:
    mapping = {"en": "EN", "ja": "JA"}
    return mapping.get(language.lower(), language.upper())


def _deepl_translate_url(api_key: str) -> str:
    configured = os.environ.get("DEEPL_API_URL")
    if configured:
        return configured
    return DEEPL_PRO_TRANSLATE_URL


def _deepl_formality(rewrite_context: dict[str, Any]) -> str:
    configured = os.environ.get("DEEPL_FORMALITY")
    if configured:
        return configured
    tone = rewrite_context.get("tone")
    register = ""
    audience = ""
    explicit = ""
    if isinstance(tone, dict):
        explicit = str(tone.get("deepl_formality") or "").strip()
        if explicit and explicit != "auto":
            return explicit
        register = str(tone.get("register") or "").strip()
        audience = str(tone.get("audience") or "").strip().lower()
    casual_registers = {"casual_intimate"}
    if register in casual_registers and not any(marker in audience for marker in ("in-law", "older", "staff", "client", "customer")):
        return "less"
    return "more"


def _deepl_context(rewrite_context: dict[str, Any], payload: dict[str, Any]) -> str:
    parts: list[str] = []
    draft_translation = str(payload.get("draft_translation") or "").strip()
    if draft_translation:
        parts.append(f"Previous Japanese draft: {draft_translation}")
    tone = rewrite_context.get("tone")
    if isinstance(tone, dict):
        setting = str(tone.get("setting") or "").strip()
        audience = str(tone.get("audience") or "").strip()
        if setting:
            parts.append(f"Setting: {setting}")
        if audience:
            parts.append(f"Audience: {audience}")
    recent = rewrite_context.get("recent_dialogue")
    if isinstance(recent, list):
        for item in recent[-10:]:
            if not isinstance(item, dict):
                continue
            english = str(item.get("english") or "").strip()
            japanese = str(item.get("japanese") or "").strip()
            if english or japanese:
                parts.append(f"Previous turn: {english} / {japanese}".strip())
    return "\n".join(parts)


def payload_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _strip_reasoning_block(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith("<think>") and "</think>" in stripped:
        return stripped.split("</think>", 1)[1].strip()
    return stripped


@app.get("/sessions")
def sessions() -> dict[str, Any]:
    return {"sessions": list_sessions()}


@app.get("/sessions/{session_name}")
def session_detail(session_name: str) -> dict[str, Any]:
    state = read_session_state(session_name)
    if not state:
        return {"session": state}

    safe_name = sanitize_session_name(session_name)
    session_dir = shared.REPO_ROOT / "output" / safe_name
    tokens = _latest_tokens_for_session(session_dir, state)
    source_languages = state.get("source_languages") or DEFAULT_SOURCE_LANGUAGES
    target_language = state.get("target_language") or DEFAULT_TARGET_LANGUAGE
    session = _session_from_tokens(safe_name, source_languages, target_language, tokens)
    latest_artifact = _latest_transcript_artifact(session_dir)
    enriched_state = dict(state)
    enriched_state["name"] = safe_name
    enriched_state["title"] = session_display_title(session_dir, state)
    summary = (session_dir / "session_summary.json")
    if summary.exists():
        try:
            enriched_state["summary"] = json.loads(summary.read_text(encoding="utf-8")).get("summary")
        except (OSError, json.JSONDecodeError):
            pass
    enriched_state["tokens"] = tokens
    enriched_state["duration_seconds"] = session_duration_seconds(tokens)
    if latest_artifact:
        enriched_state["artifact"] = latest_artifact
    return {
        "session": enriched_state,
        "phrases": build_phrases(session, []),
    }


@app.post("/sessions/{session_name}/rediarize")
def rediarize_session(session_name: str) -> dict[str, Any]:
    api_key = os.environ.get("SONIOX_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing SONIOX_API_KEY.")

    state = read_session_state(session_name)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found.")

    safe_name = sanitize_session_name(session_name)
    session_dir = shared.REPO_ROOT / "output" / safe_name
    audio_path = _latest_audio_path(session_dir)
    if audio_path is None:
        raise HTTPException(status_code=404, detail="No saved MP3/WAV audio found for this session.")

    source_languages = state.get("source_languages") or DEFAULT_SOURCE_LANGUAGES
    target_language = state.get("target_language") or DEFAULT_TARGET_LANGUAGE
    try:
        tokens = redo_diarization(
            api_key=api_key,
            audio_path=str(audio_path),
            source_languages=source_languages,
            target_language=target_language,
            context=state.get("context") or DEFAULT_CONTEXT,
        )
    except AsyncDiarizeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    rediarized_tokens = _apply_async_speakers(_latest_tokens_for_session(session_dir, state), tokens)
    out_json = session_dir / "rediarized.json"
    out_txt = session_dir / "rediarized.txt"
    speakers = sorted({str(t.get("speaker")) for t in rediarized_tokens if t.get("speaker") is not None})
    out_json.write_text(
        json.dumps({"tokens": rediarized_tokens, "speakers": speakers, "async_tokens": tokens}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    session = make_session(safe_name, source_languages, target_language)
    session.final_tokens = []
    session.speaker_profiles = {}
    for token in rediarized_tokens:
        if token.get("text"):
            token.setdefault("is_final", True)
            session.add_token(token)
    out_txt.write_text(session.render_plain_text(), encoding="utf-8")

    return {
        "session": safe_name,
        "path": str(out_json),
        "speakers": speakers,
        "speaker_count": len(speakers),
        "token_count": len(rediarized_tokens),
        "phrases": build_phrases(session, []),
    }


@app.post("/sessions/{session_name}/retranslate")
def retranslate_session(session_name: str) -> dict[str, Any]:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="Missing OPENAI_API_KEY.")

    state = read_session_state(session_name)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found.")

    safe_name = sanitize_session_name(session_name)
    session_dir = shared.REPO_ROOT / "output" / safe_name
    tokens = _latest_tokens_for_session(session_dir, state)
    samples = _translation_samples_from_tokens(tokens)
    if not samples:
        raise HTTPException(status_code=404, detail="No translation tokens found for this session.")

    try:
        revised = _revise_translation_samples(api_key, samples, state.get("context") or DEFAULT_CONTEXT)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    translated_tokens = _apply_revised_translations(tokens, samples, revised)
    source_languages = state.get("source_languages") or DEFAULT_SOURCE_LANGUAGES
    target_language = state.get("target_language") or DEFAULT_TARGET_LANGUAGE
    session = _session_from_tokens(safe_name, source_languages, target_language, translated_tokens)

    out_json = session_dir / "retranslated.json"
    out_txt = session_dir / "retranslated.txt"
    out_json.write_text(
        json.dumps({"tokens": translated_tokens, "method": "gpt4o_revision", "translation_count": len(revised)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    out_txt.write_text(session.render_plain_text(), encoding="utf-8")

    return {
        "session": safe_name,
        "path": str(out_json),
        "translation_count": len(revised),
        "token_count": len(translated_tokens),
        "phrases": build_phrases(session, []),
    }


@app.post("/sessions/{session_name}/speakers")
def review_speakers(session_name: str, payload: dict[str, Any]) -> dict[str, Any]:
    state = read_session_state(session_name)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found.")

    safe_name = sanitize_session_name(session_name)
    session_dir = shared.REPO_ROOT / "output" / safe_name
    tokens = _latest_tokens_for_session(session_dir, state)
    speaker_rows = payload.get("speakers")
    if not isinstance(speaker_rows, list):
        raise HTTPException(status_code=400, detail="Expected speakers list.")

    merge_map: dict[str, str] = {}
    label_by_speaker: dict[str, str] = {}
    fallback_labels: dict[str, str] = {}
    for row in speaker_rows:
        if not isinstance(row, dict):
            continue
        speaker = _speaker_key(row.get("speaker"))
        if not speaker:
            continue
        merge_into = _speaker_key(row.get("merge_into")) or speaker
        merge_map[speaker] = merge_into
        label = str(row.get("label") or "").strip()
        if label:
            fallback_labels.setdefault(merge_into, label)
            if merge_into == speaker:
                label_by_speaker[merge_into] = label

    label_by_speaker = {**fallback_labels, **label_by_speaker}
    reviewed_tokens = _apply_speaker_review(tokens, merge_map)
    source_languages = state.get("source_languages") or DEFAULT_SOURCE_LANGUAGES
    target_language = state.get("target_language") or DEFAULT_TARGET_LANGUAGE
    session = _session_from_tokens(safe_name, source_languages, target_language, reviewed_tokens)
    _apply_speaker_labels(session, label_by_speaker)

    out_json = session_dir / "speaker_review.json"
    out_txt = session_dir / "speaker_review.txt"
    out_json.write_text(
        json.dumps(
            {
                "tokens": reviewed_tokens,
                "speaker_merges": merge_map,
                "speaker_labels": label_by_speaker,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    out_txt.write_text(session.render_plain_text(), encoding="utf-8")

    speakers = sorted({str(t.get("speaker")) for t in reviewed_tokens if t.get("speaker") is not None})
    return {
        "session": safe_name,
        "path": str(out_json),
        "speakers": speakers,
        "speaker_count": len(speakers),
        "speaker_labels": label_by_speaker,
        "token_count": len(reviewed_tokens),
        "phrases": build_phrases(session, []),
    }


def _latest_audio_path(session_dir):
    candidates = list(session_dir.glob("segment_*.mp3")) + list(session_dir.glob("segment_*.wav"))
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime)


def _latest_tokens_for_session(session_dir, state: dict[str, Any]) -> list[dict[str, Any]]:
    for path, _kind in _improved_artifacts_by_recency(session_dir):
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data.get("tokens"), list):
            return data["tokens"]
    return list(state.get("tokens") or [])


def _latest_transcript_artifact(session_dir) -> dict[str, str] | None:
    artifacts = _improved_artifacts_by_recency(session_dir)
    if artifacts:
        path, kind = artifacts[0]
        return {"kind": kind, "path": str(path)}
    return None


def _improved_artifacts_by_recency(session_dir) -> list[tuple[Any, str]]:
    artifacts = []
    for name, kind in (
        ("speaker_review.json", "speaker_review"),
        ("retranslated.json", "retranslated"),
        ("rediarized.json", "rediarized"),
    ):
        path = session_dir / name
        if path.exists():
            artifacts.append((path, kind))
    return sorted(artifacts, key=lambda item: item[0].stat().st_mtime, reverse=True)


def _session_from_tokens(
    name: str,
    source_languages: list[str],
    target_language: str,
    tokens: list[dict[str, Any]],
):
    session = make_session(name, source_languages, target_language)
    session.final_tokens = []
    session.speaker_profiles = {}
    for token in tokens:
        if token.get("text"):
            token.setdefault("is_final", True)
            session.add_token(token)
    return session


def _apply_async_speakers(realtime_tokens: list[dict[str, Any]], async_tokens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not realtime_tokens:
        return async_tokens

    speaker_segments = [
        token
        for token in async_tokens
        if token.get("speaker") is not None
        and isinstance(token.get("start_ms"), (int, float))
        and isinstance(token.get("end_ms"), (int, float))
        and token.get("end_ms") > token.get("start_ms")
    ]
    if not speaker_segments:
        return realtime_tokens

    remapped = []
    for token in realtime_tokens:
        updated = dict(token)
        start = updated.get("start_ms")
        end = updated.get("end_ms")
        if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start:
            speaker = _best_speaker_for_window(float(start), float(end), speaker_segments)
            if speaker is not None:
                updated["speaker"] = speaker
        remapped.append(updated)
    return remapped


def _best_speaker_for_window(start_ms: float, end_ms: float, segments: list[dict[str, Any]]) -> str | None:
    overlaps: dict[str, float] = {}
    for segment in segments:
        overlap = min(end_ms, float(segment["end_ms"])) - max(start_ms, float(segment["start_ms"]))
        if overlap > 0:
            speaker = str(segment["speaker"])
            overlaps[speaker] = overlaps.get(speaker, 0.0) + overlap
    if not overlaps:
        midpoint = (start_ms + end_ms) / 2.0
        nearest = min(
            segments,
            key=lambda segment: min(abs(midpoint - float(segment["start_ms"])), abs(midpoint - float(segment["end_ms"]))),
        )
        return str(nearest["speaker"])
    return max(overlaps, key=overlaps.get)


def _translation_samples_from_tokens(tokens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    current_speaker = None
    current_source_lang = None
    texts: dict[str, str] = {}
    translation_indices: dict[str, list[int]] = {}
    seen_translation = False

    def clean(text: str) -> str:
        return text.replace("<end>", "").replace("<END>", "").strip()

    def flush() -> None:
        nonlocal texts, translation_indices, seen_translation
        if current_source_lang and clean(texts.get(current_source_lang, "")):
            for target_lang, indices in translation_indices.items():
                draft = clean(texts.get(target_lang, ""))
                if target_lang != current_source_lang and draft and indices:
                    samples.append({
                        "source_lang": current_source_lang,
                        "target_lang": target_lang,
                        "source_text": clean(texts[current_source_lang]),
                        "draft_text": draft,
                        "token_indices": indices,
                    })
        texts = {}
        translation_indices = {}
        seen_translation = False

    for idx, token in enumerate(tokens):
        token_text = token.get("text", "")
        if not token_text or token_text in {"<end>", "<END>"} or token.get("is_audio_event"):
            continue
        speaker = token.get("speaker")
        language = token.get("language")
        is_translation = token.get("translation_status") == "translation"
        source_lang = token.get("source_language")
        utterance_source = source_lang if is_translation else language

        if speaker is not None and speaker != current_speaker:
            flush()
            current_speaker = speaker
            current_source_lang = utterance_source

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
        if language:
            texts[language] = texts.get(language, "") + token_text
        if is_translation and language:
            translation_indices.setdefault(language, []).append(idx)
            seen_translation = True

    flush()
    return samples


def _revise_translation_samples(api_key: str, samples: list[dict[str, Any]], context: str) -> list[str]:
    import requests

    prompt = {
        "task": (
            "Improve bilingual live-caption translations for a natural Japanese/English conversation. "
            "Use each existing translation as a draft. Correct meaning errors and unnatural phrasing, "
            "preserve names, game terms, family context, food/place terms, and casual tone. "
            "Keep captions concise. Do not add explanations. Return JSON only."
        ),
        "context": context,
        "items": [
            {
                "source_language": sample["source_lang"],
                "target_language": sample["target_lang"],
                "source_text": sample["source_text"],
                "draft_translation": sample["draft_text"],
            }
            for sample in samples
        ],
        "output_schema": {"translations": ["..."]},
    }
    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": "gpt-4o",
            "input": json.dumps(prompt, ensure_ascii=False),
            "text": {"format": {"type": "json_object"}},
        },
        timeout=180,
    )
    if response.status_code != 200:
        raise RuntimeError(f"OpenAI translation revision failed: {response.status_code} {response.text[:200]}")
    data = response.json()
    text = data.get("output_text")
    if not isinstance(text, str):
        parts = []
        for item in data.get("output", []):
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"} and content.get("text"):
                    parts.append(content["text"])
        text = "".join(parts)
    payload = json.loads(text)
    translations = payload.get("translations")
    if not isinstance(translations, list):
        raise RuntimeError("OpenAI translation revision response had no translations array")
    if len(translations) != len(samples):
        raise RuntimeError(f"OpenAI returned {len(translations)} translations for {len(samples)} samples")
    out: list[str] = []
    for item in translations:
        if isinstance(item, dict):
            value = (
                item.get("translation")
                or item.get("revised_translation")
                or item.get("improved_translation")
                or item.get("target_translation")
                or item.get("target_text")
                or item.get("caption")
                or item.get("text")
                or item.get("en")
                or item.get("ja")
            )
            if not value:
                for key, candidate in item.items():
                    if key not in {"source_text", "source", "source_ja", "draft_translation"} and isinstance(candidate, str) and candidate.strip():
                        value = candidate
                        break
            out.append(str(value or ""))
        else:
            out.append(str(item))
    return out


def _apply_revised_translations(
    tokens: list[dict[str, Any]],
    samples: list[dict[str, Any]],
    translations: list[str],
) -> list[dict[str, Any]]:
    updated = [dict(token) for token in tokens]
    for sample, translation in zip(samples, translations, strict=True):
        replacement = translation.strip() or sample["draft_text"]
        indices = sample["token_indices"]
        for offset, idx in enumerate(indices):
            updated[idx]["text"] = replacement if offset == 0 else ""
            updated[idx]["translation_method"] = "gpt4o_revision"
    return updated


def _speaker_key(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _coerce_speaker(value: str) -> int | str:
    try:
        return int(value)
    except ValueError:
        return value


def _apply_speaker_review(tokens: list[dict[str, Any]], merge_map: dict[str, str]) -> list[dict[str, Any]]:
    reviewed = []
    for token in tokens:
        updated = dict(token)
        speaker = _speaker_key(updated.get("speaker"))
        if speaker and speaker in merge_map:
            updated["speaker"] = _coerce_speaker(merge_map[speaker])
        reviewed.append(updated)
    return reviewed


def _apply_speaker_labels(session, labels: dict[str, str]) -> None:
    for speaker, label in labels.items():
        if not label:
            continue
        profile = session.get_speaker_profile(_coerce_speaker(speaker))
        profile.display_name = label


@app.websocket("/ws/transcribe")
async def transcribe(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        first = await websocket.receive_text()
        start_message = json.loads(first)
    except (WebSocketDisconnect, json.JSONDecodeError):
        await websocket.close(code=1003)
        return

    async def receive_audio() -> bytes | str | None:
        try:
            message = await websocket.receive()
        except WebSocketDisconnect:
            return None
        if message.get("bytes") is not None:
            return message["bytes"]
        if message.get("text") is not None:
            return message["text"]
        return None

    async def send_event(event: dict[str, Any]) -> None:
        await websocket.send_json(event)

    await run_transcription_bridge(
        start_message=start_message,
        receive_audio=receive_audio,
        send_event=send_event,
    )
