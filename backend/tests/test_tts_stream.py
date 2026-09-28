"""Streaming must deliver the first audio before the provider finishes."""
import asyncio

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import main


@pytest.mark.parametrize("language,model", [("bg", "eleven_flash_v2_5"), ("ja", "eleven_flash_v2_5"), ("he", "eleven_v3")])
def test_stream_model_and_first_chunk(monkeypatch, language, model):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")

    async def run():
        tail_requested = False
        closed = False

        class Audio(httpx.AsyncByteStream):
            async def __aiter__(self):
                nonlocal tail_requested
                yield b"\x01\x00"
                tail_requested = True
                yield b"\x02\x00"

            async def aclose(self):
                nonlocal closed
                closed = True

        def provider(request):
            import json
            body = json.loads(request.content)
            assert body["model_id"] == model
            assert body["language_code"] == language
            assert request.url.params["output_format"] == "pcm_24000"
            assert request.headers["xi-api-key"] == "test-key"
            return httpx.Response(200, stream=Audio())

        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            monkeypatch.setattr(main.app.state, "tts_client", client, raising=False)
            result = await main.tts_stream({"text": "Hello", "target_language": language}, "user")
            assert result.headers["cache-control"] == "no-store"
            iterator = result.body_iterator
            assert await anext(iterator) == b"\x01\x00"
            assert not tail_requested  # No response.content/read/full-file buffering.
            await iterator.aclose()  # Simulate listener leaving mid-sentence.
            assert closed

    asyncio.run(run())


def test_failed_fast_voice_falls_back_before_sending_audio(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")

    async def run():
        calls = []

        def provider(request):
            import json
            model = json.loads(request.content)["model_id"]
            calls.append(model)
            return httpx.Response(422 if len(calls) == 1 else 200, content=b"\x00\x00")

        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as client:
            monkeypatch.setattr(main.app.state, "tts_client", client, raising=False)
            response = await main.tts_stream({"text": "Hello", "target_language": "bg"}, "user")
            assert b"".join([chunk async for chunk in response.body_iterator]) == b"\x00\x00"
            assert calls == ["eleven_flash_v2_5", "eleven_v3"]
            assert response.headers["x-tts-model"] == "eleven_v3"

    asyncio.run(run())


def test_stream_rejects_empty_input_without_contacting_provider(monkeypatch):
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    assert TestClient(main.app).post("/tts/stream", json={"text": " "}).status_code == 400


def test_stream_requires_authentication(monkeypatch):
    def no_user():
        raise HTTPException(status_code=401)

    main.app.dependency_overrides[main.require_user] = no_user
    assert TestClient(main.app).post("/tts/stream", json={"text": "Hello"}).status_code == 401


def test_lifespan_reuses_client_and_sets_user_agent():
    with TestClient(main.app):
        client = main.app.state.tts_client
        assert client.headers["user-agent"] == "OpenAI File Downloader, XaiImageApiFetch/1.0"
        assert not client.is_closed
    assert client.is_closed
