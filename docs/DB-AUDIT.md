# Database audit — 2026-09-04

Requested by Jamie during the archive backfill ("I did not spend a lot of
time looking at the database"). Static schema-vs-usage review plus the
backfill's phase-timing census. Live pg_stat numbers land after the
backfill completes (migrate Lambda {inspect} op).

## Fixed during the audit

- **query_battles ordered by insert order, not played time.** `battle.cursor`
  is an identity column; the equivalence with battle_time held only while
  ingest was live-only, and the archive backfill broke it permanently
  (July battles inserted tonight would have led "recent battles").
  Now (battle_time, battle_id) keyset with an opaque cursor token;
  contract 0.2.0. The general lesson: never order user-facing output by
  surrogate identity.

## Performance census — FINAL (12,309 instrumented payloads)

| endpoint         | n     | total | projector | parse | store | commit |
| ---------------- | ----- | ----- | --------- | ----- | ----- | ------ |
| player_battlelog | 6,075 | 437ms | 408ms (93%) | 6ms | 17ms | 4ms |
| currentriverrace | 1,080 | 286ms | 270ms (94%) | 1ms | 8ms  | 4ms |
| player           | 5,149 | 30ms  | 13ms      | 2ms | 9ms  | 4ms |

Growth curve confirmed: battlelog cost rose 153ms -> 378ms -> 437ms as
player histories deepened — the career-length scaling defect (rollup
refresh reads via (player_tag, battle_id), no time component). RDS
never exceeded ~8% CPU: pure round-trip count.

## R1 outcome (measured live, steady state, 2026-09-04 09:45Z)

| endpoint         | census baseline | after R1+0015 | change |
| ---------------- | --------------- | ------------- | ------ |
| player_battlelog | 437ms (project 408) | 283ms (project 204) | 2x on the projector, on 5x bigger tables |
| currentriverrace | 286ms (project 270) | 287ms (race 219 + stamp 42) | steady; the 3-4s post-import readings were transitional backlog (first polls stamping newly-in-window archive battles), now bounded + indexed |
| player           | 30ms | 58ms | history-depth priced in; fine |

The R1 changes are on the live path permanently; the perf log line
means any future regression shows in Logs Insights within a poll cycle.

## Live storage census (post-import, {inspect} op)

DB 569MB. api_payload 391MB (69% — R2 is THE storage decision).
battle_participant 123MB / 74k rows (~1.7KB each, mostly deck jsonb —
R4's case, quantified). Dead tuples modest everywhere (rollup 3.3k dead
vs 44k live): autovacuum copes, R5 downgraded to watch-only. Every
index earns its keep; battle_participant_player at 1.4M scans is the
rollup workhorse and the scaling suspect.

## Found by the replay at Aug 3 (fixed)

currentriverrace for a roster-never-seen clan hit war_week's clan FK —
the roster poll is the usual clan-row seeder and nothing guarantees
ordering (live enrollment races it too). Both war projectors now seed
an identity-only clan row first.

## Performance census (early numbers, ~160 payloads; full run overnight)

Per-message phase means via processResult instrumentation:

| endpoint         | total | projector | everything else |
| ---------------- | ----- | --------- | --------------- |
| player_battlelog | 153ms | 143ms (93%) | parse 6 / store 6 / commit 1 |
| currentriverrace | 108ms | 102ms (94%) | ~6ms |
| player           | 13ms  | 6ms       | ~7ms |

RDS sits at ~8% CPU with burst credits climbing: the cost is **round-trip
count, not capacity**. The battlelog projector runs a per-battle loop
(battle insert, N participant inserts, observation insert, war-key
stamp) plus delete-and-reinsert rollup refresh per affected player-day —
dozens of sequential ~1-2ms round trips each. Recommendation R1.

## Findings and recommendations

- **R1 (perf, high): batch the projector writes.** Multi-row inserts for
  battle/participant/observation (single statement per payload instead of
  per battle), and one rollup refresh per payload batching affected
  pairs. Expected: battlelog projector cost drops several-fold; benefits
  the LIVE ingest path identically (prices future clan enrollment).
  Size precisely from the overnight census before building.
- **R2 (integrity/growth, medium): api_payload retention drift.** Schema
  comment promises "~60d rolling buffer, never the system of record" —
  but there is no retention job, and the store has quietly become
  load-bearing: get_collection and get_card_catalog serve from it and
  both level backfills depended on it. Decide explicitly: either it IS
  part of the record (drop the comment, keep latest-per-entity forever,
  prune superseded battlelog payloads whose battles are extracted), or
  enforce 60d with latest-per-entity exemption. 20GB allocated /
  autoscale to 100GB buys time but not a policy.
- **R3 (growth, low): unbounded operational rows.** rate_limit windows,
  expired magic_login/session/oauth_token rows, and mcp_call_audit.args
  all accumulate forever — every check is expiry-aware so nothing breaks,
  it is pure dead weight. One periodic sweep (scheduler tick side-task or
  a weekly migrate-lambda op): delete rate_limit windows older than 7d,
  expired auth rows older than 30d, null out audit args older than 90d.
- **R4 (storage, consider later): deck jsonb duplication.** Every
  participant row carries its full deck jsonb (~1-2KB) even though
  deck_hash already identifies it and players repeat decks for weeks.
  A deck dictionary (deck_hash -> cards, participants store only the
  hash + per-battle used/evolution deltas) would shrink the hottest
  table severalfold and speed inserts. Real reader changes; do it only
  if live stats show battle_participant dominating storage.
- **R5 (churn, verify with live stats): rollup delete-reinsert bloat.**
  player_daily_battle_rollup is rewritten per affected pair on every
  battlelog admission — high dead-tuple churn on a small hot table.
  Check n_dead_tup after the backfill; if high, R1's batching already
  reduces rewrites, and autovacuum likely copes at this scale.
- **Sound as-is:** canonical battle identity (content-derived PK, cursor
  kept for tailing only); receipts append-only with the right two
  indexes; append-only event streams with (subject, event_id desc)
  indexes; war tables clan-tag-led composite PKs (multi-tenant
  discipline); poll_state/budget_state singleton design; FK discipline
  modest and correct.

## Process note

Every finding above except R4 was surfaced or confirmed by the backfill —
replaying four months of real payloads is a better audit tool than any
checklist. Keep this pattern: big mechanical operations double as
correctness/performance probes.
