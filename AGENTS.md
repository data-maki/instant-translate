# Repository Instructions

## How to work with the user

- Be concise and skip unnecessary narration. Work fast.
- Act first when the next step is obvious; ask only when truly blocked.
- Prefer minimal diffs and preserve existing structure.
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
