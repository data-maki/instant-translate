"""Regression coverage for stop → save → titled history → reopen."""

import asyncio
import json
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.sessions import make_session, session_display_title, session_title_sample, summarize_finished_session
from app.soniox import _make_safe_send_event


def transcript_tokens():
    return [
        {"text": text, "language": language, "translation_status": kind,
         "speaker": "1", "is_final": True, "start_ms": 0, "end_ms": 1200}
        for text, language, kind in [
            ("Здрав", "bg", "original"),
            ("ей", "bg", "original"),
            (", как", "bg", "original"),
            (" си?", "bg", "original"),
            ("Hello, how are you?", "en", "translation"),
        ]
    ]


@pytest.mark.parametrize("disconnect", [False, True])
def test_final_tokens_after_stop_are_saved_listed_and_reopened(tmp_path, monkeypatch, disconnect):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    monkeypatch.setenv("SONIOX_API_KEY", "test-key")
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr("app.sessions.generate_session_summary", lambda *_: {"title": "Catching Up with a Friend", "summary": "Two friends exchange greetings."})
    monkeypatch.setattr("app.soniox.ProviderFanout.start", lambda _: None)

    class Soniox:
        async def __aenter__(self):
            self.flushed = asyncio.Event()
            return self

        async def __aexit__(self, *_):
            return False

        async def send(self, payload):
            if payload == "":
                self.flushed.set()

        async def __aiter__(self):
            await self.flushed.wait()
            # Final words and translations arrive AFTER end-of-audio.
            await asyncio.sleep(0.01)
            yield json.dumps({"tokens": transcript_tokens(), "finished": True})

    monkeypatch.setattr("app.soniox.websockets.connect", lambda *_args, **_kwargs: Soniox())
    with TestClient(app) as client:
        with client.websocket_connect("/ws/transcribe") as socket:
            socket.send_json({"session_name": "stop-regression", "source_languages": ["bg", "en"], "target_language": "en"})
            assert socket.receive_json()["type"] == "session"
            assert socket.receive_json() == {"type": "status", "status": "listening"}
            if disconnect:
                socket.close()
                # Keep the test portal alive while the disconnected handler
                # drains Soniox. Exiting the context cancels the handler.
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    state = json.loads((tmp_path / "output/stop-regression/session_state.json").read_text())
                    if len(state["tokens"]) == 5 and (tmp_path / "output/stop-regression/session_summary.json").exists():
                        break
                    time.sleep(0.01)
            else:
                socket.send_json({"type": "stop"})
                events = []
                while True:
                    event = socket.receive_json()
                    events.append(event)
                    if event == {"type": "status", "status": "stopped"}:
                        break
                saved = next(event for event in events if event["type"] == "saved")
                assert saved["title"] == "Catching Up with a Friend"
                assert saved["summary"] == "Two friends exchange greetings."
                assert saved["token_count"] == 5

        history = client.get("/sessions").json()["sessions"]
        assert history[0]["name"] == "stop-regression"
        assert history[0]["title"] == "Catching Up with a Friend"
        assert history[0]["token_count"] == 5
        detail = client.get("/sessions/stop-regression").json()
        assert detail["session"]["tokens"] == transcript_tokens_with_resolved_language()
        assert detail["session"]["title"] == "Catching Up with a Friend"
        assert detail["phrases"][0]["texts"] == {"bg": "Здравей, как си?", "en": "Hello, how are you?"}


def transcript_tokens_with_resolved_language():
    return [{**token, "resolved_language": token["language"]} for token in transcript_tokens()]


def test_failed_ai_title_still_has_title_after_reload(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr("app.sessions.generate_session_summary", lambda *_: None)
    session = make_session("untitled", ["bg", "en"], "en")
    session.user_id = "test-user"
    session.final_tokens = transcript_tokens()
    session.save_segment()
    assert summarize_finished_session(session) is None

    with TestClient(app) as client:
        assert client.get("/sessions").json()["sessions"][0]["title"] == "Здравей, как си?"
        assert client.get("/sessions/untitled").json()["session"]["title"] == "Здравей, как си?"


def test_manual_title_survives_resume_and_save(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("rename-resume", ["bg", "en"], "en")
    session.user_id = "test-user"
    session.final_tokens = transcript_tokens()
    session.save_segment()
    with TestClient(app) as client:
        assert client.patch("/sessions/rename-resume", json={"title": "Dinner in Sofia"}).status_code == 200
        resumed = make_session("rename-resume", ["bg", "en"], "en")
        resumed.save_segment()
        assert client.get("/sessions").json()["sessions"][0]["title"] == "Dinner in Sofia"
        assert client.get("/sessions/rename-resume").json()["session"]["title"] == "Dinner in Sofia"


def test_generated_summary_wins_over_fallback_title(tmp_path):
    (tmp_path / "session_summary.json").write_text(json.dumps({"title": "Meeting a friend", "summary": "Greetings."}))
    assert session_display_title(tmp_path, {"tokens": transcript_tokens()}) == "Meeting a friend"


def test_disconnected_browser_does_not_interrupt_finalization():
    async def check():
        async def disconnected_send(_event):
            raise WebSocketDisconnect(code=1006)

        send = _make_safe_send_event(disconnected_send)
        await send({"type": "transcript", "phrases": []})
        await send({"type": "saved"})

    asyncio.run(check())


def test_title_generation_uses_working_groq_provider_without_openai(tmp_path, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-groq")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_SESSION_TITLE_MODEL", raising=False)
    seen = []

    class Response:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": json.dumps({"title": "Planning a Sofia Trip", "summary": "Friends discuss visiting Sofia."})}}]}

    def post(url, **kwargs):
        assert url == "https://api.groq.com/openai/v1/chat/completions"
        assert kwargs["json"]["model"] == "openai/gpt-oss-20b"
        assert kwargs["headers"]["User-Agent"] == "OpenAI File Downloader, XaiImageApiFetch/1.0"
        seen.append(kwargs["json"]["messages"])
        return Response()

    monkeypatch.setattr("requests.post", post)
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("groq-topic", ["bg", "en"], "en")
    session.user_id = "test-user"
    session.final_tokens = transcript_tokens()
    session.save_segment()
    result = summarize_finished_session(session)
    assert result["title"] == "Planning a Sofia Trip"
    assert len(seen) == 1
    with TestClient(app) as client:
        assert client.get("/sessions").json()["sessions"][0]["title"] == result["title"]
        assert client.get("/sessions/groq-topic").json()["session"]["summary"] == result["summary"]
        regenerated = client.post("/sessions/groq-topic/auto-title?force=true")
        assert regenerated.status_code == 200
        assert regenerated.json()["title"] == "Planning a Sofia Trip"
        assert len(seen) == 2


def test_topic_sample_covers_the_conversation_not_just_opening():
    tokens = [{"text": "Hello there. " + "Small talk. " * 150, "language": "en", "speaker": "1"},
              {"text": "We decided to book train tickets to Sofia tomorrow.", "language": "en", "speaker": "2"}]
    sample = session_title_sample(tokens)
    assert "Hello there." in sample
    assert "train tickets to Sofia tomorrow" in sample


def test_resumed_conversation_regenerates_topic_when_transcript_grows(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    calls = []

    def generate(_name, tokens):
        calls.append(len(tokens))
        return {"title": "Greetings" if len(tokens) == 5 else "Travel Plans", "summary": "Conversation summary."}

    monkeypatch.setattr("app.sessions.generate_session_summary", generate)
    session = make_session("resume-topic", ["bg", "en"], "en")
    session.final_tokens = transcript_tokens()
    assert summarize_finished_session(session)["title"] == "Greetings"
    assert summarize_finished_session(session)["title"] == "Greetings"
    session.final_tokens.append({"text": " Let's plan a trip.", "language": "en"})
    assert summarize_finished_session(session)["title"] == "Travel Plans"
    assert calls == [5, 6]


def test_empty_recording_is_not_a_saved_new_chat(tmp_path, monkeypatch):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    session = make_session("empty-recording", ["bg", "en"], "en")
    session.user_id = "test-user"
    session.save_state()
    with TestClient(app) as client:
        assert client.get("/sessions").json()["sessions"] == []
