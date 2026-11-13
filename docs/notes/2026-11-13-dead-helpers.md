# 2026-11-13 — Unused helpers, finished ops and a dead route go

Code only. No MCP tool, `/api/v1` operation, contract version, migration
or stored data changes.

- **Meta helpers** (`packages/record/src/mode-filter.mjs`):
  `metaPopulationClause`, `META_EVENT_NOTE`, `outsideMetaCount` and
  `outsideMetaNote`. Their last callers were the meta tools, which went
  on 2026-10-02; Elixir keeps no game-wide meta.
- **Deck stamp helpers** (`packages/tools/src/tools/shared.mjs`):
  `deckStamps`, `stampMatches` and `formedLabelParts`, with no caller.
- **Controls** (`packages/tools/src/controls.mjs`): `singlePlayerNote`,
  `colosseumMix` and `zeroSeriesNote`, which only their own test called;
  those assertions went with them.
- **`toolAvailableTo`** (`packages/contracts/src/principals.ts`): no
  caller; `toolsHiddenFrom` stays and is what the doors use.
- **Finished one-off ops** (`services/migrate`): `{rollup_regroup}` ran
  to `done` on 2026-09-28 (census 0, issue #109), and `{ops_recordings}`
  found nothing to stop on 2026-10-12
  (`2026-10-12-w1-ops-reason-census.md`). Both files, their tests, their
  `lambda.mjs` branches, their read shapes in `ops-invoke.mjs` and their
  rows in the `ops` skill went. `{activity_preview}`, the read written so
  the timeline could be judged before its 2.0.0 shape shipped, went the
  same way; `{explain_timeline}` stays for timing a real read. An old
  payload with any of these keys is now refused as unknown.
- **`GET /api/gateways/ladder`** and `api.gatewayLadder`: nothing in the
  app read the collector ladder any more. The web API tests that used
  the route to trigger the card deal now use `GET /api/me/gateways`,
  which deals the same way, and the machine-label privacy test reads the
  other operator's view through `/api/me/gateways` and the public status
  page.
- **Small items:** eight unused re-exports in
  `packages/syndication/src/index.mjs` (`discordLine`, `escapeDiscord`,
  `itemLinks`, `itemSentence`, `clanHelloContent`,
  `timelineDiscordStore`, `highlightPostContent`, `highlightPostKey`; the
  functions stay in their modules, and `itemSentence`, which only
  `lines.mjs` calls, is no longer exported); the Admin page's `"requests"`
  default, a page Admin no longer has (the address always names one, and
  Admin falls back to Accounts); the `navigate` props Status and
  Efficiency never read; a `{ skip: false }` in the site test.
- A stale comment in `packages/contracts/src/modes.ts` that named the
  removed meta rollup went too, as did `metaPopulationClause` in the
  `tool-change` skill's checklist.
