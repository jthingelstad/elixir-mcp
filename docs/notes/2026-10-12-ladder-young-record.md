# 2026-10-12 — Ladder: one next step while the record is young

MCP and JSON API unchanged (`packages/contracts` untouched). No migration.
Deployed with no acceptance family: Ladder reads the same tools it did.

The season home (`Season.jsx`) shows `YoungRecord` while the player's
`recording_active_since` (the summary's meta) is under 28 days old: "Your
record is N days old" and one link. The choice is `youngRecord` in
`ladder/ladder.js`:

1. not verified → **Verify your player** (`/console/account/verify`);
2. verified, and the claim's `last_known_clan_tag` is a clan the account
   records (`/api/me/clans`, recording `active`) → **Open Clan**;
3. otherwise → **Follow a friend** (Tracking, tag field focused).

It adds no request: the clan read is the cached one Bring your clanmates
already makes, and it waits for that read rather than flash the wrong
step. A missing or unparseable start hides it; from day 28 it is gone.
No rating and no advice about play: a fact (the record's age) and a link.

Assumptions, confirmed by Jamie on 2026-10-12: the 28-day horizon and the
order above. The order is engineering's default, not a DECISIONS line.

Tests: `apps/web/test/ladder-young-record.test.jsx` (each branch, the
hidden cases, and a render per step plus day 28).
