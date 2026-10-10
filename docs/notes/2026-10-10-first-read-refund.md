# 2026-10-10 — A first read that mints nothing is given back

Follow-up to `2026-10-10-live-read-caps.md` (Codex review of #460).
`requestFirstRead` spends the pool's `firstread#` allowance in `beforeMint`,
after the open-job check. Two adds of the same fresh tag can both pass that
check; `enqueueJob` inserts one job and the other call mints nothing
(`minted: false`), and `makeLive` gave back only the global token. An
enqueue that throws left the allowance spent the same way. Both now give
the pool's read back (`refundFirstRead`), so a queued tag costs nothing, as
the docs say.

The What's new entry the first change owed ships here as well. No
migration; MCP 11.7.2 and JSON API 3.1.0 unchanged.
