# 2026-10-12 — Elixir Clan: a removal's recheck reads holds now

Follow-up to `2026-10-12-clan-removal-runs-from-the-battle-log.md`
(#522), from its Codex review. A view's removal recheck reused an
evaluation under five minutes old, and setting a hold or an away does
not refresh that evaluation. So for up to five minutes a removal for a
member just put on hold could still show its clan-chat copy; completing
it was already refused.

`removalSafety` now reads the clan's holds first, on every path: a
removal whose member has an active hold or away is held with "The member
is on hold." and withholds its copy, drafting, completion and reopening.
`holdActive` is exported from the engine for it. MCP and JSON API
unchanged.
