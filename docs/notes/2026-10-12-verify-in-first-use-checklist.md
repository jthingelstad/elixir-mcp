# 2026-10-12 — Player verified joins the first-use checklist

MCP and JSON API unchanged (`packages/contracts` untouched). No migration.
Deployed with no acceptance family: Console-only, plus one column pair on
the first-answer read.

Account → Overview's checklist (`FirstAnswer.jsx`) adds **Player verified
(needed to act in Clan)** after **Battles on record** and before the
optional clan and AI lines, linking to `/console/account/verify`. The
state comes from `/api/me/first-answer`, which now selects
`claim.status = 'verified'` and `verified_at` with the player it already
reads: no new request. The step shows for a player that is yours to prove
(primary or alt, as Verify lists them) and for an account with no player
yet ("add your player first"); a friend or watched player as the
first-answer subject gets none.

Its place, after battles on record, is the brief's: Verify names your own
most-played Trophy Road deck once battles are recorded, so the step reads
best after them. None of the three assumptions Jamie confirmed on
2026-10-12 is this part's.

Tests: `services/web-api/test/first-answer.test.mjs` (false, verified,
reset) and `apps/web/test/first-answer.test.jsx` (label, order, link, one
fetch; the done state; no step for a friend).
