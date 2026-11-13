# 2026-11-13 — A quiet member's poll age counts admitted reads only

No MCP tool, `/api/v1` operation, contract version or migration changes.

Codex on #943: `days_since_poll` in the timeline's quiet list (a player's
own entry and each clan member's) took the newest battle-log receipt,
rejected ones included. A malformed or refused response observed
nothing, but it still reset the count, as if the member had just been
read. Both queries now count admitted reads only
(`packages/tools/src/activity/entries.mjs`). This matches `poll_state`
and 0259's read facts, which the queries move onto when the receipt trim
is lifted.
