# Future TODO

- Replace `audioop.ratecv` in `backend/app/provider_streams.py` with a Python 3.13-safe PCM16 resampler. This only affects the optional OpenAI Realtime candidate lane; Soniox, DeepL, Qwen, and Deepgram do not depend on `audioop`.
- Rank older sessions by newest top, most recent bottom
- On older chat sessions, there should be no onboarding, just the back and forth. We can think of the back and forth as chat bubbles (with the translation being displayed on the side as info, not chat)
- Simplify the display of options... all the variance on situation is really necessary? Think about actual clusters that inform politeness or the specific prompt. Perhaps is one major "group" and a subgroup?
