# Elixir notes

Working notes: what is open, what is queued for Jamie, and dated entries
for the reasoning behind a change. What still stands is
`docs/DECISIONS.md`, one line per ratified decision and declined idea;
read it before proposing anything. Earlier entries are in git
(`git log -- docs/NOTES.md`); the last full version is at `bb01d62b`
(`git show bb01d62b:docs/NOTES.md`), and the weekly archives that sat
in `docs/notes/` are listed in `docs/archive/README.md`.

## Open and queued

One line per item: when it was raised, what it needs, and who owns it.
Remove a line in the change that closes it.

### Jamie

- 2026-09-28: retire `session_secret_previous` on or after 2026-12-27.
  Deploy with `--param=SessionSecretPreviousInSecret=false`, then remove
  the key in the console (`docs/SECRETS.md`). Jamie.
- 2026-10-08: `anthropic_api_key` in `elixir-mcp/app` is read by nothing
  and can be removed in the console; no deploy needed. Jamie.
- 2026-10-04: privacy.md still says AI models "write some of the mail"
  and help with feedback, which is the retired editorial claim; also
  decide whether to name Clan's own-key model flow. Product wording,
  Jamie.
- 2026-10-05: Ship It! and Elixir Kings report `channels_ok: 0`. Restore
  each ask-channel binding or permission, then restart only the repaired
  instance. Jamie (Operator follow-up).
- 2026-09-29: `min_client_version` is 2.0.30 with enforcement on. Raising
  it retires the pre-signing rollback lever. Jamie.
- 2026-10-07: beta invitations not sent. Open before inviting: a real
  inbox delivery and a natural first capture (a separately approved
  controlled fresh-person path); the acceptance plan awaits the exact
  inbox, player tag and baseline. Jamie.
- 2026-10-03: co-leaders' own sign-in, verification and model-status
  read-back, any reviewed historical manual-award reconciliation, and a
  bounded paid drafting attempt remain live checks. Jamie with the
  co-leaders.
- 2026-09-27: growth priorities, held: the saturation ladder and planner
  class order, a pre-reset watcher, the `MaxAllocatedStorage` ceiling
  (100 GiB in the template) and a written trigger for a larger database
  instance. Jamie.
- 2026-09-27: collector-fleet trust, held: where the collectors are and
  a second site, a written trust decision before an outside operator's
  collector goes `active`, shadow verification
  (`docs/COLLECTOR-ZERO-TRUST.md`), and off-account replication of the
  payload archive. Jamie.

### Engineering

- 2026-10-03: optional RDS downsizing (db.t4g.small, 20 GiB) waits a
  couple of weeks of measurements. Operator.
- 2026-09-28: one rate budget with no per-key pooling; revisit around
  2026-10-28. Operator.
- 2026-10-03: a recomposed closed week's collector credits can differ by
  one: it uses current lifetime points, not the period-end total.
- 2026-10-04: ordinary removal stays held until there is an all-mode
  coverage contract and receipt-bound counter tuples. Clan.
- 2026-10-05: membership counts changed while the join and departure
  lists were empty; cause unconfirmed. Data Auditor.
- 2026-10-05: a `live: true` race read that lands in matchmaking still
  says "The live fetch returned a payload our admission rejected."
  (`packages/tools/src/tools/shared.mjs`) and the receipt stays
  `rejected`.
- 2026-10-04: #292, Clan History browsing older recorded membership
  changes. Open.
- 2026-10-04: #296, slow warm Awards participation reads. Needs browser
  Network/Server-Timing evidence if it recurs.
- 2026-09-16: schema index diet, not started: drop
  `battle_participant_player` and `battle_participant_window`; a partial
  `clan_membership (clan_tag) where left_observed_at is null`; seed the
  Training Camp arena (54000001) and add the
  `player_snapshot_daily.arena_id` FK; `api_receipt.job_id` FK
  `on delete set null`; rename `poll_state.subject_tag` to `subject_key`;
  comments on the declined FKs.

### Parked, with their triggers

- 2026-09-27: measure with the `{statements}` op before changing any of:
  invoker fixed cost, a result cache, per-container connection reuse, MCP
  Lambda memory, the nightly and activity tidies.
- 2026-09-27: wait for scale: mail compose fan-out once a weekly run
  passes about 450 s; a split recording door.
- 2026-09-27: tool features, on a consumer ask: gaps as a precise
  control; an event as a population (`group_by: "event"`); a card's
  `changes[]` history; a supported-clients matrix.
- 2026-09-27: engineering system, when it pays: an ops registry with
  enforced modes, run receipts, scheduled CI with a pinned clock, a
  deploy batch marker, decision-citation tests, API Gateway managed
  overrides, a decisive smoke, e2e failure fixtures and router adoption,
  honest 404s, an `llms-full.txt` trim, a console bundle diet.
- 2026-09-27: low-value hardening: roster ordering, attested-fact extras.

## Entries

Newest last. Each entry is `## YYYY-MM-DD — title`, then what changed and
why. A ratified decision also gets its line in `docs/DECISIONS.md` in the
same commit.

## 2026-10-08 — internal docs describe the current state

The internal docs were trimmed to what is true now: `docs/EMAIL.md`
(six kinds, with `clan_actions_waiting` and the collector upgrade notice),
`docs/SECRETS.md`, `docs/COLLECTOR-ZERO-TRUST.md` and
`docs/RELEASING-COLLECTOR.md`. Finished reviews (`docs/reviews/`), the
archive bodies, the weekly notes (`docs/notes/`) and the retired
`docs/card-of-week/` and `docs/top100/` prompts were deleted; git keeps
them, and `docs/archive/README.md` maps each old path to the commit that
holds it. Their open items are the list above. Code comments that cited a
review section keep their substance without the citation; shipped
migrations and the changelog still cite the old paths.

## 2026-10-08 — the database goes back to db.t4g.micro

Jamie's call. The small (2026-09-23) carried a record the tracked-only
correction has since removed, while the reserved instance bought on
2026-09-07 is a micro: size flexibility made it cover half the small,
and the other half billed on demand (about $11.70 a month). Since the
correction: CPU about 5% average with credits at max, 0-2 connections,
reads in KB/s apart from a daily burst near 09:00Z, about 690 MB
freeable on the small.

The purge left the files five times the data. `{rewrite_table}` (VACUUM
FULL) ran on the small first, about 14:15Z, under the session lease:
`deck_card` 853 MB to 228 MB (6 s), `battle_participant` 2,235 MB to
210 MB (8 s), `battle_participant_card` 3,766 MB to 414 MB (22 s). The
database went from 8.2 GB to about 2.2 GB.

The deploy changes the class (a few minutes of downtime, single-AZ)
and lowers `elixir-mcp-db-freeable-memory` from 150 MB to 64 MB; the
old micro idled at 80-260 MB and would have held the 150 MB alarm.
shared_buffers stays the engine default. The micro's real limit is EBS
throughput: about 4.7 MB/s once the byte balance is spent, as the Gym
sweep did on 2026-09-23. Space heavy sweeps, backfills and full
acceptance runs; `elixir-mcp-db-ebs-byte-balance` (25%) says when not.
