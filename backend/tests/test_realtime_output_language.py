import asyncio
import json

import pytest

from app.sessions import make_session
from app.soniox import run_openai_realtime_overdub_bridge


@pytest.mark.parametrize("requested,stored,expected", [
    ("bg", None, "bg"),
    ("en", None, "en"),
    ("ja", None, "ja"),
    ("ja", "bg", "bg"),
])
def test_realtime_provider_receives_session_output_language(tmp_path, monkeypatch, requested, stored, expected):
    monkeypatch.setattr("app.shared.REPO_ROOT", tmp_path)
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    if stored:
        make_session("realtime-language", ["en", stored], stored).save_state()
    sent = []

    class Socket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        async def send(self, payload):
            sent.append(json.loads(payload))

        async def __aiter__(self):
            yield json.dumps({"type": "session.closed"})

    monkeypatch.setattr("app.provider_streams.websockets.connect", lambda *_args, **_kwargs: Socket())

    async def receive():
        return json.dumps({"type": "stop"})

    async def send(_event):
        pass

    asyncio.run(run_openai_realtime_overdub_bridge(
        start_message={"session_name": "realtime-language", "source_languages": ["en", requested], "target_language": requested},
        receive_audio=receive,
        send_event=send,
    ))
    update = next(event for event in sent if event["type"] == "session.update")
    assert update["session"]["audio"]["output"]["language"] == expected
