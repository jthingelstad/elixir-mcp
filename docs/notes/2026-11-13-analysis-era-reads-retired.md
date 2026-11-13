# 2026-11-13 — The analysis-era reads retire

Jamie agreed the recommendation on 2026-11-13 (DECISIONS, "Every read
names a player or a clan; the analysis-era reads are retired"). These were
the last tools and modes that read a population or the whole record
instead of a named player or clan. MCP 13.0.0 removes them outright, with
no alias, tombstone or deprecation window.

## What went

- `cards_card` (`card-profile.mjs`, `card-resolver.mjs`). A card's facts
  and art are on `cards_catalog`; a player's play of it is `battles_cards`
  or `battles_query` with `with_card`.
- `badges_rarity` and `badges_holders` (`badges.mjs`). A player's badges
  stay on `players_profile`, labelled as before.
- The `segment` mode of `battles_performance` (`performance-segment.mjs`)
  and its `weeks[]`. One player's weekly record is `group_by: "week"`.
- The corpus mode of `battles_query`: `deck_hash` with no player read
  every recorded player's battles on the deck and served `deck_stats`.
  `deck_hash` stays as a filter. With no `player_tag` it now narrows the
  caller's own battles, like every other filter, and `deck_stats` is gone.
- `points` and `quota_credits` on `elixir_collectors`, zero since
  2026-10-12.
- The `clans:attest` OAuth scope. A client that still asks for it signs in
  without it, and a stored grant that holds it is filtered on read, so the
  grant keeps every other capability. Nothing is refused for carrying it.

## What `segment` became

Nothing. No remaining tool takes it, and `validateArgs` refuses it like
any unknown argument (`bad_request`). The Stats door in
`services/web-api/src/routes/explore.mjs` used to refuse `segment` and
`on_behalf_of`; it now refuses only `on_behalf_of`. The invoker's
budgeted tools are now `clans_standings` and `war_history`.

## Also fixed

`live_unavailable` said "Global leaderboard capture has been retired",
which was the wrong reason for every endpoint it reached. It now says the
live lane reads players, battle logs, clans and River Races only, and to
call again without `live: true`.

## Versions

MCP 13.0.0, a major. The JSON API is 4.0.1, a patch: `clans:attest`
leaves the scopes its OpenAPI document lists, and no operation's response
changed. `/players/{tag}/battles` always names its player, so it never
served `deck_stats`.

## Guards

- `acceptance/checks/contracts.mjs` `recorder-retired-refusals`: the three
  tools are unknown, no tool declares `segment`, a `segment` argument is
  refused with `bad_request`, and `battles_query` declares no `deck_stats`.
- `packages/tools/test/tools2.test.mjs`: `deck_hash` on `battles_query`
  returns only the named player's battles on the deck; collectors serve
  neither field.
- `apps/site/test/site.test.mjs`: no docs page mentions `segment`.

## Indexes that lost their last reader

No migration ships here; dropping an index is a data-layer call for the
refactor under way on the same day. Both are left in place and named for
it:

- `battle_participant_deck_time` (`0096_card_index_diet.sql`):
  `(deck_hash, battle_time desc) include (player_tag, outcome) where
  deck_hash is not null`. Its reader was the corpus `deck_hash` read in
  `battles_query`. Every remaining `bp.deck_hash = $n` predicate
  (`battles/query.mjs`, `battles/decks.mjs`, three in
  `battles/performance.mjs`) sits beside `bp.player_tag = $1` or
  `bp.battle_id = any($1)`, which lead the participant's own indexes.
- `deck_card_card` (`0091_deck_cards.sql`): `(card_id, form,
  deck_hash)`. Its reader was `firstPlayedSql` in `card-profile.mjs`
  (2026-10-21, "cards_card reads a card's decks once"). Every remaining
  `deck_card` read (`shared.mjs` deck identities, `activity/entries.mjs`,
  `web-api` verify, ingest `card-roles.mjs` and `card-arrays.mjs`) joins
  on `deck_hash`, the primary key's leading column.

The tables themselves are unchanged and still written by ingest.
