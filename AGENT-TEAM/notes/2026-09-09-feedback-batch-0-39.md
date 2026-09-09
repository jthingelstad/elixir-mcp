# Eleven feedback items, one contract bump (0.39.0)

Jamie ran an extended Claude session against the MCP and filed #14-#24
through `elixir_feedback`, then asked for an aggregate assessment and a
full implementation. Interactive session, checkout lease `session`.

## The aggregate read

Ten of eleven items are data-shape requests, not bugs. They cluster:

| Theme | Items | Shipped as |
| --- | --- | --- |
| Grouping axes the corpus holds but no tool exposed | #14.1, #18.2, #19 | `battles_opponents`, `badges_rarity`/`badges_holders`, `cards_synergy` |
| Names for tags | #14.2, #15 | `name_known`, `players_names`, `{player_names}` backfill op, `players_profile` description |
| Budget visibility | #17 | `meta.quota` on every response (contract field) |
| Scope ergonomics | #16 | `elixir_events` under `cr:read`; refusal hint |
| Corpus sizing | #18.1 | `elixir_data_insights` recorded_players / clans_by_scope / recorded_clans / profiles |
| Statistical honesty | #21, #23 | corpus prior, `insufficient_sample` floor, `excluded`, boat exclusion, `decided_battles` |
| Duel semantics | #22 | legend, `rounds_played`, princess padding |
| Scale and form coding | #20, #24 | `cardForms`, `forms_*`, catalog maxLevel 16 + `maxLevelRarityScale` |

## Measurements that shaped decisions (receipts)

- Opponent names: `battles_query` Aug window shows names; Jun-Jul window
  shows null. elixir-bot `battle_events` has `opponent_name` for all 282
  pre-Sept King Thing rows. Backfill artifact, repaired by op.
- Duels: elixir-bot 412 duel rows, `crowns_for` max 7, 134 rows > 3.
- Princess arrays (elixir-bot, ~50k rows since June): head-to-head rows
  never carry a `0`; null on every 2-crown-conceded/king-fallen row plus
  18 one-crown rows; duel rows carry `[0,0]`, `[0,n]` (29) and length-1.
- Catalog bit field: `npm run cr /cards` 2026-09-09, 123/123 cards match
  `iconUrls` presence to bits.

## Verification

- `npm run verify` green after fixing: an unused bound parameter (Postgres
  "could not determine data type of parameter $1") in the corpus prior,
  `recording.scope` (renamed from `clan_scope` in 0043), and an unbound
  synergy form parameter. The invoker now logs unexpected tool errors.
- Docs repo `cr-agent-api-docs` d5c1ae5 pushed, build green (13 guards).

## Watches

- After the name backfill, re-read a June battle for `#20JJJ2CCRU`
  and confirm `name_known: true`.
- `insufficient_sample` will fire on most single-player meta segments
  under 30 decided battles; that is intended. Watch feedback for agents
  reading the absent `shrunk_win_rate` as a bug rather than the flag.

## Production acceptance (2026-09-09 ~12:55Z)

- Deploy of `96ee0a2` completed, exit 0, migrations `{applied: 60, ran: 0}`.
- `{player_names}` op, five batches from elixir-bot's record: offered
  33,993, filled 26,300, 7,868 players still unnamed (never named by any
  source; boat defenders and roster-only tags).
- Live reads on the personal connection: duel battle
  `ca511f02…` returns contract 0.39.0, `rounds_played: 3` both sides,
  `name_known: true`, `tower_hp.princess [0,0]` for the loser, the new
  legend, and `meta.quota` (request `28ca1ec8-868d-4157-826d-7556cf3a6c81`).
  `elixir_data_insights`: recorded_players {direct 29, via_clans 209,
  total 238}, 7 comprehensive clans listed, 544 players with a snapshot
  (request `a2c2ee04-f418-4c78-bcfd-243650d983ec`) - the population #18
  said existed.
- Feedback #14-#24 responded `done`, shipped_in 0.39.0; queue empty.
