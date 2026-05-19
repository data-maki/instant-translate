import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main as app_main
from app.languages import validate_language_pair
from app.main import app
from app.soniox import get_soniox_config, normalize_start_context
from app.sessions import build_phrases, list_sessions, make_session, process_soniox_tokens


def test_health_and_language_defaults():
    client = TestClient(app)
    health = client.get("/health").json()
    assert health["status"] == "ok"
    assert health["defaults"]["source_languages"] == ["en", "ja"]
    assert health["audio"]["sample_rate"] == 16000

    languages = client.get("/languages").json()
    codes = {item["code"] for item in languages["languages"]}
    assert {"en", "ja"}.issubset(codes)


def test_places_context_requires_google_maps_api_key(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_API_KEY", raising=False)
    monkeypatch.setenv("GOOGLE_MAPS_SERVER_KEY", "ignored")

    response = TestClient(app).post("/context/places", json={"lat": 35.6895, "lng": 139.6917})

    assert response.status_code == 400
    assert "GOOGLE_MAPS_API_KEY" in response.json()["detail"]


def test_places_context_enriches_nearby_station_terms(monkeypatch):
    monkeypatch.setenv("GOOGLE_MAPS_API_KEY", "test-google-key")

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self):
            return json.dumps({
                "places": [
                    {
                        "displayName": {"text": "Shinjuku Station"},
                        "formattedAddress": "3 Chome Shinjuku, Tokyo",
                        "primaryType": "train_station",
                    }
                ]
            }).encode("utf-8")

    def fake_urlopen(request, timeout):
        assert timeout == 8
        assert request.get_header("X-goog-api-key") == "test-google-key"
        return FakeResponse()

    monkeypatch.setattr(app_main.urllib.request, "urlopen", fake_urlopen)

    response = TestClient(app).post(
        "/context/places",
        json={"lat": 35.6895, "lng": 139.6917, "intent": "train", "poi_type": "train station"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["places"] == ["Shinjuku Station"]
    assert "Shinjuku Station" in payload["terms"]
    assert "改札" in payload["terms"]
    assert "ticket gate -> 改札" in payload["translation_terms"]


def test_soniox_config_accepts_structured_context():
    context = {
        "general": [{"key": "setting", "value": "train station"}],
        "terms": ["Shinjuku Station", "改札"],
        "text": "Short trip note.",
        "translation_terms": [{"source": "ticket gate", "target": "改札"}],
    }

    config = get_soniox_config("test-key", ["ja", "en"], context)

    assert config["context"] == context


def test_start_context_normalizes_structured_context_without_aliases(monkeypatch):
    monkeypatch.delenv("GOOGLE_MAPS_SERVER_KEY", raising=False)
    context = normalize_start_context({
        "general": [{"key": "setting", "value": "restaurant"}, {"key": "", "value": "ignored"}],
        "terms": ["お会計", ""],
        "translation_terms": [{"source": "check", "target": "お会計"}, {"source": "", "target": "ignored"}],
    })

    assert context == {
        "general": [{"key": "setting", "value": "restaurant"}],
        "terms": ["お会計"],
        "translation_terms": [{"source": "check", "target": "お会計"}],
    }


def test_rewrite_context_requires_groq_key(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    response = TestClient(app).post(
        "/context/rewrite",
        json={
            "source_language": "en",
            "target_language": "ja",
            "source_text": "I want the check.",
        },
    )

    assert response.status_code == 400
    assert "GROQ_API_KEY" in response.json()["detail"]


def test_rewrite_context_uses_groq_qwen_with_reasoning_none(monkeypatch):
    import requests

    monkeypatch.setenv("GROQ_API_KEY", "test-groq-key")
    monkeypatch.setenv("DEEPL_API_KEY", "test-deepl-key")
    monkeypatch.setenv("DEEPL_GLOSSARY_ID", "glossary-123")
    monkeypatch.delenv("DEEPL_FORMALITY", raising=False)
    captured = {}

    class FakeGroqResponse:
        status_code = 200
        text = ""

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({
                                "source_rewrite": "Could we get the bill, please?",
                                "target_rewrite": "これは無視されるべきです。",
                            })
                        }
                    }
                ]
            }

    class FakeDeepLResponse:
        status_code = 200
        text = ""

        def json(self):
            return {"translations": [{"text": "お会計をお願いします。"}]}

    def fake_post(url, headers, json, timeout):
        if "groq.com" in url:
            captured["groq_url"] = url
            captured["groq_headers"] = headers
            captured["groq_json"] = json
            captured["groq_timeout"] = timeout
            return FakeGroqResponse()
        captured["deepl_url"] = url
        captured["deepl_headers"] = headers
        captured["deepl_json"] = json
        captured["deepl_timeout"] = timeout
        return FakeDeepLResponse()

    monkeypatch.setattr(requests, "post", fake_post)

    response = TestClient(app).post(
        "/context/rewrite",
        json={
            "source_language": "en",
            "target_language": "ja",
            "source_text": "I want the check.",
            "draft_translation": "お会計が欲しいです。",
            "rewrite_context": {"tone": {"audience": "restaurant staff", "register": "polite_neutral"}, "recent_dialogue": []},
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "source_rewrite": "Could we get the bill, please?",
        "target_translation": "お会計をお願いします。",
    }
    assert captured["groq_url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert captured["groq_json"]["model"] == "qwen/qwen3-32b"
    assert captured["groq_json"]["reasoning_effort"] == "none"
    assert captured["groq_json"]["response_format"] == {"type": "json_object"}
    assert captured["groq_timeout"] == app_main.GROQ_REWRITE_TIMEOUT_SECONDS
    prompt = json.loads(captured["groq_json"]["messages"][1]["content"])
    assert "draft_translation" not in prompt
    assert "target_rewrite" not in json.dumps(prompt, ensure_ascii=False)
    assert "Do not translate to Japanese" in prompt["task"]
    assert any("Do not output Japanese" in item for item in prompt["hard_constraints"])
    assert captured["deepl_url"] == app_main.DEEPL_PRO_TRANSLATE_URL
    assert captured["deepl_headers"]["Authorization"] == "DeepL-Auth-Key test-deepl-key"
    assert captured["deepl_timeout"] == app_main.DEEPL_TRANSLATE_TIMEOUT_SECONDS
    assert captured["deepl_json"]["text"] == ["Could we get the bill, please?"]
    assert captured["deepl_json"]["source_lang"] == "EN"
    assert captured["deepl_json"]["target_lang"] == "JA"
    assert captured["deepl_json"]["model_type"] == "latency_optimized"
    assert captured["deepl_json"]["formality"] == "more"
    assert captured["deepl_json"]["glossary_id"] == "glossary-123"
    assert "Previous Japanese draft" in captured["deepl_json"]["context"]


def test_deepl_uses_pro_endpoint_by_default(monkeypatch):
    monkeypatch.delenv("DEEPL_API_URL", raising=False)
    assert app_main._deepl_translate_url() == app_main.DEEPL_PRO_TRANSLATE_URL


def test_deepl_formality_maps_registers(monkeypatch):
    monkeypatch.delenv("DEEPL_FORMALITY", raising=False)
    assert app_main._deepl_formality({"tone": {"deepl_formality": "less", "register": "polite_neutral"}}) == "less"
    assert app_main._deepl_formality({"tone": {"register": "casual_intimate", "audience": "Close friend"}}) == "less"
    assert app_main._deepl_formality({"tone": {"register": "casual_intimate", "audience": "Family / in-laws"}}) == "more"
    assert app_main._deepl_formality({"tone": {"register": "external_formal_business", "audience": "Client / customer"}}) == "more"


def test_translate_context_runs_deepl_without_qwen(monkeypatch):
    import requests

    monkeypatch.setenv("DEEPL_API_KEY", "test-deepl-key")
    monkeypatch.delenv("DEEPL_GLOSSARY_ID", raising=False)
    captured = {}

    class FakeDeepLResponse:
        status_code = 200
        text = ""

        def json(self):
            return {"translations": [{"text": "お会計をお願いします。"}]}

    def fake_post(url, headers, json, timeout):
        captured["url"] = url
        captured["json"] = json
        return FakeDeepLResponse()

    monkeypatch.setattr(requests, "post", fake_post)

    response = TestClient(app).post(
        "/context/translate",
        json={
            "source_language": "en",
            "target_language": "ja",
            "source_text": "I'd like the bill, please.",
            "rewrite_context": {"tone": {"deepl_formality": "more"}},
        },
    )

    assert response.status_code == 200
    assert response.json() == {"target_translation": "お会計をお願いします。"}
    assert captured["url"] == app_main.DEEPL_PRO_TRANSLATE_URL
    assert captured["json"]["text"] == ["I'd like the bill, please."]
    assert captured["json"]["formality"] == "more"


def test_name_katakana_requires_openai_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = TestClient(app).post("/context/name-katakana", json={"first_name": "John", "last_name": "Smith"})
    assert response.status_code == 400
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_name_katakana_requires_non_empty_name(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    response = TestClient(app).post("/context/name-katakana", json={"first_name": "", "last_name": "  "})
    assert response.status_code == 400


def test_name_katakana_returns_options(monkeypatch):
    import requests

    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    class FakeOpenAIResponse:
        status_code = 200
        text = ""

        def json(self):
            payload = {
                "options": [
                    {
                        "first_katakana": "ジョン",
                        "last_katakana": "スミス",
                        "first_reading_en": "John",
                        "last_reading_en": "Smith",
                    },
                    {
                        "first_katakana": "ジョン",
                        "last_katakana": "スミス",
                        "first_reading_en": "Jon",
                        "last_reading_en": "Smith",
                    },
                    {
                        "first_katakana": "ジョン",
                        "last_katakana": "スミス",
                        "first_reading_en": "John",
                        "last_reading_en": "Smith",
                    },
                ]
            }
            return {"output_text": json.dumps(payload)}

    monkeypatch.setattr(requests, "post", lambda *args, **kwargs: FakeOpenAIResponse())

    response = TestClient(app).post(
        "/context/name-katakana",
        json={"first_name": "John", "last_name": "Smith"},
    )
    assert response.status_code == 200
    data = response.json()["options"]
    assert len(data) == 2
    readings = {(row["first_reading_en"], row["last_reading_en"]) for row in data}
    assert ("John", "Smith") in readings
    assert ("Jon", "Smith") in readings


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


def test_list_sessions_sorts_by_updated_newest_first(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    output = tmp_path / "output"
    output.mkdir()
    for name, updated in [
        ("old", "2026-05-12T10:00:00"),
        ("new", "2026-05-18T10:00:00"),
        ("middle", "2026-05-15T10:00:00"),
    ]:
        session_dir = output / name
        session_dir.mkdir()
        (session_dir / "session_state.json").write_text(
            json.dumps({"updated": updated, "tokens": [], "source_languages": ["en", "ja"], "target_language": "en"}),
            encoding="utf-8",
        )
    (output / "legacy-without-state").mkdir()

    assert [session["name"] for session in list_sessions()] == ["new", "middle", "old"]


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
