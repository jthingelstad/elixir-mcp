# 2026-10-10 — The timeline docs audit no longer depends on timing

`catalogue/elixir_timeline#docs` failed the full acceptance runs after two
deploys that day and passed in between. The Recorded evidence section of
`docs/timeline` names the refusal reasons of an evidence page read, and a
healthy run carries them only when a capture lands mid-read (#469). The
three an MCP caller can meet (`evidence_changed`, `version_required`,
`evidence_unavailable`) are allowed in the audit and pinned by
`packages/tools/test/timeline-evidence-refusals.test.mjs`.

`invalid_page` is not among them (#470). The tool's argument validation
refuses an out-of-range `evidence_offset` or `evidence_limit` before the read
runs, so only the browser route can produce it. `docs/timeline` now says so.
