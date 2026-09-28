"""Measure TTS transport latency with synthetic Bulgarian speech (no microphone)."""
import argparse
import json
import os
import statistics
import time

import requests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--legacy", action="store_true", help="Measure the full-file /tts/speak endpoint")
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    texts = ["Здравей, как си?", "Може ли да ми кажеш в колко часа тръгва влакът за София?", "Благодаря, ще се видим утре."]
    values = []
    with requests.Session() as client:
        client.headers["User-Agent"] = "OpenAI File Downloader, XaiImageApiFetch/1.0"
        if token := os.environ.get("COTTONOHA_AUTH_TOKEN"):
            client.headers["Authorization"] = f"Bearer {token}"
        for i in range(args.runs):
            start = time.perf_counter()
            path = "/tts/speak" if args.legacy else "/tts/stream"
            with client.post(
                args.base_url.rstrip("/") + path,
                json={"text": texts[i % len(texts)], "target_language": "bg"},
                stream=not args.legacy, timeout=40,
            ) as response:
                response.raise_for_status()
                if args.legacy:
                    result = response.json()
                    first = time.perf_counter()
                    model = result["model_id"]
                else:
                    first = None
                    model = response.headers.get("X-TTS-Model")
                    for chunk in response.iter_content(chunk_size=None):
                        if chunk and first is None:
                            first = time.perf_counter()
                    if first is None:
                        raise RuntimeError("Speech response contained no audio")
            ms = round((first - start) * 1000)
            values.append(ms)
            print(json.dumps({"run": i + 1, "model": model, "audio_available_ms": ms,
                              "response_complete_ms": round((time.perf_counter() - start) * 1000)}), flush=True)
    print(json.dumps({"runs": len(values), "median_ms": statistics.median(values),
                      "min_ms": min(values), "max_ms": max(values),
                      "scope": "TTS only; excludes recognition, translation and playback"}))


if __name__ == "__main__":
    main()
