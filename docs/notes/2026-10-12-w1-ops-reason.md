# 2026-10-12 — The maintainer's `ops` recording reason is retired (#527)

MCP 11.11.2 and JSON API 3.2.0 unchanged; no migration. From the record
brief Jamie ratified on 2026-10-12 (#525), `docs/product/record.md`,
principle 5; DECISIONS, "History is kept for what someone tracks, and a
year after" [Jamie, 2026-10-12]: "The maintainer's own `ops` recording
reason is retired: only people's tracking records."

## What changed

- `reconcileRecording` (`packages/claims/src/index.mjs`) no longer reads an
  `ops` reason: the `ops` column of its reasons query, the short-circuit
  that returned before any start or stop, the `!ops` terms of the dry run,
  and the `origin <> 'ops'` guard on the stop are gone. A recording whose
  origin is `ops` stops when nobody tracks its subject, like any other.
- `recordedPlayers` (`services/jobs/src/activity.mjs`) no longer counts an
  active `ops` recording as a recorded player; a tracked player still
  counts through its claim.
- New op `{ops_recordings: {dry_run}}` (`services/migrate/src/ops-ops-recordings.mjs`),
  dry run by default and a read only as `{dry_run: true}` in
  `infra/scripts/lib/ops-invoke.mjs`: `origin_ops` (every `ops`-origin
  row by subject type and status), `subjects` (the active ones),
  `would_stop_count` / `stopped_count` by kind, and the kind and tag list.
  The write runs each subject through the claims reconcile, as
  `{agent_recordings}` does.
- `apps/site/src/docs/recording.md`: the `ops` row of the reasons table.

## The questions, and the answers taken

1. **Does anything still mint `ops`?** No. No op or code path inserts it;
   the 0042 backfill (`update recording r set origin = 'ops'`) was its only
   writer. `account_track` and `account_enroll` write claims through
   `addPlayer` (origin `claim`); their `via: "ops"` is who acted, not a
   reason, and stays.
2. **What happens to subjects recorded only under `ops`?** They become
   untracked: their recording stops, and the trim (#528, not built) decides
   their history. Stopping deletes nothing. [Jamie, 2026-10-12, the issue]
3. **When do they stop?** The reconcile runs only when a subject's
   tracking changes (a claim, a clan add or removal, an agent suspended or
   an account removed), so an `ops`-only subject nobody touches stays
   active and keeps being polled. `{ops_recordings: {dry_run: false}}`
   settles them in one transaction; it is a production write, so wave 1
   does not run it [engineering]. Authority: Jamie.
4. **A tracked subject whose row says `ops`?** It keeps recording, at the
   widest scope still asked for, and its row keeps the `ops` label; the
   origin says who started a row, and the reasons decide whether it runs
   [engineering]. No relabel (that would be a write).
5. **The check constraint** (`0068_rankings_recorded.sql:382`, `origin in
   ('claim', 'ops', 'collection', 'ranking')`) still allows `ops`. Left
   alone: wave 1 has no migration, and stopped rows keep the label as
   history. Tightening it is an optional later migration, after a relabel
   of the remaining rows [engineering].
6. **Contract?** Nothing documented lists `ops`: no tool argument, no
   `/api/v1` schema, no OpenAPI enum. No bump.

## Census

Run after the deploy with `npm run op -- '{"ops_recordings": {"dry_run": true}}'`
(a read), after the deploy of 42d4ea64 on 2026-10-12:

| `subject_type` | `status` | rows with origin `ops` |
|---|---|---|
| player | any | 0 |
| clan | active | 1 |
| clan | stopped | 10 |

`subjects` 1; `would_stop_count` `{player: 0, clan: 0}`: the one active
`ops` clan is still tracked, so it keeps recording. The 2026-10-07
relabel did cover every player; the 0042-era clan rows are stopped
history. Nothing is left for `{ops_recordings: {dry_run: false}}` to do.
Tags are not written here.
