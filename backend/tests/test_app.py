import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main as app_main
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


def test_session_state_persists_context_and_speaker_plan(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("speaker plan", ["ja", "en"], "en")
    session.context = "Family dinner about travel."
    session.expected_speaker_count = 6
    session.expected_speaker_names = ["Akiko", "John"]
    session.save_state()

    state = json.loads((tmp_path / "output" / "speaker-plan" / "session_state.json").read_text())
    assert state["context"] == "Family dinner about travel."
    assert state["expected_speaker_count"] == 6
    assert state["expected_speaker_names"] == ["Akiko", "John"]

    resumed = make_session("speaker plan", ["ja", "en"], "en")
    assert resumed.expected_speaker_count == 6
    assert resumed.expected_speaker_names == ["Akiko", "John"]


def test_translation_update_stats_are_persisted(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("translation metrics", ["ja", "en"], "en")
    process_soniox_tokens(session, [
        {"text": "こ", "speaker": 1, "language": "ja", "is_final": False, "translation_status": "original"},
        {
            "text": "Hello",
            "speaker": 1,
            "language": "en",
            "source_language": "ja",
            "is_final": False,
            "translation_status": "translation",
        },
    ])
    process_soniox_tokens(session, [
        {"text": "こんにちは", "speaker": 1, "language": "ja", "is_final": True, "translation_status": "original"},
        {
            "text": "Hello",
            "speaker": 1,
            "language": "en",
            "source_language": "ja",
            "is_final": True,
            "translation_status": "translation",
        },
        {"text": "<end>", "is_final": True, "translation_status": "none"},
    ])
    session.save_state()

    state = json.loads((tmp_path / "output" / "translation-metrics" / "session_state.json").read_text())
    stats = state["translation_update_stats"]
    assert stats["translation_token_events"] == 2
    assert stats["nonfinal_translation_token_events"] == 1
    assert stats["final_translation_token_events"] == 1
    assert stats["translation_token_events_by_direction"] == {"ja->en": 2}


def test_rediarize_endpoint_remaps_speakers_without_changing_text(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    monkeypatch.setenv("SONIOX_API_KEY", "test-key")
    session = make_session("saved meeting", ["ja", "en"], "en")
    session.final_tokens = [
        {
            "text": "こんにちは",
            "speaker": 1,
            "language": "ja",
            "translation_status": "original",
            "is_final": True,
            "start_ms": 0,
            "end_ms": 1000,
        },
        {
            "text": "Hello",
            "speaker": 1,
            "language": "en",
            "source_language": "ja",
            "translation_status": "translation",
            "is_final": True,
            "start_ms": 0,
            "end_ms": 1000,
        },
    ]
    session.save_state()
    (tmp_path / "output" / "saved-meeting" / "segment_001.mp3").write_bytes(b"audio")

    def fake_redo_diarization(**_kwargs):
        return [{"text": "x", "speaker": 7, "start_ms": 0, "end_ms": 1200}]

    monkeypatch.setattr(app_main, "redo_diarization", fake_redo_diarization)
    response = TestClient(app).post("/sessions/saved-meeting/rediarize")

    assert response.status_code == 200
    payload = response.json()
    assert payload["speaker_count"] == 1
    assert payload["speakers"] == ["7"]
    assert payload["phrases"][0]["texts"]["ja"] == "こんにちは"


def test_retranslate_endpoint_replaces_translation_tokens(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    session = make_session("translation session", ["ja", "en"], "en")
    session.final_tokens = [
        {
            "text": "おいしい",
            "speaker": 1,
            "language": "ja",
            "translation_status": "original",
            "is_final": True,
        },
        {
            "text": "It is good",
            "speaker": 1,
            "language": "en",
            "source_language": "ja",
            "translation_status": "translation",
            "is_final": True,
        },
    ]
    session.save_state()

    monkeypatch.setattr(app_main, "_revise_translation_samples", lambda *_args: ["This is delicious."])
    response = TestClient(app).post("/sessions/translation-session/retranslate")

    assert response.status_code == 200
    payload = response.json()
    assert payload["translation_count"] == 1
    assert payload["phrases"][0]["texts"]["en"] == "This is delicious."


def test_session_detail_prefers_latest_improved_artifact(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("artifact session", ["ja", "en"], "en")
    session.final_tokens = [{"text": "old", "speaker": 1, "language": "en", "is_final": True}]
    session.save_state()
    session_dir = tmp_path / "output" / "artifact-session"
    (session_dir / "retranslated.json").write_text(
        json.dumps({"tokens": [{"text": "new", "speaker": 2, "language": "en", "is_final": True}]}),
        encoding="utf-8",
    )

    response = TestClient(app).get("/sessions/artifact-session")

    assert response.status_code == 200
    payload = response.json()
    assert payload["session"]["artifact"]["kind"] == "retranslated"
    assert payload["phrases"][0]["texts"]["en"] == "new"


def test_speaker_review_endpoint_merges_and_labels_speakers(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("review session", ["ja", "en"], "en")
    session.final_tokens = [
        {"text": "A", "speaker": 1, "language": "en", "translation_status": "original", "is_final": True},
        {"text": "B", "speaker": 2, "language": "en", "translation_status": "original", "is_final": True},
    ]
    session.save_state()

    response = TestClient(app).post(
        "/sessions/review-session/speakers",
        json={
            "speakers": [
                {"speaker": "1", "merge_into": "1", "label": "Jan"},
                {"speaker": "2", "merge_into": "1", "label": ""},
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["speaker_count"] == 1
    assert payload["speaker_labels"] == {"1": "Jan"}
    assert {phrase["speaker_label"] for phrase in payload["phrases"]} == {"Jan"}

    reviewed = json.loads((tmp_path / "output" / "review-session" / "speaker_review.json").read_text())
    assert {token["speaker"] for token in reviewed["tokens"]} == {1}


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
