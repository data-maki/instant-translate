"""Local-only, synthetic backend for the native UI playback regression test."""
import json
import math
import struct
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

requests = []
phrases = [
    {"id": "first", "speaker": "1", "speaker_label": "You", "source_lang": "en", "texts": {"en": "Where is the station?", "bg": "Къде е гарата?"}, "is_final": True, "time": 1},
    {"id": "second", "speaker": "1", "speaker_label": "You", "source_lang": "en", "texts": {"en": "Thank you!", "bg": "Благодаря!"}, "is_final": True, "time": 3},
]
session = {"name": "test-station", "title": "Station directions", "token_count": 8, "source_languages": ["bg"], "target_language": "en"}
audio = b"".join(struct.pack("<h", int(2500 * math.sin(i * 2 * math.pi * 440 / 24000))) for i in range(48000))

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/languages":
            self.reply({"default_source_languages": ["bg"], "default_target_language": "en", "languages": [{"code": c, "name": n, "flag": f, "priority": "high"} for c, n, f in [("bg", "Bulgarian", "🇧🇬"), ("en", "English", "🇬🇧")]]})
        elif self.path.startswith("/sessions?"):
            self.reply({"sessions": [session], "total": 1})
        elif self.path == "/sessions/test-station":
            self.reply({"session": session, "phrases": phrases, "adaptations": {}})
        elif self.path == "/requests":
            self.reply(requests)
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path == "/reset":
            requests.clear()
            self.reply({"ok": True})
            return
        if self.path != "/tts/stream":
            self.send_error(404)
            return
        requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("X-Audio-Sample-Rate", "24000")
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        try:
            for start in range(0, len(audio), 9600):
                self.wfile.write(audio[start:start + 9600])
                self.wfile.flush()
                time.sleep(0.02)
        except (BrokenPipeError, ConnectionResetError):
            pass

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 18766), Handler).serve_forever()
