"""Speaker cleanup must keep bilingual turns together and preserve recordings."""

import copy
import json

from fastapi.testclient import TestClient

from app import main
from app.sessions import build_phrases, make_session, process_soniox_tokens
from app.soniox import get_soniox_config
from app.speakers import StreamSpeakerIds


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
    assert [token["speaker"] for token in result] == ["3", "4", "3", "4"]


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


def test_unattributed_speech_does_not_inherit_previous_person(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("unknown-voice", ["bg", "en"], "en")
    session.final_tokens = [source("1", 0, 1000), source(None, 1200, 2000, "Друг човек")]
    phrases = build_phrases(session)
    assert [p["speaker"] for p in phrases] == ["1", None]
    assert phrases[1]["speaker_label"] == "Unknown"
    assert phrases[0]["texts"]["bg"] == "Здравей"
    assert phrases[0]["time_ms"] == 0


def test_unknown_turns_remain_separate_across_finalization(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("unknown-turns", ["bg", "en"], "en")
    session.final_tokens = [source(None, 0, 1000), translation(None), {"text": "<end>"},
                            source(None, 1200, 2000), translation(None)]
    phrases = build_phrases(session)
    assert len(phrases) == 2
    assert all(p["speaker"] is None and set(p["texts"]) == {"bg", "en"} for p in phrases)


def test_numeric_and_string_ids_do_not_split_the_same_voice(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("same-id", ["bg", "en"], "en")
    session.final_tokens = [source(1, 0, 1000), translation("1")]
    assert len(build_phrases(session)) == 1


def test_resuming_does_not_claim_provider_id_is_the_previous_person(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("new-stream", ["bg", "en"], "en")
    session.final_tokens = [source("1", 0, 1000)]
    session.save_state()
    resumed = make_session("new-stream", ["bg", "en"], "en")
    namespace = StreamSpeakerIds(resumed.final_tokens, 2)
    raw = [{**source("1", 0, 1000), "is_final": True}, {**translation("1"), "is_final": True}]
    process_soniox_tokens(resumed, namespace.apply(raw))
    assert [t["speaker"] for t in resumed.final_tokens] == ["1", "2", "2"]
    assert [t["speaker"] for t in raw] == ["1", "1"]
    assert resumed.final_tokens[-1]["provider_speaker"] == "1"
    assert resumed.final_tokens[-1]["recording_segment"] == 2
    assert namespace.apply([source("2", 0, 500)])[0]["speaker"] == "3"
    assert namespace.apply([source("1", 0, 500)])[0]["speaker"] == "2"


def test_async_review_cannot_assign_a_distant_or_tied_voice():
    tokens = [source("1", 0, 1000), translation("1")]
    assert main._apply_async_speakers(tokens, [source("9", 10000, 11000)]) == tokens
    assert main._apply_async_speakers(tokens, [source("8", 0, 1000), source("9", 0, 1000)]) == tokens


def test_async_ids_cannot_merge_uncovered_live_turns_or_reuse_named_people():
    tokens = [source("1", 0, 1000), translation("1"), {"text": "<end>"},
              source("2", 2000, 3000), translation("2")]
    result = main._apply_async_speakers(tokens, [source("1", 2000, 3000)])
    assert [t.get("speaker") for t in result] == ["1", "1", None, "3", "3"]
    # A second review has its own provider IDs, too.
    repeated = main._apply_async_speakers(result, [source("1", 2000, 3000)])
    assert [t.get("speaker") for t in repeated] == ["1", "1", None, "4", "4"]


def test_independent_review_is_returned_and_saved_without_inventing_new_labels(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    monkeypatch.setenv("SONIOX_API_KEY", "test-key")
    session = make_session("review-evidence", ["bg", "en"], "en")
    session.segment_count = 1
    session.final_tokens = [source("1", 0, 1000), translation("1")]
    session.save_state()
    folder = tmp_path / "output/review-evidence"
    (folder / "segment_001.wav").write_bytes(b"fixture handled by the test audit")
    monkeypatch.setattr(main, "redo_diarization", lambda **_: [source("2", 0, 1000)])
    checked = []

    def audit(path, tokens):
        checked.extend(tokens)
        return {"status": "needs_review", "automatically_relabelled": False, "conflicts": [
            {"speaker": "2", "first": {"start_ms": 0}, "second": {"start_ms": 20000}}
        ]}

    monkeypatch.setattr(main, "audit_speakers", audit)
    response = TestClient(main.app).post("/sessions/review-evidence/rediarize")
    assert response.status_code == 200
    result = response.json()
    assert result["speaker_audit"]["status"] == "needs_review"
    assert "possible" in result["speaker_audit"]["summary"]
    assert [t["speaker"] for t in checked] == ["2", "2"]
    assert [p["speaker"] for p in result["phrases"]] == ["2"]
    saved = json.loads((folder / "rediarized.json").read_text())
    assert saved["speaker_audit"] == result["speaker_audit"]
    assert [t["text"] for t in saved["tokens"]] == ["Здравей", "Hello"]
