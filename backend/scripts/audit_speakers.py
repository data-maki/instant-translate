"""Read-only audit: python backend/scripts/audit_speakers.py <session-directory>."""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.speaker_audit import audit_speakers


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    state = json.loads((args.session / "session_state.json").read_text())
    if state.get("segment_count", 0) != 1:
        parser.error("Audit a single saved recording; resumed audio has separate time origins.")
    audio = sorted(args.session.glob("*.wav")) or sorted(args.session.glob("*.mp3"))
    if not audio:
        parser.error("No saved audio in this session.")
    report = audit_speakers(audio[-1], state.get("tokens", []))
    result = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(result + "\n")
    print(result)


if __name__ == "__main__":
    main()
