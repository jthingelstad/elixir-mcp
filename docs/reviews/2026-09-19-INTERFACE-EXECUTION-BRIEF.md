# Execution brief: the interface after the record redesign (the 2026-09-19 review)

The prompt for the executing session. Fill in PHASE before use. One phase
per session; Jamie gates the next. Written for an Opus session that has not
read the review; the review is `docs/reviews/2026-09-19-INTERFACE-REVIEW.md`
and this brief names the part of it each phase executes.

---

PHASE TO EXECUTE: 1

Switch to ~/Projects/clash-royale/elixir-mcp. Claim the checkout lease
first (`node AGENT-TEAM/scripts/objective-lease.mjs claim session`). Read
AGENTS.md, docs/ENGINEERING.md ("Tool conventions" is the baseline every
change must keep), then docs/reviews/2026-09-19-INTERFACE-REVIEW.md: the
verdict, the fourteen verified defects, and the Part this phase names. Read
the "Contract 3.13.0" and "Time-series review, Phase 4" entries in
docs/NOTES.md (2026-09-18) for the shape a phase entry takes: what shipped,
what was measured live before and after, decisions taken inside the phase,
what the next phase needs. Follow that pattern.

This session executes the phase named above and stops. It does not start
the next phase. It ends with a NOTES entry, a clean worktree, the lease
released, and a short report to Jamie naming what he needs to do or decide
before the next phase can start.

## Product calls, asked of Jamie up front

Ask every call the phase depends on in ONE message before the first edit,
never mid-flight. Each carries the recommendation first and the trade-off
in a sentence. Phase 1 depends on none of them.

1. **Trophy band on the meta tools** (Phase 3). Recommend: add `trophy_band`
   as a dimension of `deck_meta_season` and `card_meta_season` (five bands ×
   mode groups, roughly five times the rollup rows, a few minutes more on
   the nightly rebuild) and as an argument on `battles_meta_decks`,
   `battles_meta_cards`, `cards_synergy`. Alternative: raw-scan only (8-15 s
   today, `query_timeout` late in a season). Decline: the "meta at my level"
   question stays unanswerable.
2. **Serve the collected record** (Phase 2). Recommend: all of it, additive,
   no migration: the 0131 battle facts on `battles_query` rows (~80 bytes per
   row at full verbosity), `war_period_log` as `days[]` on an exact
   `war_history` week, `clan_score` and `repair_points` on war standings and
   member weeks, the Path of Legends finals on `players_profile`, the clan's
   `type`/`location_id`/`description`, the three 0127 player counters,
   `closed_at`, the API's `period_type`. Any item declined is written into
   the manifest's reason string as "unserved by decision".
3. **One window grammar** (Phase 4). Recommend: the three series tools accept
   an instant and floor it to its game day, echoing the day in
   `applied.window` with a note, instead of refusing with `bad_request`.
   Trade-off: a silent floor could surprise; the echo and the note are the
   guard.
4. **A named reader pointer on `elixir_timeline`** (Phase 5). Recommend:
   `reader` (a short name, per account) selects a named cursor for
   `mark_read` and `read_to`, and `meta.timeline_pending` counts since the
   OLDEST named pointer. Trade-off: one small table and one argument against
   three agents polling an empty feed roughly 700 times a day and never
   seeing a true hint.
5. **The agent door's segment default** (Phase 3). Recommend: keep the 1.0.0
   rule (segment tools default to the corpus on every door) and add
   `segment: "mine"` sugar for the caller's clan plus a note when every
   returned row has `players: 1`. Alternative: default to the agent's clan
   on an agent connection (a semantic change; batched for the major).
6. **`game_events` on the game day** (Phase 4). Recommend: `game_days_seen`
   beside `days_seen`, the latter retired at the major. Alternative: keep
   UTC as the literal sighting day and say so in the glossary.
7. **The 4.0.0 batch and its window** (Phase 6). Recommend: a thirty-day
   deprecation window announced through `elixir_changelog` `breaking`
   entries and the What's-new list, elixir-bot's major pin bumped in the
   same week, discord's version DM as the second announcement. Alternative:
   defer the major until a second batch accumulates.

## Rules that stand

Additive by default: a field beside the old one, a note that fires on a
detected confound, never a rename outside Phase 6. Semver over the contract:
a field added is a minor with a `CHANGELOG` entry (`packages/contracts/src/changelog.ts`)
and a What's-new entry (`apps/site/src/_data/updates.js`) in the same commit;
a description-only change is a patch (it moves the tools fingerprint). Docs
ship with the change and every `docsRef` resolves before the pointer is
added (`services/mcp/test/docs-pointers.test.mjs`); the tool reference is
generated, never hand-edited. The conventions test
(`services/mcp/test/tool-conventions.test.mjs`) stays green and gains an
assertion for every convention a phase adds. Reuse `services/mcp/src/controls.mjs`;
never a per-tool copy of a control. Do not touch the collector, ingest
correctness or the schema; the one migration allowed in this plan is the
additive, non-rewriting kind named in Phase 3 (rollup dimension), and it is
its own item under the 0099 rule. One query at a time per client. Never
verify with writes against live; read-only ops and door reads only. `npm
run verify` before every push; assert HEAD moved after every commit. Deploy
is part of done: verify, deploy with `AWS_PROFILE=jamie` in the environment
(an `ExpiredToken` at the first STS call means Jamie must run `aws login
--profile jamie`; finish verify, commit, push, then ask once), then measure
the acceptance predicate live through the door and put the numbers in the
NOTES entry. Consumers are updated in their own repos and restarted AFTER
the deploy. Release the lease with a clean worktree.

## Sizing

Each phase is sized like a time-series phase: verify → deploy → acceptance
in one session. Phases 2 and 3 are the largest; if either runs long, stop
at the item boundary, deploy what is done (every item is independently
additive), write the entry, and name the remaining items for the next
session.

---

## PHASE 1: the fourteen defects (review "Verified defects")

**Goal:** every statement the code contradicts is fixed, nothing else moves.
**Depends on:** no product call. **Contract bump:** one minor (3.14.0) for
the added fields, carrying the patch-class description changes.

Items, each its own commit, in this order:

1. `war_history` exact-week roster path (defect 1). Cap the participant
   query at 60 rows when `season_id` is given (`tools/war.mjs:648`, the
   `limit 40` today applies only without it); compute `war_days_battled`
   and `war_days` in ONE pass over `warBattlesSql` for the week (a CTE
   grouped by player, joined to the participants) instead of two correlated
   subqueries per row; add `war_history` to the invoker's query-budget set
   (`services/mcp/src/invoker.mjs:350-352`). Add a general deadline: the
   invoker races every tool against Lambda's remaining time minus 1,500 ms
   and, on the deadline, writes the audit row with `error_code: 'timeout'`
   and answers `query_timeout` with the request id (review Part 7.1). Test:
   `services/mcp/test/war.test.mjs` seeds a 50-participant week and asserts
   the exact-week call returns `member_weeks` for every participant with
   `war_days` from both sources in under the budget; `invoker.test.mjs`
   asserts the deadline path writes the row and the code. Acceptance:
   `war_history({ season_id: 136, section_index: 0 })` for POAP KINGS
   answers under 5 s with 55 `member_weeks`; the audit row exists.
2. `war_current.next_war_day_opens_at` (defect 2). `services/mcp/src/war-period.mjs:40-43`
   computes the next war day to open after the current period on war days
   too (the same rule `game-clock.mjs:35-47` uses); both the top-level and
   the `period` field carry it. Test: `war.test.mjs` pins `war_current` and
   `game_clock` equal on a war day and a training day. Acceptance: on a war
   day, `war_current().next_war_day_opens_at` equals
   `game_clock().next_war_day_opens_at`.
3. `war_history.history_starts_at` (defect 3). Read `min(season_id,
   section_index)` over the clan's `war_week` rows regardless of the
   requested window (`tools/war.mjs:694-701`). Test: seeds four seasons,
   requests one, asserts the horizon is the oldest. Acceptance:
   `war_history({ seasons: 1 })` for POAP KINGS reports a season at or
   before 134.
4. `arena_id` on the battle row and the docs sentence (defect 4).
   `tools/battles.mjs:361` selects `b.arena_id`; the row carries `arena_id`
   beside `arena`; `output-schemas.mjs` `battles_query` declares it;
   `apps/site/src/docs/battles.md` says "`arena` the arena's name and
   `arena_id` its id (the higher side's arena, stamped at battle time)".
   Test: `battles.test.mjs` asserts the id on a seeded row. Acceptance:
   `battles_query({ limit: 1 })` carries `arena_id: 54000142` for King Thing.
5. The instructions' `source` list (defect 5): `services/mcp/src/protocol.mjs:80-82`
   names all five values. Test: `protocol.test.mjs` asserts the instruction
   text contains every value of the output schema's `source` enum.
   Acceptance: `initialize` text contains "season" and "fixed".
6. `clans_standings.percentile` (defect 6): serve it per ranked member from
   the formula the note states (`tools/clans.mjs:112-115`); output schema
   gains it. Test: pins `percentile` for rank 1 = 1 and the last rank.
   Acceptance: live `clans_standings({ days: 7 })` rows carry `percentile`.
7. One lifetime shape (defect 7): `players_profile.snapshot.lifetime` gains
   the snake_case keys beside the camelCase ones (`snapshot-columns.mjs:113-125`
   renders both; the camelCase set is retired in Phase 6); the output schema
   allows both. Test: the 3.11.1 null-shape test extended. Acceptance:
   `players_profile()` carries `snapshot.lifetime.battle_count` and
   `.battleCount` with equal values.
8. `retry_after_s` on `live_pending` (defect 8): `ToolFailure` gains an
   optional `data` object rendered as `error.retry_after_s`
   (`tools/shared.mjs:511-516`, `tools/live.mjs:63-67`, `invoker.mjs`
   error rendering); `protocol.md` "Errors" says the field. Test:
   `live.test.mjs` asserts the field on the refusal. Acceptance: a
   `clans_roster({ clan_tag: <an unrecorded clan>, live: true })` refusal
   carries `error.retry_after_s` as an integer (read-only: the live lane is
   charged once; use a clan already queued, or assert on the captured shape
   from the unit test if no unrecorded clan is at hand).
9. `clans_timeline` `members_seen` note (defect 9): the note says the count
   includes members who left that day and can exceed `members`
   (`tools/series.mjs:198-200`). Acceptance: the note text on a live call.
10. `collection_level` zeros (defect 10): a read-only migrate op
    `{lifetime_zero_census}` counts `player_snapshot_daily` rows with
    `collection_level = 0 and profile_observed_at is not null` by `source`
    and by month, and reports whether the archived payload for the row's
    receipt carries `collectionLevel`; then `{lifetime_zero_repair}` (dry run
    by default) nulls the column where the payload had no key. Both keyset,
    short transactions. Acceptance: the census before and after in NOTES;
    `players_timeline({ weeks: 6, granularity: "week", metrics:
    ["collection_level"] })` for King Thing carries `null`, not `0`, on
    August rows.
11. `completeness_note` fires (defect 13): `buildMeta` (`tools/shared.mjs`)
    sets `meta.completeness_note` for a player subject when the window ends
    inside the last seven days and `coverage.mjs`'s last-7-day ratio (one
    indexed read of the two newest profile rows and the battle count between
    them; cache nothing) is below 0.9 or unknown with an unmeasured tail over
    48 hours. Test: `coverage.test.mjs` seeds an incomplete interval and
    asserts the note on `battles_performance`. Acceptance: a player with a
    known gap (the census names one) carries the note on `players_summary`.
12. `rankings_timeline` description (defect 14): "one snapshot a day since
    the afternoon of 2026-09-11 (hourly before, for the global board)".
    Patch-class.
13. Description length (defect 12): the conventions test asserts `<= 600`;
    the six over it are trimmed to the load-bearing sentences (what it is,
    the default, what compact drops, the one caveat); the rest moves to the
    docs page the tool's `docs` pointer names. Patch-class.
14. `average_ratio` (defect 11): `responses.md` and the output schema
    description say it is a string until 4.0.0; Phase 6 makes it a number.

Docs in this phase: `battles.md` (arena), `protocol.md` (`retry_after_s`),
`responses.md` (`completeness_note` now fires; `average_ratio`),
`recording.md` daily-series (`members_seen`), one What's-new entry.
Consumers: `clan.poapkings.com` `services/api/src/manage/recruit.mjs:37`
and `scout.mjs:56-59` read `error.retry_after_s` (restart the Lambda after
the deploy); `elixir-bot` `capabilities/mcp_stats.py:160` may read
`percentile` instead of deriving it (its choice; no restart needed).

**Leaves for the next phase:** everything additive.

---

## PHASE 2: the record reaches the wire (review Part 1.3)

**Goal:** every collected column an agent would ask about is served, on the
tool that owns the question, without a migration. **Depends on:** product
call 2. **Contract bump:** minor (3.15.0).

Items:

1. `battles_query` rows (full verbosity) gain `context: {event_tag,
   tournament_tag, ladder_tournament, hosted, deck_selection}` and, when
   `type_class = 'boat'`, `boat: {side, towers_before, towers_after,
   remaining}` (`tools/battles.mjs:360-364,444-470`); compact keeps
   `deck_selection` only. Output schema updated. Test: a seeded event
   battle and a boat battle. Acceptance: a King Thing `riverRacePvP` row
   carries `context`, a `boatBattle` row carries `boat`.
2. `war_history` with `season_id` + `section_index` gains `days[]`
   `{war_day, period_index, standings: [{clan_tag, name, points_earned,
   progress_start, progress_end, progress_earned, end_of_day_rank,
   defenses_remaining, progress_from_defenses}]}` from `war_period_log`;
   `war_current` gains `days_closed[]` in the same shape for the running
   week. Test: seeded log rows. Acceptance: POAP KINGS S136 week 0 carries
   four days.
3. `war_current.standings[]` and `war_history.member_weeks[]` gain
   `clan_score` and `repair_points`; `war_rivals` rows gain `clan_score`
   (latest observed). Acceptance: live values on the current bracket.
4. `players_profile.path_of_legend.seasons[]` (last twelve finals:
   `season_month, league, trophies, rank`) from `player_pol_season`.
   Acceptance: a ranked member (MONICA, `#VGC22YGP`) carries at least one.
5. `players_profile.attributes` and `clans_roster.lifetime` gain
   `war_day_wins`, `clan_cards_collected`, `legacy_trophy_road_high_score`
   (`recorded-profile.mjs:6-9`, `tools/clans.mjs:380-401`).
6. `clans_roster` header gains `type`, `location_id`, `description`;
   `clans_timeline` metric enum gains `type` and `location_id`
   (`tools/series.mjs:46-70`; the select already fetches them).
7. `war_history.weeks[]` gains `closed_at` beside `finished`;
   `war_current.period` gains `api_period_type` from `poll_state`.
8. `battles_query` rows gain `mode_group` (the contract fold of `type`) so
   no consumer re-implements `MODE_GROUP_BY_TYPE`
   (`clan.poapkings.com` `manage/scout.mjs:72-75`).

Docs: `battles.md` "What a battle record holds" (the new objects),
"War weeks, points and fame" (days, clan_score, repair points),
`recording.md` (what a clan row and a PoL final carry), glossary entries
for `clan_score`, `repair_points`, `deck_selection`; What's-new. Tests: the
tools' own suites plus `output-schemas` validation. Consumers to update:
none required; `clan.poapkings.com` scout may read `mode_group` and drop its
fold (restart its Lambda if changed).

**Leaves for the next phase:** the controls.

---

## PHASE 3: the control next to every number (review Part 4)

**Goal:** every tool that serves a rate, trend, rank or sum carries the
control the 3.13.0 principle names, from `controls.mjs`. **Depends on:**
product calls 1 and 5. **Contract bump:** minor (3.16.0); one additive,
non-rewriting migration if call 1 is yes.

Items:

1. `controls.mjs` additions: `coverageBasis(db, clanTag)`,
   `singlePlayerNote(rows)`, `colosseumMix(weeks)`, `zeroSeriesNote(points,
   field)`, and `modeSplit` accepting the daily rollup's per-group rows.
   Test: `controls.test.mjs` extended for each.
2. `players_summary`: `last_30_days.modes`, `top_deck.modes` +
   `dominant_mode`, `trophy_floor` (reuse `trophyFloor`). Acceptance: King
   Thing's summary carries `trophy_floor.floored: true` and the Hogs deck's
   `modes.ladder`.
3. `clans_standings`: per member `modes`, `ladder_battles`, `mean_level_gap`,
   `recorded_since`; response `comparable`; `trophy_net` reads `null` when
   `ladder_battles` is 0 (a null replacing an ambiguous 0 on a field the
   docs never defined as a sum-or-zero: additive in meaning, say it in the
   changelog). Acceptance: live `comparable: false` with the note naming
   two members whose dominant modes differ.
4. `battles_trends`: `partial`/`covers` on clipped weeks (`markPartialWeeks`),
   `modes` per week, `source` when a week holds imported rollup keys.
   Acceptance: the current week carries `partial: true`.
5. `battles_meta_decks` / `battles_meta_cards`: per row `modes` (rollup path:
   the per-group rows; raw path: one group-by) and `mean_level_gap` (raw
   path: the lateral avg; rollup path: a nightly column added by the
   additive migration named below), response `comparable` and the pooled
   note; the single-player note on a segment. If product call 1 is yes:
   migration `01xx_meta_trophy_band.sql` adds `trophy_band` to the two rollup
   keys as a nullable column (instant), `meta-rollup.mjs` fills it on the
   next nightly rebuild (no backfill op needed: the running season is
   rebuilt nightly and ended seasons are refilled by the same job within
   its budget), and the three meta tools take `trophy_band`. Acceptance:
   corpus `battles_meta_cards({ mode: "ladder" })` rows carry `modes.ladder`
   and `mean_level_gap`; with the band, `trophy_band: "11000_13000"` answers
   from the rollup under 2 s.
6. `clans_pilot_scores`: per member `mean_starting_trophies`, `modal_arena`,
   a note when the modal arena inside the window differs from the member's
   current arena.
7. `clans_participation`: per member `log_recorded`, `recorded_since`,
   `last_battle_time_in_clan`; per war week `war_days_battled`; clan-level
   `basis`. Acceptance: an activity-scope clan (`#G89QUY2P`) answers
   `basis: "roster_and_war_only"` and `log_recorded: false` on every member.
8. `clans_timeline`: `members_with_profile`; `war_rivals`: `colosseum_races`;
   `rankings_timeline`: the zero-series note; `rankings_clans`: the field
   size counted over.
9. `segment: "mine"` sugar on the six segment tools (product call 5).

Docs: `battles.md` "The control next to the number" gains the new carriers;
`methodology.md` the meta rows' controls and the band; `recording.md`
participation-by-week (`basis`, `log_recorded`); What's-new. Consumers:
`elixir-mcp-discord` `agent/routines/meta-report.md:18` drops "be honest
about sample size" in favour of reading `comparable`; `clan.poapkings.com`
engine may read `war_days_battled` instead of spreading (`facts.mjs:45-74`)
and `log_recorded` instead of scoring an unrecorded log as complete; restart
both after the deploy.

**Leaves for the next phase:** grammar and docs.

---

## PHASE 4: one grammar, one vocabulary, the docs corpus (review Part 2, 3.2)

**Goal:** the same words mean the same things on every tool, every window
says its season, every point has the one shape, and the docs an agent reads
describe the record that exists. **Depends on:** product calls 3 and 6.
**Contract bump:** minor (3.17.0).

Items:

1. Season echo on every windowed tool: `resolveWindow` computes `season`,
   `crosses`, `season_age_days` for every instant window (two reads on
   `season`), so `battles_query`, `_performance`, `_decks`, `_cards`,
   `_opponents`, `_compare`, `clans_standings`, `battles_levels`,
   `clans_pilot_scores`, `rankings_timeline`, `elixir_timeline` carry them;
   the crossing note fires only when `crosses` is non-empty. Test: the
   conventions test asserts every windowed tool's `applied.window` carries
   `season`. Acceptance: `battles_decks({ days: 60 })` carries one crossing.
2. `season` argument on the player battle tools and `clans_standings`
   (`SEASON_ARG_SCHEMA`), so "this season" is one argument everywhere.
3. One window grammar (call 3): `dayWindow` accepts an instant, floors it
   to `gameDay()`, echoes the day and a note. `clocks.md` "Windows and
   timezones" gains the series tools' row ("days: N is N game days, today
   included").
4. The one point vocabulary: `players_timeline` adds `day` beside `date`;
   `rankings_timeline` points add `day`; `battles_levels` monthly points add
   `partial` on the edge months; `clans_participation` echoes
   `applied.window.source: "default"` when `weeks` was defaulted; `game_events`
   adds `game_days_seen` (call 6); `clans_roster.lifetime` adds
   `profile_observed_at` beside `as_of`; `clans_participation` notes say
   `war_points` = `points`.
5. Descriptions: `players_timeline`'s `metrics` description names the
   groups (roster / lifetime / Path of Legends / seasonal) and the default;
   `battles_performance` `group_by` description says "mode: the named game
   mode (not the mode group)"; `clans_members_timeline` `limit` says the
   order and how to choose; `rankings_players` says `rating` is the profile's
   `pol_trophies` once the open question is settled (one `npm run cr` pair
   on a ranked player; write the answer into `cr-agent-api-docs` and push).
6. The docs corpus: `choosing-a-tool.md` names every tool in the question
   table (a fourth sequence, "how have I moved": `players_timeline` →
   `battles_performance group_by: week` → `battles_levels`; a line "read
   `comparable` before ranking"); `glossary.md` gains game day, series,
   stamp (`observed_at` and its siblings), `source`, `kind` (the five),
   progress bucket, manifest, control, `comparable`, floor, the four trophy
   kinds, `league_number`/`pol_league`, `clan_score`; `methodology.md:101`
   drops the exemplar sentence; `responses.md` corrects the
   `timezone_applied` boundary and describes `read_to: null`; `activity.md`
   says the year graphic is on UTC days and why (Tier 2, 3.3);
   `agents.md` and `timeline.md` describe the per-kind `facts` keys (the
   discord editor brief carries them today); `quickstart.md`, `about.md`,
   `verify.md`, `connections.md`, `limits.md`, `architecture.md` are re-read
   against 3.17.0 and dated in their front matter.
7. The instructions: the live-lane paragraph shortened to one sentence; the
   `completeness_note` sentence kept now that it fires.

Tests: `docs-pointers.test.mjs` (every new pointer), the conventions test,
`tool-surface` snapshot. Consumers: `elixir-mcp-discord` `agent/routines/war-deck-check.md:10-14`
drops the retired anchor rule and arms on `war_day_closes_at` only;
`elixir-bot` `mcp_stats.py:55-66` may pass `metrics` and drop the
`points|series` hedge; restart discord after the deploy.

**Leaves for the next phase:** the seam and the consumers.

---

## PHASE 5: the seam (review Part 3.2, Part 6, Part 7)

**Goal:** the things consumers work around are served, and the log can
answer the questions this review could not. **Depends on:** product call 4.
**Contract bump:** minor (3.18.0).

Items:

1. `elixir_timeline` empty path: `{explain_timeline}` op (Part 7.6) on the
   POAP KINGS agent's exact call (`from`, 17 kinds, full verbosity); the
   index or the early exit that makes an empty window answer in under 200
   ms; the named `reader` pointer (call 4) with `timeline_pending` against
   the oldest named pointer. Acceptance: the same call in the captures
   (`e3ab3573`'s arguments) answers under 500 ms db; `meta.timeline_pending`
   on the agent's `game_clock` call reads 0 after its reader has read.
2. Error classes: every code in `packages/contracts/src/errors.ts` gains a
   `class: "retry" | "input" | "subject" | "server" | "budget"` exported as
   `ERROR_CLASS`; the error body carries `class`; `protocol.md` "Errors"
   lists it. `live_pending` and `query_timeout` are `retry`; `internal` is
   `server`. Consumers: `elixir-mcp-discord` `src/feedback.js:171-185`
   treats `retry` as expected (no footer, no sweep); `elixir-bot`
   `elixir_mcp.py:111-126` may branch on it.
3. `no_subject` carries `candidates[]` when `on_behalf_of` is unmapped and
   the surface name (a new optional `display_name` argument on the subject
   tools, or the `on_behalf_of` id's suffix) matches one or more clan
   members by whole name (the `players_search` ranking); the discord
   first-contact recipe (`src/prompt.js:129-152`) collapses to reading it.
4. `outputSchema` for `elixir_my_feedback`, `rankings_players`,
   `war_history`, `battles_meta_cards`, `battles_meta_decks`,
   `battles_levels`, `clans_participation`.
5. Observability: `{audit_census: {from, to}}`; resource and prompt reads
   audited as their own surface; `{refusal_census}` over captures for
   `invalid_tag` (the 58 elixir-bot `war_history` refusals); `{controls_census}`
   over captures (fired / total per control and the follow-up call's
   arguments).
6. `elixir_feedback` accepts `request_ids[]` beside `request_id` (a turn has
   many); discord's praise reaction files the relevant ones.
7. The person door's default clan is the primary player's clan (the
   `identity.mjs` ordering already prefers it for the instructions; make
   `entitledClan` agree), so `clan.poapkings.com` `handler.mjs:489-491` can
   stop pinning the tag.

Docs: `protocol.md` (error classes, `candidates`), `agents.md` (the reader
pointer, the shorter first-contact exchange), `timeline.md`; What's-new.
Consumers to restart after the deploy: all three discord instances
(`launchd com.poapkings.elixir-mcp-discord` and the two siblings), the Clan
Lambda.

**Leaves for the next phase:** the renames.

---

## PHASE 6: 4.0.0, the batched major (review Part 5.3)

**Goal:** the names and shapes the additive phases doubled are settled to
one. **Depends on:** product call 7. **Contract bump:** major, with the
deprecation window announced at the START of the window (an `elixir_changelog`
entry with `breaking` naming every rename and the removal date, a What's-new
entry, and the old and new fields served side by side until the date).

At the end of the window, in one deploy: remove `players_timeline.series[].date`;
`battles_query.arena` becomes `{id, name}`; the camelCase lifetime block
goes; `group_by: "mode"` goes (`"game_mode"` stays); `clans_standings.trophy_net`
→ `net_trophies`; `pol_league` and `league_number` → one name;
`clans_participation.weeks[].complete` → `partial`; `elixir_coverage.average_ratio`
numeric and `incomplete_days` removed; `war_current.nominal_period_elapsed`
removed; `game_events.days_seen` removed if call 6 was yes; consider
`elixir_feedback` → `elixir_send_feedback` under the write-tool naming rule.
Update the `CHANGELOG` `breaking` entry, the docs pages, the output schemas,
the tools reference; bump `elixir-bot`'s `PINNED_CONTRACT` to "4"
(`elixir_mcp.py:40`) in the same week and restart it; discord's version DM is
the second announcement. Acceptance: `tools.json` at 4.0.0; every retired
name absent from a live read of each tool; `elixir_changelog({ since:
"3.18.0" })` carries the `breaking` text.

---

## What to put in the report at the end of every phase

What shipped (commit ids, the contract version, deploy time); what was
measured live before and after, read-only, including the acceptance
predicate's exact call and the field or note it found; decisions taken
inside the phase and why; anything pushed to `cr-agent-api-docs`; anything
left out and why; which consumers were updated and restarted; and exactly
what Jamie must do or decide before the next phase, or "nothing manual,
needs your go".

## The NOTES entry Phase 1 transcribes first

Under `## 2026-09-19 — Interface review after the record redesign
(recommendations)`: the review and this brief exist beside the schema and
time-series pair; fourteen verified defects, the census (131 served / 33
unserved of 165 manifest targets; `player_pol_season` and `war_period_log`
unread), the eight journeys (scores 2 to 4.5; `war_history`'s exact week
times out; "the meta at my level" has no answer), the control matrix, the
seven product calls; nothing applied. Then the phase's own entry below it.
