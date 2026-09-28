"""Speaker cleanup must keep bilingual turns together and preserve recordings."""

import copy

from fastapi.testclient import TestClient

from app import main
from app.sessions import make_session
from app.soniox import get_soniox_config


def source(speaker, start, end, text="Здравей"):
    return {"speaker": speaker, "start_ms": start, "end_ms": end, "text": text,
            "language": "bg", "translation_status": "original"}


def translation(speaker, text="Hello"):
    # This is Soniox's real schema: translated tokens have no audio timestamps.
    return {"speaker": speaker, "text": text, "language": "en",
            "source_language": "bg", "translation_status": "translation"}


def test_split_merged_voices_keeps_each_translation_with_its_source():
    tokens = [source("1", 0, 1000), translation("1"),
              {"text": "<end>"}, source("1", 2000, 3000), translation("1")]
    original = copy.deepcopy(tokens)
    result = main._apply_async_speakers(tokens, [source("2", 0, 1000), source("3", 2000, 3000)])
    assert [token.get("speaker") for token in result] == ["2", "2", None, "3", "3"]
    assert tokens == original
    assert [token["text"] for token in result] == [token["text"] for token in tokens]


def test_delayed_translations_use_their_own_source_speaker():
    tokens = [source("1", 0, 1000), source("2", 1100, 2100),
              translation("1"), translation("2")]
    result = main._apply_async_speakers(tokens, [source("4", 0, 1000), source("5", 1100, 2100)])
    assert [token["speaker"] for token in result] == ["4", "5", "4", "5"]


def test_translation_uses_whole_utterance_not_last_word():
    tokens = [source("1", 0, 1500), source("1", 1500, 1600), translation("1")]
    result = main._apply_async_speakers(tokens, [source("2", 0, 1500), source("3", 1500, 1600)])
    assert [token["speaker"] for token in result] == ["2", "3", "2"]


def test_missing_async_speakers_preserves_original_tokens():
    tokens = [source("1", 0, 1000), translation("1")]
    assert main._apply_async_speakers(tokens, [{"text": "unknown"}]) == tokens


def test_resumed_audio_cannot_relabel_previous_recordings(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    monkeypatch.setenv("SONIOX_API_KEY", "test-key")
    session = make_session("resumed", ["bg", "en"], "en")
    session.segment_count = 2
    session.final_tokens = [source("1", 0, 1000)]
    session.save_state()
    (tmp_path / "output/resumed/segment_002.mp3").write_bytes(b"audio")
    monkeypatch.setattr(main, "redo_diarization", lambda **_: (_ for _ in ()).throw(AssertionError("must not upload mismatched audio")))
    response = TestClient(main.app).post("/sessions/resumed/rediarize")
    assert response.status_code == 409
    assert not (tmp_path / "output/resumed/rediarized.json").exists()


def test_live_diarization_keeps_context_until_model_finalizes():
    config = get_soniox_config("key", ["bg", "en"])
    assert config["enable_speaker_diarization"] is True
    assert config["enable_endpoint_detection"] is False
    assert config["language_hints"] == ["bg", "en"]
