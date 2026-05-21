"""Backend authentication backed by BetterAuth (running in the Next.js app).

Design (per the user's "backend gatekeeps everything" requirement):

- Clients never claim an identity. They present credentials only.
  * Web sends BetterAuth's httpOnly session cookie automatically.
  * iOS sends `Authorization: Bearer <session-token>` (BetterAuth bearer plugin).

- This module's `require_user` dependency forwards whichever credentials the
  client presented to BetterAuth's `/api/auth/get-session` endpoint over a
  loopback HTTP call. BetterAuth is the only thing that resolves credentials
  to a user id; the FastAPI side never reads a client-supplied user id.

- A small TTL cache keeps round-trips off the hot path (sub-second sessions
  are validated locally without hitting Next.js again).

If `BETTER_AUTH_URL` isn't set we fall back to `http://localhost:3000`, which
matches the local-dev setup.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Optional

import httpx
from fastapi import Header, HTTPException, status


_DEFAULT_AUTH_BASE_URL = "http://localhost:3000"
_SESSION_TTL_SECONDS = 30.0


def auth_base_url() -> str:
    return (
        os.environ.get("BETTER_AUTH_URL")
        or os.environ.get("AUTH_BASE_URL")
        or _DEFAULT_AUTH_BASE_URL
    ).rstrip("/")


@dataclass(frozen=True)
class _CacheEntry:
    user_id: str
    expires_at: float


_session_cache: dict[str, _CacheEntry] = {}


def _cache_key(authorization: Optional[str], cookie: Optional[str]) -> str:
    # Bind both factors. A client that swaps either has to re-validate.
    return f"{authorization or ''}|{cookie or ''}"


async def _resolve_session(authorization: Optional[str], cookie: Optional[str]) -> Optional[str]:
    """Ask BetterAuth who this credential belongs to. Returns the user id, or
    None if BetterAuth declines (no session, expired, tampered token, …)."""
    if not authorization and not cookie:
        return None

    cache_key = _cache_key(authorization, cookie)
    now = time.monotonic()
    cached = _session_cache.get(cache_key)
    if cached and cached.expires_at > now:
        return cached.user_id

    headers = {"Accept": "application/json"}
    if authorization:
        headers["Authorization"] = authorization
    if cookie:
        headers["Cookie"] = cookie

    url = f"{auth_base_url()}/api/auth/get-session"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError:
        return None

    if response.status_code != 200:
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None

    user = payload.get("user")
    if not isinstance(user, dict):
        return None
    user_id = user.get("id")
    if not isinstance(user_id, str) or not user_id:
        return None

    _session_cache[cache_key] = _CacheEntry(
        user_id=user_id,
        expires_at=now + _SESSION_TTL_SECONDS,
    )
    return user_id


async def require_user(
    authorization: Optional[str] = Header(default=None),
    cookie: Optional[str] = Header(default=None),
) -> str:
    """FastAPI dependency: 401 unless BetterAuth verifies the credentials."""
    user_id = await _resolve_session(authorization, cookie)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


async def resolve_user_from_token(token: Optional[str]) -> Optional[str]:
    """Same as require_user but for credentials supplied outside HTTP headers
    (e.g. a WebSocket `?token=...` query parameter). Returns None instead of
    raising so callers can close the socket with a code of their choosing."""
    if not token:
        return None
    return await _resolve_session(f"Bearer {token}", None)
