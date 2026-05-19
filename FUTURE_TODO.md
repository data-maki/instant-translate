# Future TODO

- Replace `audioop.ratecv` in `backend/app/provider_streams.py` with a Python 3.13-safe PCM16 resampler. This only affects the optional OpenAI Realtime candidate lane; Soniox, DeepL, Qwen, and Deepgram do not depend on `audioop`.
