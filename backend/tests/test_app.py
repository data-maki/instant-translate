import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.languages import validate_language_pair
from app.main import app
from app.sessions import build_phrases, make_session, process_soniox_tokens


def test_health_and_language_defaults():
    client = TestClient(app)
    health = client.get("/health").json()
    assert health["status"] == "ok"
    assert health["defaults"]["source_languages"] == ["en", "ja"]
    assert health["audio"]["sample_rate"] == 16000

    languages = client.get("/languages").json()
    codes = {item["code"] for item in languages["languages"]}
    assert {"en", "ja"}.issubset(codes)


def test_validate_language_pair_defaults_to_two_way_english_japanese():
    sources, target = validate_language_pair([], "")
    assert sources == ["en", "ja"]
    assert target == "en"


def test_phrase_builder_groups_original_and_translation(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("pytest session", ["en", "ja"], "en")
    raw_tokens = [
        {
            "text": "こんにちは",
            "speaker": 1,
            "language": "ja",
            "is_final": True,
            "translation_status": "original",
        },
        {
            "text": "Hello",
            "speaker": 1,
            "language": "en",
            "source_language": "ja",
            "is_final": True,
            "translation_status": "translation",
        },
    ]

    final_tokens, partial_tokens = process_soniox_tokens(session, raw_tokens)
    phrases = build_phrases(session, partial_tokens)

    assert len(final_tokens) == 2
    assert partial_tokens == []
    assert phrases[0]["speaker_label"] == "Speaker A"
    assert phrases[0]["source_lang"] == "ja"
    assert phrases[0]["texts"] == {"ja": "こんにちは", "en": "Hello"}


def test_websocket_reports_missing_api_key(monkeypatch):
    monkeypatch.delenv("SONIOX_API_KEY", raising=False)
    client = TestClient(app)

    with client.websocket_connect("/ws/transcribe") as websocket:
        websocket.send_json({
            "type": "start",
            "session_name": "pytest websocket",
            "source_languages": ["ja", "en"],
            "target_language": "en",
        })
        event = websocket.receive_json()

    assert event["type"] == "error"
    assert "SONIOX_API_KEY" in event["message"]
