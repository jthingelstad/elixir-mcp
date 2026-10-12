# 2026-10-12 — A person's own Ladder and Console reads are unmetered (#538)

MCP 11.11.2 and JSON API 3.2.0 unchanged; no migration. From the Ladder
and Console briefs Jamie ratified on 2026-10-12 (#525),
`docs/product/ladder.md` "A person's own reads are unmetered", and the
DECISIONS line of the same name.

## Jamie's answer

DECISIONS, "The hourly bucket stays for web reads; only the daily quota
leaves them" [Jamie, 2026-10-12]:

> The 300-an-hour bucket stays for web reads; it is not a tier. Only the
> daily tier quota leaves Ladder and Console reads. Usage accounting still
> records them.

## Questions and the answers taken

- **Which limit leaves.** The daily tier quota (`mcpday#<account>`)
  only. `POST /api/explore` (the Console's Explore page and every Ladder
  read) still takes the hourly bucket `mcp#<account>`, 300 an hour,
  shared with the person's own MCP clients. [Jamie, 2026-10-12]
- **How: drop the charge, or mark the call first-party.** Drop the
  `makeQuota` charge from the explore route. Setting
  `account.firstParty` (as Clan does, `services/web-api/src/clan.mjs`)
  would also lift the live lane: `liveBudgetFor`
  (`packages/tools/src/tools/shared.mjs`) treats a first-party call as
  unlimited, and the brief keeps the live lane metered. The route is the
  only caller that charges a web read, so removing the call there is the
  smaller change and leaves `quota.mjs` with one meaning. A tool read
  through the bridge that spends the live lane still spends
  `liveday#<account>`. [engineering, 2026-10-12]
- **How usage accounting records them.** The call log (`mcp_call_audit`)
  has no charged flag; the usage route decides "charged" from `surface`
  and `client_name`. Every explore read is still written there, surface
  `web`, no client name. `CHARGED` becomes "not `rest`, not `web`" (the
  web surface is the Console, Ladder and Clan, none of which the daily
  limiter charges), so `today_calls`, the day bars and an agent console's
  `budget_today_calls` count only what `mcpday#` counts. The person's own
  web reads are a separate, uncharged count, `web_calls` (surface `web`
  and no client name), per day and as `web_calls_today`. [engineering,
  2026-10-12]
- **Where the person sees them.** Usage's lede says how many of the day's
  reads were the Console's and Ladder's and that they are not counted
  against the budget; each day's bar says the same in its hover; "By
  connection" and "Top tools" already list every logged call, so the
  Console row stays. The Overview's Today tile says the same in one
  clause. [engineering, 2026-10-12]
- **A side fix.** Clan's morning job writes its reads as surface `web`,
  client `Clan morning`; the old predicate excluded only `Clan`, so those
  rows were shown as charged although the limiter never counted them. The
  new predicate excludes every web row, which fixes that. [engineering,
  2026-10-12]

## What stays metered

Agent calls and a person's own MCP clients at `/mcp` (`mcpday#` and
`mcp#`, `services/mcp/src/handler.mjs`), integrations and people over
`/api/v1` (their own usage rows), and the live lane (`liveday#`) on every
door. None of those paths changed.

## Docs

`apps/site/src/docs/ladder.md` (the reads no longer count against the
daily quota), `limits.md` (the explorer rows; "What is deliberately
unlimited"), `roles.md` (a line under the quota table; the fine print),
`glossary.md` ("budget account"), `connections.md` (the Usage row). `apps/web/src/ladder/AGENTS.md` and
the code comments that said Ladder reads are priced against the quota.

## Tests

`services/web-api/test/web-api.test.mjs`: an explore read bumps `mcp#`,
leaves `mcpday#` untouched, is written to the call log with surface
`web`, and is counted in `web_calls_today` but not `today_calls`; a full
daily quota no longer refuses an explore read, a full hourly bucket
still does. `services/mcp` keeps its own test that `/mcp` charges
`mcpday#`.
