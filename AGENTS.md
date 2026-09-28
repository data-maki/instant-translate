# Repository Instructions

## How to work with the user

- Be concise and skip unnecessary narration. Work fast.
- Act first when the next step is obvious; ask only when truly blocked.
- Prefer minimal diffs and preserve existing structure.
- When packaging changes, review relevant pre-existing edits before excluding them. Report commit coverage and the remaining working-tree status, and reconcile duplicate local copies after their PRs merge.
- Before handing over a local app URL, verify the matching backend's `/health` and `/languages`, plus an authenticated `/sessions` request. A listening port is not proof of the correct service. When changing ports, align frontend `NEXT_PUBLIC_API_BASE_URL` and backend `AUTH_BASE_URL`.
- Session-title fixes must verify a topic-based generated title reaching the recording tab after Stop and surviving reload; an opening-text excerpt is only a fallback. Check the current recording state immediately before restarting its backend.
- During active user testing, do not navigate, select history, reload, or otherwise change any existing user browser tab for verification. An apparently idle second tab is still the user's workspace. Use isolated automated tests; perform interactive verification only in an explicitly separate test session.
- Session navigation changes must pass `pnpm --filter cottonoha-web test:session-navigation`. Exercise delayed history loads, save events, renames, and deletions after New chat; a response may update history but must not select a previous conversation.
- Live translation and autospeak changes must pass `pnpm --filter cottonoha-web test:autospeak`. Existing target-language text goes directly to speech in both display modes, with zero automatic translation/rewrite requests. Translate a missing language once; never require an English rewrite to speak an available translation.
- Phrase display and manual playback changes must pass `pnpm --filter cottonoha-web test:phrase-text`. Every displayed sentence/language, including history, is independently playable; autospeak direction, cursor, and finality restrictions must not disable manual playback. Romanized readings never replace the original-language TTS payload.
- Verify speech output in an isolated browser with microphone access absent: both streamed PCM and the older-backend MP3 fallback must produce nonzero audio at an unpaused output sink under normal autoplay restrictions. Successful requests, animations, and mocked playback handles alone do not prove audible playback.
- Keep transcript text compact: romanization belongs inline in brackets, with natural wrapping rather than separate source/reading/translation rows. Use readable, stable language labels with related shades for related languages; keep speaker identity colors separate. Check both themes and mobile widths without changing user tabs.
- Do not overengineer; start with the simplest working solution.
- Do not add abstractions, edge-case handling, or additional security work unless requested or required for production-level functionality or correctness.
- Push back when a request is overly complex, risky, or wasteful.
- When the task is complex, break it into a few clear steps, mention which path is simpler, which path is best, and explain why if they differ.
- When comparing architecture options, include a simple ASCII diagram for each option.
- When proposing UI changes, use ASCII to show affected areas and highlight placement, hierarchy, and spacing.

## Meta Learning Protocol

- Record mistakes in `MISTAKES.md`.
- Record missing context or tools that would have helped in `DESIRES.md`.
- Record environment learnings in `LEARNINGS.md`.
- Record failed tool calls in `TOOLCALLING_FAILURES.md`, including the tool, error, and whether the task eventually succeeded.
- Save these files at this repository root, identified by the `.git` directory.
- Treat repeated steering as high-signal feedback that the environment or workflow needs refinement.
- Before proceeding after such steering, make the relevant meta changes to repo docs, tracking files, or behavior so the same feedback should not be needed twice.
