"""Test fixtures.

Two overrides run for every endpoint test so they don't need to stand up a
auth server or backfill user_id on every fixture:

1. `require_user` is replaced with a constant `TEST_USER_ID` — the auth
   round-trip never runs.
2. `session_belongs_to` is forced to True — ownership checks pass for any
   `user_id`, so existing tests that create sessions without a stored owner
   continue to work.

Tests that specifically exercise the auth gate or ownership semantics can
override these themselves via `app.dependency_overrides[...]` /
`monkeypatch.setattr(...)`.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import sessions as sessions_module
from app.auth import require_user
from app.main import app


TEST_USER_ID = "test-user"


@pytest.fixture(autouse=True)
def authenticated_test_user(monkeypatch):
    app.dependency_overrides[require_user] = lambda: TEST_USER_ID
    monkeypatch.setattr(sessions_module, "session_belongs_to", lambda *_args, **_kwargs: True)
    # The endpoints import session_belongs_to directly into main's namespace.
    monkeypatch.setattr("app.main.session_belongs_to", lambda *_args, **_kwargs: True, raising=False)
    # WebSocket auth doesn't go through Depends, so we have to stub the
    # async resolver functions directly.
    async def _stub_token(*_args, **_kwargs):
        return TEST_USER_ID

    monkeypatch.setattr("app.main.resolve_user_from_token", _stub_token)
    try:
        yield TEST_USER_ID
    finally:
        app.dependency_overrides.pop(require_user, None)
