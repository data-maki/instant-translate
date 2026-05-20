"""One-shot: stamp every existing session_state.json with a user_id.

Used to migrate the pre-auth sessions directory to the user-scoped model.
Run from the repo root:
    python -m backend.scripts.backfill_session_user_id WOKGSTnUrOW1mS6UIaN7theQ6Y0tOIFl
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def backfill(user_id: str, output_dir: Path) -> dict[str, int]:
    counts = {"updated": 0, "already": 0, "skipped": 0}
    for session_dir in output_dir.iterdir():
        if not session_dir.is_dir():
            continue
        state_path = session_dir / "session_state.json"
        if not state_path.exists():
            counts["skipped"] += 1
            continue
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            counts["skipped"] += 1
            continue
        if not isinstance(state, dict):
            counts["skipped"] += 1
            continue
        if state.get("user_id") == user_id:
            counts["already"] += 1
            continue
        state["user_id"] = user_id
        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        counts["updated"] += 1
    return counts


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: backfill_session_user_id.py <user_id> [output_dir]", file=sys.stderr)
        return 2
    user_id = sys.argv[1].strip()
    if not user_id:
        print("user_id is required", file=sys.stderr)
        return 2
    repo_root = Path(__file__).resolve().parents[2]
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else repo_root / "output"
    if not output_dir.exists():
        print(f"output dir not found: {output_dir}", file=sys.stderr)
        return 1
    counts = backfill(user_id, output_dir)
    print(f"updated={counts['updated']} already={counts['already']} skipped={counts['skipped']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
