# 2026-10-10 — A clan's map reads that clan's roster

The Codex review of #230 found that the `/api/clans/<tag>/map` route still
called `loadRoster(ctx.session, ctx.gate, clan)` after `loadRoster` had
been reduced to `(session, clan)`. The gate was taken for the clan, so the
roster read named no clan and `clans_roster` answered the account's
default recorded clan. For a person in two clans, the second clan's map
listed the first clan's members with their places (places are per player
in the ledger), and left the second clan's own members off; it did so
even when the first clan's leaders had switched its map off, since the
switch checked is the requested clan's. The route now passes the
requested clan, so the map is always that clan's current roster.

`packages/clan/test/social.test.mjs` pins it with a person in two clans
whose home clan's map is off: the other clan's map must show only its own
member and must name that clan in the roster read. It fails without the
change. The fake MCP door (`test/fakes.mjs`) can now answer
`clans_roster` per clan (`rosters`), falling back to the default roster
as the real tool does, which is why no earlier test could see this. No
other Clan call passes more arguments than its function takes.

MCP 11.7.2 and JSON API 3.1.0 unchanged; no migration.
