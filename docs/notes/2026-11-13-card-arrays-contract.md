# 2026-11-13 — The card-arrays contract, and what nothing reads any more

Migration 0256. No contract change: every tool, route and mail answers as
before. The third step of the move 0255 began
(`2026-11-13-card-arrays-expand.md`, `2026-11-13-card-arrays-readers.md`).

**The deploy drops stored tables.** Take an RDS snapshot first.

## Ingest

Ingest writes the cards only as arrays, built from the payload in the
statement that writes the row: the participant upsert carries `cards`,
`card_forms`, `card_levels`, `card_stars` and the four `tower_*`
columns; a duel's round upsert carries its arrays and `cards_used`; the
deck insert carries `card_ids` and `card_forms`. A participant gets one
row version, never a second for its cards. On conflict an array still
NULL is filled and one already set is kept (`cards_used` element by
element), as the card rows kept the first observation. The fill from
rows (`packages/ingest/src/card-arrays.mjs`, `unfilledOnly`) is gone. A
second `supportCards` entry is ignored (the first wins); the old fill
skipped such a participant, and the production census found none.

## Dropped tables

| Table | Why nothing needs it |
| --- | --- |
| `battle_participant_card` (547 MB), `deck_card` (332 MB) | Every reader moved to the arrays (#924); ingest no longer writes them. Every field they held is on the arrays, so the canonical tables stay lossless. |
| `series_backfill_state` | Read and written only by `{series_backfill}` and `{series_census_self}`, retired here with `infra/scripts/series-backfill.mjs`. |
| `email_milestone`, `email_milestone_look` | The milestone mail retired on 2026-11-13; account removal was the last thing that touched them. |
| `agent_policy_context_grant`, its three triggers and their function | `clans_context` retired in 12.0.0; the `{clan_context}` op and `agentContextEligibility` were the last readers. DECISIONS amended (Jamie, 2026-11-13: "Agree with your recommendations. I think you can make these calls through this pivot."). |

The two card tables were 879 MB of a 2,402 MB database (the 0255 census);
with their indexes and the dropped `battle_participant` indexes the
deploy returns most of that to the volume at once (a drop frees its
files; no vacuum needed).

**Kept: `clan_state_import`.** `{family_clients: {retire_app}}` still
checks the Clan import digest there before it retires Clan's old OAuth
client, and `CLAN_INTERNAL` is still a deploy parameter, so the Clan
family client is not retired in code. It goes with that op.

## Indexes

Each dropped index was checked against every live reader:

- `battle_participant_window` (battle_time, INCLUDE): every reader binds
  a player, a clan or a battle and is served by
  `battle_participant_player_time_cover`, `battle_participant_clan_time`
  or the primary key; the clan member battles read (`clan_tag = any` or
  `player_tag in`) is a BitmapOr of those two.
- `battle_participant_player` (player_tag, battle_id): player lookups,
  and the `player_tag` foreign key, are served by
  `battle_participant_player_time_cover`, which leads with player_tag.
- `battle_participant_deck` (player_tag, deck_hash): every player and
  deck read also bounds battle_time or reads deck_hash from the cover's
  INCLUDE.
- `battle_participant_deck_time` (deck_hash, battle_time): no reader
  since MCP 13.0.0 retired the deck-alone mode. It was the only index
  that could serve the `deck_hash` foreign key on a deck delete; nothing
  deletes decks (the last delete was 0117). A future purge of `deck`
  rows adds a `battle_participant (deck_hash)` index first.
- `battle_participant_global_rank`: only `{mode_shape_census}`, retired
  here, filtered on global_rank.
- `deck_archetype_version`: the one filter is `archetype_version is
  distinct from $1` (card-roles.mjs), which a btree cannot serve, and
  the archetype op counts decks by a whole-table group-by.
- `battle_metadata_cover` went in 0249; nothing to drop.

`api_receipt_entity` (endpoint, entity_key, receipt_id desc) and
`api_receipt_entity_time` (entity_key, fetched_at desc) are one index,
`api_receipt_entity_fetched` (endpoint, entity_key, fetched_at desc).
Every entity read pins the endpoint. The latest-receipt reads
(`raceMatchmakingAt`, `{poll_state}`)
order by `fetched_at desc, receipt_id desc`; `{tag_footprint}` walks the
endpoints with a loose index scan instead of reading entity_key alone.

## Ops removed

`{card_arrays}`, `{card_arrays_census}`, `{deck_census}`,
`{series_backfill}`, `{series_census_self}`, `{explain_series}`,
`{clan_context}`, `{enum_census}`, `{battle_fidelity_census}`,
`{mode_shape_census}`, `{role_history_census}`,
`{membership_baseline_census}` and `{live_fetch_strays}`, each with its
lambda branch, read-shape entry, tests and `ops` skill row. Each now
answers `unknown_op`. `{vacuum}` and `{rewrite_table}` no longer name
the dropped tables.

## `{integration}`: `revoke_legacy`

`{"integration": {"action": "revoke_legacy", "id": "<integration
public_id>"}}` revokes every live `service_token` with audience `mcp`,
named as the integration, on the integration's owner: the MCP key the
integration ran on before it had its own. It answers `revoked` and
`token_ids`, never a value or a hash; a second run revokes nothing.
`retire_legacy`, which needed the key's hash and a REST call through a
door JSON API 5.0.0 closed, is gone; `list` and `revoke` stay.

## Guard

`services/migrate/test/card-tables-gone.test.mjs` fails if any source
outside `db/migrations`, `docs`, `.claude` and the contract changelog
names `battle_participant_card` or `deck_card`.

## Deploy

0256 builds the receipt index first, under a SHARE lock on `api_receipt`
(reads go on; collector submits wait for the build, seconds on 341 MB),
then drops, so `battle_participant`, `deck`, `account` and
`service_token` are locked only for the instant before the commit. A
previous-build ingest that runs after the commit fails on the dropped
card tables and its job retries on the new build: accepted while Elixir
is in beta. A previous-build account removal or `{clan_context}` call in
those seconds fails the same way and can be rerun.
