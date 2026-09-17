# Execution brief: time-series capture (the 2026-09-18 review)

The prompt for the executing session. Fill in PHASE before use. One phase
per session; Jamie gates the next.

---

PHASE TO EXECUTE: 1

Switch to ~/Projects/clash-royale/elixir-mcp. Claim the checkout lease
first (AGENT-TEAM/scripts/objective-lease.mjs claim session). Read
AGENTS.md, docs/ENGINEERING.md, then docs/reviews/2026-09-18-TIME-SERIES.md
in full: "Read this first" carries the decisions, Parts 3 to 7 the design
with its DDL, Part 5 and 6 the ops, the Sequenced plan the phases. Read
the five "Schema review, Phase A-E" entries in docs/NOTES.md (2026-09-17)
for the shape a phase entry takes: what shipped, what was measured live
before and after, decisions taken inside the phase, what the next phase
needs. That is the pattern to follow.

This session executes the phase named above and stops. It does not start
the next phase. It ends with a NOTES entry, a clean worktree, the lease
released, and a short report to Jamie naming what he needs to do or
decide before the next phase can start.

DECISIONS ALREADY MADE; apply them, do not reopen them. Jamie, 2026-09-17:
the day is the game's day (UTC, anchored on the 10:00Z reset; game_day()
in 3.1); day grain only, last observation wins under the observed_at
guard, with pre_reset and season_roll kinds; history import is in scope
and is the validation; poapkings.com moves onto Elixir last; the metric
set of decision 5; multi-clan by construction. And after the review: (1)
player_snapshot_daily moves to the game day in Phase 1 before anything
else writes to it; (2) every member of every polled clan gets a
roster-written row on player_snapshot_daily, no branch on tracking; (3) a
progress bucket with trophies 0 and bestTrophies 0 writes no row; (4) the
field manifest per projector with its fixture test, the nightly
out-of-band shape census filing into the feedback queue under surface
`recorder`, and the metric, with nothing on the ingest path and no email.
Profile and roster polling cadences are NOT changed by this work; that
belongs to the adaptive-polling work on the play-time histogram.

RULES THAT STAND. Migrations are ordered SQL applied by the migrate
Lambda at deploy, expand-and-contract, instant: a migration never
rewrites a large table and anything over a few thousand rows is a
keyset-batched op in short transactions. The ingest invariant: a poll
whose values did not move writes nothing; every upsert is guarded on its
own columns and its own timestamp; every projector returns facts.
Canonical tables are lossless; tools never read api_payload. One query at
a time per client. Docs ship with the change: the site docs, the
What's-new list and the contract CHANGELOG in the same commit; contract
changes are semver; docs pointers resolve before they are added. Anything
learned about the game or its API that holds for any caller goes to
../cr-agent-api-docs and is pushed. Never verify with writes against
live; read-only ops only. npm run verify before every push; assert HEAD
moved after every commit. Deploy is part of done: verify, deploy with
AWS_PROFILE=jamie in the environment, then measure the result live and
read-only through the migrate Lambda's ops and the MCP door, and put the
numbers in the NOTES entry. Release the lease with a clean worktree.

DOWNTIME. Jamie, 2026-09-17: some downtime is acceptable, this is active
development. That means a deploy in the middle of the day is fine, an op
may hold the migrate Lambda for as long as it needs (a deploy's migrate
invoke returns 429 and waits; drive the op to completion first rather
than interleaving), and the snapshot re-key may take the table through a
short window where readers see a partial day. It does not relax the rules
above: no ACCESS EXCLUSIVE lock held across a scan, no large rewrite
inside a migration (0099 took the door down for 35 minutes; the shape
that follows is in ENGINEERING.md). Take an RDS snapshot before the
re-key op and before the first backfill, named for the phase, as on
2026-09-15.

PHASE 1: the tables, the live writers, the day, the manifest. In this
order, each step its own commit, deploys where marked.

1. game_day(timestamptz) as an immutable SQL function (review 3.1), with
   a test pinning it against war_period.starts_at for every seeded row.
2. The snapshot re-key: a read-only {snapshot_day_census} op that reports,
   for player_snapshot_daily, how many rows change day under
   game_day(observed_at), how many collide (two UTC-day rows onto one
   game day) and which observation would win, per kind; run it live
   first and put the numbers in NOTES. Then {snapshot_rekey}, a
   keyset-batched op (per player, ~500 players a batch) that
   deletes-and-reinserts under the new key, collision resolved by the
   later observed_at, and reports what it moved and dropped. The column
   keeps its name; its meaning changes; every reader of snapshot_date
   (review 3.2 lists ten) is checked and the players_timeline note
   changes from UTC dates to the game day. Deploy the projector change
   (snapshots.mjs keys the day by game_day(fetchedAt) and the kinds
   likewise) in the same deploy the op runs after, so no UTC-day row is
   written again.
3. Migrations, all instant, in the review's DDL (4.2, 4.1, 4.3, 4.4):
   the roster columns on player_snapshot_daily (clan_tag, clan_rank,
   previous_clan_rank, game_last_seen_at, profile_observed_at, source)
   and the partial index (clan_tag, snapshot_date); the profile's lifetime
   and state columns (total_donations, challenge_cards_won,
   challenge_max_wins, tournament_cards_won, tournament_battle_count,
   king_tower_level on the snapshot; war_day_wins, clan_cards_collected,
   legacy_trophy_road_high_score on player; type, location_id,
   description on clan); clan_snapshot_daily; player_progress_daily;
   player_pol_season; war_period_log; the nine nullable battle columns;
   series_backfill_state; the feedback.surface check widened by
   'recorder'. Re-pin the schema fingerprint from a fresh scratch build.
4. The writers. Split each projector into a series half the live path
   and the backfill both call: projectClanSeries (the clan row, and the
   roster columns of every member's snapshot row, one unnest upsert in
   tag order, guarded on the roster's columns and observed_at only, with
   the hour-grain rule for a poll that moved only game_last_seen_at, and
   the pre_reset and season_roll rows inside their windows);
   projectPlayerProgress (the buckets, the "" key admitted into
   mode_season, the zero-bucket rule); the snapshot upsert gaining the
   new columns and setting profile_observed_at (its guard now on the
   profile's columns and profile_observed_at, still advancing
   observed_at); the frozen counters on player written when they differ;
   player_pol_season fill-once under the season whose ends_at is the
   latest at or before the poll; the race projector writing
   war_period_log fill-once scoped to its section, and the rivals'
   clan_score, repair_points and badge_id; the log projector writing
   decksUsedToday into war_attendance_day for the last war day. Every
   one returns facts. Tests: each writer's four-poll guard sequence
   (first write, identical repeat writes nothing, a moved value writes,
   an older observation replayed writes nothing), the two-writer case on
   the snapshot row (a roster write after a profile write moves trophies
   and leaves wins and profile_observed_at alone), the kinds, the
   zero-bucket rule, and a pipeline test through processResult for a
   roster and a profile fixture. Deploy. Measure live: {tables} for the
   new tables and the snapshot table's row and update counts an hour
   later; clans_roster and players_profile still answer identically;
   a receipt's new_facts on a roster poll now counts the members that
   moved.
5. The manifest and the census. services/ingest/src/payload-keys.mjs,
   one entry per field per endpoint with a disposition (the review's
   Part 2 is the content; Appendix D the key sets), the fixture test
   that fails on an unnamed field or an entry without a disposition, the
   reasons for expLevel, the clan-chest trio, state and
   currentWinLoseStreak written there. {shape_census} in the jobs Lambda
   after the nightly sweep: twenty of the day's archived objects per
   endpoint, new fields and fields absent for seven days, each finding
   filed once into feedback under the owner account (category
   data_quality, surface recorder, the context of review 2.7),
   deduplicated on (endpoint, path) while an item is open, and the
   ElixirMCP/Record PayloadShapeFindings metric. A line in
   AGENT-TEAM/close-the-loop.md saying what a recorder item is and that
   it becomes a change: the manifest entry and projection, the contract
   bump, the docs, the cr-agent-api-docs entry. The rule's text in
   docs/ENGINEERING.md under Ingest invariants, as written in 2.7.
   Deploy. Run the census once by hand and report what it filed; on a
   correct manifest the first night files nothing.
6. The NOTES entry, the report to Jamie: what shipped, the live numbers,
   decisions taken inside the phase, and that Phase 2 (the backfill
   from the archive, review Part 5) needs only his go.

PHASE 2: the backfill from the archive (review Part 5): {series_backfill}
by lane, receipt-ordered, keyset-resumable, driven to completion by a
local loop with the migrate Lambda held; the clan lane then the player
lane; then the battle columns' fill from the battlelog receipts; then a
read-only census proving every admitted roster receipt since 2026-03-12
has its day rows. Take the RDS snapshot first. Report the object counts,
the wall time and the row counts against the review's estimates.

PHASE 3: the elixir-bot import and the validation census (review Part
6): the {replay} of the bot's 5,488 profile payloads for 2026-07-15 to
09-03 under the backfill gateway first; the export script reading
elixir-v51.db read-only into the documented intermediate; {series_import}
into staging; {series_census} over every overlapping day; commit of the
non-overlapping rows and the rollup keys the record lacks; the census
numbers in NOTES. elixir-bot itself is not touched. Tell Jamie to revoke
the backfill gateway row afterwards.

PHASE 4: the readers (review Part 7): the two docs sections first,
players_timeline extended, clans_timeline and clans_members_timeline with
output schemas, the clans_roster lifetime block, the rankings_timeline
description, one minor contract bump with its changelog and What's-new
entry, the tools reference regenerated. Ask Jamie to read the tool names
before the bump.

PHASE 5: poapkings.com onto Elixir, in its own repo under the domain
lease, on the clan token Jamie issues (review 7.5 and the plan row):
the build sources everything from the four tools, its CR API calls and
local SQLite retire, OPERATOR.md is rewritten, the dead crontab line on
Jamie's host is removed or repointed.

WHAT TO PUT IN THE REPORT AT THE END OF EVERY PHASE. What shipped (commit
ids, migrations, deploy time); what was measured live before and after,
read-only; decisions taken inside the phase and why; anything pushed to
cr-agent-api-docs; anything that was left out and why; and exactly what
Jamie must do or decide before the next phase, or "nothing manual, needs
your go".
