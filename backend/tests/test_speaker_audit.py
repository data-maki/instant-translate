from app.speaker_audit import audit_speakers, audit_summary, find_voice_conflicts, voice_windows


def sample(speaker, start, end):
    return {"speaker": speaker, "start_ms": start, "end_ms": end, "text": "spoken words"}


def test_independent_embeddings_flag_corroborated_merged_voices():
    samples = [sample("1", i * 4000, i * 4000 + 2000) for i in range(4)]
    vectors = [[1, 0], [.99, .01], [0, 1], [.01, .99]]
    conflicts = find_voice_conflicts(samples, vectors)
    assert len(conflicts) == 1
    assert conflicts[0]["speaker"] == "1"
    assert conflicts[0]["kind"] == "possible_merged_voices"
    assert len(conflicts[0]["support"]) == 2
    assert "possible" in audit_summary({"conflicts": conflicts})


def test_one_noisy_sample_cannot_invent_another_person():
    samples = [sample("1", i * 4000, i * 4000 + 2000) for i in range(4)]
    assert find_voice_conflicts(samples, [[1, 0], [1, .01], [1, -.01], [0, 1]]) == []
    assert find_voice_conflicts(samples, [[0, 0]] * 4) == []


def test_language_change_is_not_evidence_of_a_person_change():
    samples = [{**sample("1", i * 4000, i * 4000 + 2000), "language": "bg" if i % 2 else "en"} for i in range(4)]
    assert find_voice_conflicts(samples, [[1, .02], [1, 0], [1, -.01], [1, .01]]) == []


def test_audit_ignores_translations_unknown_and_overlapping_voice_windows():
    tokens = [sample("1", 0, 2000), {**sample("1", 0, 2000), "translation_status": "translation"},
              sample(None, 3000, 5000), sample("1", 6000, 8000), sample("2", 6500, 8500)]
    assert voice_windows(tokens) == [{"speaker": "1", "start_ms": 0, "end_ms": 2000}]


def test_short_audio_and_missing_model_are_unverified(tmp_path, monkeypatch):
    missing = tmp_path / "missing.onnx"
    monkeypatch.setenv("SPEAKER_EMBEDDING_MODEL", str(missing))
    report = audit_speakers(tmp_path / "audio.wav", [])
    assert report["status"] == "unavailable"
    assert "unverified" in audit_summary(report)
    missing.write_bytes(b"not loaded for an insufficient-audio result")
    report = audit_speakers(tmp_path / "audio.wav", [sample("1", 0, 1000)])
    assert report["status"] == "insufficient_audio"
    assert "unverified" in audit_summary(report)


def test_no_conflicts_does_not_claim_verified_identities():
    assert "does not verify" in audit_summary({"status": "no_conflicts_detected", "sample_count": 48})
