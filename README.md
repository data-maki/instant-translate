# cottonoha

Real-time transcription and translation for bilingual conversations in Japan.

Cottonoha is a small "leaves of speech" translator. The main experience is a responsive web app: a Next.js frontend captures browser microphone audio, a FastAPI backend streams 16 kHz mono PCM to Soniox, and the transcript appears as a live English/Japanese translation feed. The original terminal app is preserved under `cli/`.

## Quick Start: Web App

Create local env first:

```bash
cp .env.example .env
```

Set `SONIOX_API_KEY` in `.env`. Set `OPENAI_API_KEY` too if you want the post-recording **Improve transcript** translation cleanup.

Run the backend API in one terminal:

```bash
python3.12 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

Run the frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend talks to `http://localhost:8000` by default; override with `NEXT_PUBLIC_API_BASE_URL` only if you run the backend somewhere else.

## Web Usage

1. Confirm the language pair. The default is Japanese <-> English with English as the translation focus.
2. Add a session name and context hint if useful.
3. Press **Start listening** and allow microphone access.
4. Press **Stop** to save the transcript under `output/<session>/`.

The browser converts microphone audio to 16 kHz mono PCM before streaming it to the backend. For best multi-speaker accuracy on macOS, use Standard mic mode instead of Voice Isolation.

## CLI Usage

```bash
source venv/bin/activate
pip install -r cli/requirements.txt
python cli/main.py --session "xmas dinner"
```

To use the terminal as a client for the FastAPI backend:

```bash
python cli/main.py --session "xmas dinner" --source-languages ja,en --target-language en --backend-url http://127.0.0.1:8000
```

Add context for better accuracy:

```bash
python cli/main.py --session "xmas dinner" --context "Family discussing vacation plans"
```

**Controls:** `v` to scroll history, `r` to rename a speaker, `q` to quit and save.

## Selecting a Microphone

By default, the app auto-selects your MacBook's built-in microphone. To use a different device:

1. **List available devices:**
   ```bash
   python cli/main.py --list-devices
   ```
   Output:
   ```
   Available audio input devices:
     [0] MacBook Pro Microphone (default)
     [1] USB Audio Device
     [2] AirPods Pro
   ```

2. **Run with your chosen device:**
   ```bash
   python cli/main.py --session "xmas dinner" --device 1
   ```

### How debug audio issues:

If transcription shows "Waiting for speech..." but you're talking:

```bash
python cli/debug_mic.py
```

This tests your microphone directly and shows a live audio level meter. Common fixes:
- **Permission denied:** System Settings → Privacy & Security → Microphone
- **Wrong device:** Try a different `--device` index
- **Muted mic:** Check system audio settings

## Output

Transcripts save to `output/<session>/` as JSON, TXT, and MP3/WAV when audio is available. Resume anytime with the same session name or change it for a new session.

## Transcript Improvement

After recording, the web app can run **Improve transcript**. This keeps the live Soniox realtime path simple, then applies a post-recording Soniox async speaker pass and an OpenAI translation revision pass to the saved transcript.

The end-of-meeting speaker review panel lets you quickly filter by detected speaker, enter real names, merge extra clusters, and save `speaker_review.json`. The comparison notes that led to this path are in `docs/evaluation-decision-record.md`.

## Requirements

- Python 3.11+ (3.12 recommended)
- Node.js 20+ for the web frontend
- [Soniox API key](https://soniox.com)

## Supported Languages

🇸🇦 Arabic, 🪨 Basque, 🇧🇦 Bosnian, 🇧🇬 Bulgarian, 🐈 Catalan, 🇨🇳 Chinese, 🇭🇷 Croatian, 🇨🇿 Czech, 🇩🇰 Danish, 🇳🇱 Dutch, 🇺🇸 English, 🇪🇪 Estonian, 🇫🇮 Finnish, 🇫🇷 French, 🐟 Galician, 🇩🇪 German, 🇬🇷 Greek, 🇮🇳 Gujarati, 🇮🇱 Hebrew, 🇮🇳 Hindi, 🇭🇺 Hungarian, 🇮🇩 Indonesian, 🇮🇹 Italian, 🇯🇵 Japanese, 🇰🇷 Korean, 🇱🇻 Latvian, 🇱🇹 Lithuanian, 🇲🇰 Macedonian, 🇲🇾 Malay, 🇮🇳 Malayalam, 🇮🇳 Marathi, 🇳🇴 Norwegian, 🇮🇷 Persian, 🇵🇱 Polish, 🇵🇹 Portuguese, 🇮🇳 Punjabi, 🇷🇴 Romanian, 🇷🇺 Russian, 🇷🇸 Serbian, 🇸🇰 Slovak, 🇸🇮 Slovenian, 🇪🇸 Spanish, 🇸🇪 Swedish, 🇵🇭 Tagalog, 🇮🇳 Tamil, 🇮🇳 Telugu, 🇹🇭 Thai, 🇹🇷 Turkish, 🇺🇦 Ukrainian, 🇵🇰 Urdu, 🇻🇳 Vietnamese

---

MIT License
