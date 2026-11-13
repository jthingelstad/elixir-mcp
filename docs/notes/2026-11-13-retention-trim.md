# Retention: a year for the record, 28 days for operational logs

2026-11-13. Jamie: "we have historically not put any kind of data
expiration or data lifecycle in place. I think that we should go ahead
and assume a 1 year data retention." Of the receipts, the MCP call log
and the capture audit: "Operational logs i would keep for 28 days."

## What shipped

- `packages/record/src/retention.mjs`: the one list. Every table is in
  `TRIMMED` (time column and window), `OWN_TRIMS` (a shorter sweep
  elsewhere), `CHILDREN` (goes with a trimmed parent) or `KEPT` (with a
  reason). `services/jobs/test/retention.test.mjs` builds the schema and
  fails on a table in none, or in two, or on an entry whose table or time
  column is gone.
- `{retention_trim}` in the jobs Lambda, daily at 04:40Z
  (`RetentionTrimRule`): batches of 2,000 rows (200 battles), each its
  own transaction with a 20 s statement and 5 s lock timeout; at most 50
  batches a table, 300 a run, 120 s. It logs `{retention_trim: {tables,
  held, statements, stopped?}}`.
- `{retention_dry_run}` (migrate, a read): per declared table, the
  window, column, rows due today, total bytes and whether it is held.
- 0258: `player_event (battle_id)` (a battle's delete checks it, and the
  trim deletes a battle's events by it), and the `receipt_id` foreign
  keys on `clan_event`, `player_event` and `clan_snapshot_daily`
  dropped: the column is provenance, and each receipt delete would scan
  all three unindexed tables. `capture_audit`'s key stays; its row goes
  first.

## Choices [engineering]

- A battle takes its `player_event` rows, rounds, participants and (by
  cascade) highlights. Decks stay: canonical identity (DECISIONS), and a
  deck purge would need an index leading on `battle_participant.deck_hash`.
- `player_daily_battle_rollup` goes on its own day, a year, with the
  battles it sums.
- `player_event` and `clan_event` age by `window_end` (never null; the
  event happened by then). `war_week` by the first of `closed_at`,
  `finished_observed_at`, `started_observed_at`, taking its attendance,
  participation, period log and opponent rows; a week with none stays.
- `game_event` goes once its days are gone; `oauth_family` once no token
  and no call log row points at it.
- Old rows that stay whatever their age: an open membership, an
  unresolved feedback item (only `done` and `declined` go), an open claim
  check, an uncompleted collector upgrade.
- The 28-day call log trim makes the 30-day address scrub and the 90-day
  argument and capture-pointer sweeps no-ops; they stay, harmless.
  Captured bodies still expire at 90 days in S3.

## Held

`api_receipt` is declared at 28 days and **held**: the trim skips it
and the dry run counts it. Year-long readers still need receipts:

- role history begins at the first admitted roster read per collector
  (`participation-sql.mjs`, `role_history_since`) and would begin 28
  days ago;
- war award absence evidence reads each week's before-start and
  after-finish reads (`war-membership.mjs`);
- `game_events` derives which days the calendar was read from `events`
  receipts.

Running it is one line (drop `held`) once those readers keep what they
need some other way, or the regression is accepted. `capture_audit`
runs at 28 days: since the year graph retired (same day) its product
readers look back three days at most (the `{capture_audit}` op up to 30).

## Not done

- Clan's own store (`clan_state`) is keyed by item, not time; it is
  kept until an item-kind trim is built.
- The S3 payload archive is write-once with no expiry (DECISIONS: "The
  retained record's archive is write-once"); the trim does not touch it.
