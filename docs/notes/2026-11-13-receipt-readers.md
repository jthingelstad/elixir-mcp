# 2026-11-13 — The long receipt readers read facts of their own

Migration 0259 and two migrate ops. No MCP tool, `/api/v1` operation or
contract version changes; what each reader answers is the same once the
backfill has run.

Jamie, 2026-11-13: "assume a 1 year data retention", and of the receipts,
"Operational logs i would keep for 28 days". `api_receipt` (214 MB) was
declared a 28-day table and its trim held, because four readers still
looked back up to a year. None needs a receipt's body or bookkeeping, only
that a read happened, so each now reads a small fact kept a year:

- **Role history and each member's place at a war finish**
  (`participation-sql.mjs`: `finish_reads`, `role_history_since`): the
  clan's admitted roster reads either side of a finish, and where its live
  (not imported) reads begin.
- **War award absence evidence** (`war-membership.mjs`): the roster reads
  before a week's start and after its finish.
- **The event calendar's read days** (`game_events`): which game days an
  events read covered, and the gaps.
- **A quiet member's `days_since_poll`** (`activity/entries.mjs`, the
  timeline's quiet list): the last battle-log read at or before the
  window's end. This one was not on the list; trimmed receipts would have
  made a member unpolled for 28 days read as never polled.

## The facts (0259, `packages/record/src/read-facts.mjs`)

- **`admitted_read_day`**: one row per (endpoint, subject, UTC day) for
  `clan` and `events` reads, the day's read instants as an array, and the
  day's first read by a live collector (`first_live_at`; the elixir-bot
  import, gateway `backfill-elixir-bot`, never counts). A few hundred rows
  a day whatever the poll rate: about 300 clans and one events list.
- **`battlelog_read_gap`**: the stretches of a day or more in which a
  player's battle log went unread, plus one row (`read_at` null) for the
  time before its first read. Between them every instant is under a day
  from a read, which is all `days_since_poll` counts; the latest read is
  `poll_state`'s. A read admitted late splits the stretch it lands in.

Ingest writes both in the receipt's transaction, before `poll_state`
moves (`pipeline.mjs`). Both are in `retention.mjs` at a year
(`day`, `next_read_at`) and in `{vacuum}`'s list.

## The backfill and the hold

`{read_facts_backfill}` fills both tables from the receipts still held,
one subject per statement (clans, then events, then battle logs), with a
cursor, a real `remaining` and a 45 s budget; it is idempotent and
converges with what ingest writes meanwhile. `{read_facts_check}` reads
how far the facts cover the receipts (every `missing_*` 0 when done). The
receipt trim stays held in this change. Lifting it is a separate pull
request, deployed only after the backfill has run to `done` and the check
reads 0, never in the same deploy as this one. [engineering]

## The guard

`services/jobs/test/receipt-readers.test.mjs` pins every source file that
names `api_receipt` with its count and why its reads stay inside 28 days
(the last hour, day or week, the latest read, a freshness probe, the
trim, the backfill). A new reader fails until it is listed with its
reason; a reader that needs more reads a fact.

## What the receipt trim will still change

Bounded readers that keep reading receipts, and what 28 days does to
them:

- The collector page's 30-day series (`routes/gateways.mjs`) shows 28
  days.
- The public fetch series (`public-stats.mjs`) covers the days held, as
  its code already expects.
- The `{funnel}` op's first profile read falls back to the first battle
  stored for a player whose reads are older.
- `days_since_poll` counts admitted battle-log reads; a rejected read no
  longer counts as a poll.
