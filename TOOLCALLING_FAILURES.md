# Toolcalling Failures

- 2026-05-19: `web.run` open with multiple search-result refs returned no visible rendered result. Retried with direct source URLs and the research succeeded.
- 2026-05-19: `python3 -m tomllib /Users/jcarbs/.codex/config.toml` failed because `tomllib` has no module entrypoint. Retried with `python3 -c 'import tomllib; ...'` and TOML validation succeeded.
