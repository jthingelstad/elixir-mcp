# 2026-10-10 — A refused first read takes nothing from the pool

Follow-up to `2026-10-10-first-read-refund.md` (Codex review of #463).
`spendFirstRead` incremented the pool's `firstread#` count on every ask and
refused past the slot ceiling, so a refused ask still raised the count. With
asks overlapping at the ceiling, a later refund then only took the count
back to the ceiling, and the pool stayed spent although fewer reads were
minted. The increment is now conditional (`where count < max` on the
upsert): a refusal leaves the count alone, so it is always the reads taken
and not given back. No migration; MCP 11.7.2 and JSON API 3.1.0 unchanged.
