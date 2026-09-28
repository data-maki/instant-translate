#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
project="$repo_root/ios/CottonohaApp/CottonohaApp.xcodeproj"
xcode_app="${XCODE_APP:-$(xcode-select -p)/../..}"
if [[ ! -x "$xcode_app/Contents/MacOS/Xcode" ]]; then
  echo "Select a full Xcode installation with xcode-select, or set XCODE_APP." >&2
  exit 1
fi

# Only write an override when explicitly supplied; the simulator defaults to localhost.
if [[ -n "${COTTONOHA_API_BASE_URL:-}" ]]; then
  export COTTONOHA_API_BASE_URL
  python3 - "$repo_root/ios/CottonohaApp/Local.xcconfig" <<'PYCONFIG'
import os, pathlib, sys
from urllib.parse import urlsplit
url = os.environ["COTTONOHA_API_BASE_URL"]
parsed = urlsplit(url)
if parsed.scheme not in ("http", "https") or not parsed.hostname or any(c.isspace() for c in url):
    raise SystemExit("COTTONOHA_API_BASE_URL must be an HTTP(S) URL.")
# Escape // so xcconfig does not interpret the URL as a comment.
pathlib.Path(sys.argv[1]).write_text("COTTONOHA_API_BASE_URL = " + url.replace("//", "/$()/") + "\n")
PYCONFIG
fi

if [[ "${1:-}" == "--configure-only" ]]; then
  exit 0
fi
open -a "$xcode_app" "$project"
