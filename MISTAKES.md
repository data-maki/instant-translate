# Mistakes

- 2026-05-19: I incorrectly made the Groq/Qwen live adaptation endpoint produce Japanese (`target_rewrite`) even though the intended boundary is English-to-English tone adaptation only, with Soniox responsible for Japanese translation. Fixed by removing Qwen Japanese output from the backend schema, prompt, tests, and UI rendering.
- 2026-05-19: I treated English-to-English adaptation as useful when it was only rendered on screen after Soniox had already translated the original audio. That does not improve the Japanese output. The correct product path must translate the adapted English, or the feature is only explanatory UI.
