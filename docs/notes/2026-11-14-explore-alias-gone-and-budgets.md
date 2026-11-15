# The /api/explore alias goes, and three loose ceilings come down (2026-11-14)

The owner's feedback close-out, item 5 ("leftovers, only if small").

## `POST /api/explore` is gone

`POST /api/me/tool` replaced it this morning (93f88890c, live 12:41Z);
the old path stayed one day as an alias for tabs loaded before that
deploy (`docs/notes/2026-11-14-small-cleanups.md`). Nothing calls it now:
not the app (`apps/web/src`), not the docs, not MCP, not the e2e
fixtures, and not the sibling repos (`../drop.poapkings.com`,
`../poapkings.com`, `../elixir-mcp-discord`, `../elixir-mcp-collector`;
read only). It is now a 404 like any unknown address, pinned in
`services/web-api/test/tool-bridge.test.mjs` (signed in or out, nothing
runs). Production logs were not read (no AWS from this session). A tab
still open from before this morning's deploy gets a 404 on Find, the
Record tab and the nickname editor until it is reloaded.

## Budgets

`services/mcp/test/query-budget.test.mjs` holds the invoker's time
guards (the per-call budget, the Lambda deadline, the lock timeout). Its
assertions are SQLSTATEs and error codes, never a stopwatch, by design
since 2026-11-13, so it has no ceiling to tighten.

The ceilings are in `services/web-api/test/signed-in-budget.test.mjs`.
Every route was measured on its synthetic record; statement budgets are
already at or within one of what each route makes. Three buffer ceilings
were at twice or more what they use and come down, about 1.3 to 1.5
times the measure:

| Read | Measured | Was | Now |
| --- | --- | --- | --- |
| `/api/me/cheers` (player page) | 664 | 1500 | 900 (the battle page's) |
| Clan `/members/<leader>/activity` | 1534 | 3000 | 2000 |
| Clan `/awards` (cold) | 264 | 1000 | 400 |

No MCP contract, JSON API or migration change. Nothing a player sees.
