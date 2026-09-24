# Elixir MCP notes

Working notes and decisions for **the current ISO week**, newest last.

- **What still stands:** `docs/DECISIONS.md`, one line per ratified
  decision and declined idea. Read it before proposing anything; don't
  re-litigate what it lists.
- **Earlier weeks:** `docs/notes/<year>-W<nn>.md`, unchanged. Search by the
  heading date a decision or commit names.
- **Rotation:** the first entry of a new ISO week moves the previous week's
  entries into `docs/notes/<year>-W<nn>.md` verbatim. A ratified decision
  also gets its line in `DECISIONS.md` in the same commit that records it.

Queued manual steps for Jamie still live in the entry that raised them.

---

## 2026-09-21 — The session clock's first full day (acceptance read, part two)

Read 05:41–06:05Z, the 09-20 row an hour old (`capture_efficiency_daily`,
computed 05:20:27Z), with `{poll_replay: {days: 1, cutoff}}` (deployed
2f1fa58 for this read: the gapped intervals' loss split by whether their
newest gap fell before or after an instant), the ledger and bucket
metrics for the day, and `{stats}`. Baselines are the three pre-clock
days (09-16/17/18): 313 reads/hr, 61% empty, ~22,000 captured a day,
101–121 gaps, 513–646 lost on ~90 players.

**Verdict: above the bar.** The clock's own loss on its first full day
is **at most 70 battles, 0.26% of 26,849 captured**, against 513–646
(2.3–2.9%); gaps **9** against 101–121 (−92%); reads 16,949, 706/hr
(2.26×, under the replay's 835); `PlannedJobs` ~900/hr in ordinary
hours (+38%); the live reserve never touched except where it always is.

**The row, and why it says 409.** `lost_battles` 409 on 66 players is
the day the intervals ENDED, not the day the loss happened: a profile
interval is a day long (median 26 h), so an interval ending on 09-20
morning holds 09-19's evening — the old clock's last hours and the
surge that read everyone at once and collected every gap the old clock
had left. Split by the newest gap inside each interval: **60 intervals
whose gaps fell on 09-19 carry 340 of the 409; 7 intervals whose gaps
fell on 09-20 carry 70** (shortfall 79 on expected 978, noise 0.9%
off). Even that 70 is an upper bound: an interval with a gap on both
days lands in the 09-20 bucket with its whole shortfall. The 9 gaps
themselves are 9 of 16,873 audited reads, 0.05%; on the replay's own
footing the day held 19 intervals over 25 battles, against the
replay's prediction of 9 for a week at this ceiling and 1,041 for a
week of the old clock. Captured battles went UP, 22,000 → 26,849 a day,
a Sunday and a schedule that misses less. Tomorrow's row (09-21,
landing 05:20Z 09-22) is the first whose intervals start after the
switch and will read the loss straight; expect it under 100 on under
10 players with no split needed.

**Spend, settled.** `PlannedJobs` per hour on 09-20: 764–974 in
ordinary hours (mean ~900 against ~650 the week before), 1,236 in the
10:00Z board hour, and **1,904 at 23:00Z** — the Monday-00:10Z
pre-reset watcher forcing 817 profile reads in the hour before the
donation reset, as it does every Sunday night; the bucket's minimum
read 30 (the live reserve) in exactly those two hours and 180–218 in
every other, so the clock never competed with the live lane. Day
total 23,802 planned. `SessionFollowupJobs` 225/hr (a quarter of the
reads are a player mid-sitting), `RequestedProfileJobs` 39/hr (the
after-session profile prime), reader cap unchanged. Reads 67% empty:
the price of readiness, and each one bodiless. Today so far (00:00–
05:41Z): 700 reads/hr, 67% empty, 1 gap; last hour 688 reads, 0 gaps.
Recordings 817 (799 on 09-19).

**Still open, none of it blocking.** (1) The collectors' `yield_24h`
column now reads 0.44–0.54 for everyone and is decided by the schedule,
not the operator; (2) collector points reward `new_facts > 0` only, so
an operator earns fewer per fetch for the same work — both Jamie's
call: re-word, or count a read at the clock's cadence as worth its
point. (3) The cleanup migration after this has settled: drop
`player_activity.rhythm`, `rhythm_weight`, `rhythm_battles`,
`half_life_days` and `poll_state.burst_bph`, `burst_at`. (4) Retire
`{poll_replay}`'s replay half once the clock has a week of its own
rows; its loss half with the cutoff split is the tool for any future
schedule change. The efficiency page is the standing read; Keep the
Record True carries the threshold (a lost-battles line that does not
stay near zero, or gaps above ~1 an hour, names the players before it
touches the ceiling).

## 2026-09-21 — Run Elixir MCP: pipeline healthy; account-cost decision needed

Run receipt, 09:48–09:53Z: public `/api/public/status` was green (one-second
fetch and admission freshness, 867 battles in the prior hour, five active
collectors, one draining, empty email DLQ and no dead jobs). Its capture audit
reported 8 gaps in 17,218 polls. The read-only migrate `{stats: true}` receipt
reported 722 battle-log polls in its trailing hour with 0 gaps; its 24-hour
errors were 14 expected upstream 404s and one transport receipt. The three
Discord preview LaunchAgents were running, their editor cursors were current,
and their boot evidence had observed contract 6.10.0. All Elixir service-health
alarms were OK; RDS `elixir-mcp-enc` was available at its 20 GB floor with a
100 GB autoscaling ceiling.

The account-wide `elixir-mcp-estimated-charges` alarm is ALARM: CloudWatch's
latest EstimatedCharges datum is $41.57 against its $40 threshold (the alarm
first crossed at $40.01). Cost Explorer's 2026-09-01..21 estimated unblended
total is $160.6323339922, and its `Application` tag grouping returns only the
empty tag, so this objective cannot attribute that account-wide spend to Elixir.
The alarm is already routed to `elixir-mcp-alarms`; no runtime capacity,
collector cadence, or alarm threshold was changed. Jamie needs to decide the
account-wide spend envelope: either approve a revised guard after the account
cost review, or name the cost-reduction target. Do not make that spending
decision through an Elixir runtime change.

## 2026-09-21 — Contract half of the clock: the rhythm and burst columns drop (0150)

Jamie, after part two: items 1 and 2 (the collectors' `yield_24h`
column and points per fetch) stay as they are; do item 3. 0150 drops
`player_activity.rhythm`, `rhythm_weight`, `rhythm_battles`,
`half_life_days` and `poll_state.burst_bph`, `burst_at`; the nightly job
no longer names them in its upsert. Nothing deployed had read them
since 09-19 (0144 for the burst pair, 0146 for the rhythm), which is
the expand-and-contract rule satisfied. Small tables, no rewrite.
`yield_bph` stays on `poll_state`: the clan row's churn signal and the
planner's ranking under a starved budget still read it.

## 2026-09-21 — The Elixir Gym's war run, actioned (contract 6.11.0): a finish is a day close

The Gym's regression run against 6.10.0 (findings doc "Elixir MCP — test
run 2026-09-21"; feedback #81, #82, praise #83; six regressions confirmed
fixed, including #70's full `fit_for` criterion) rotated onto `war_*`.
Both findings shipped and deployed the same morning (`4d6865d`, deploy
~12:13Z, verify green, live acceptance read-only against the Gym's own
repros; #81/#82 answered `done`, #83 `seen`). Backlog after: #77–#80 (the
daily-report agent's corpus `battles_meta_*` `query_timeout` on ad-hoc
windows, and a real compact mode for the meta tools) — filed 09-20 evening,
not this run's scope, none overdue.

**1. `finished_early` was documented, named in every note, and served on
no row (#81).** The row computed it as `our_fame === 10000`. Probed live
2026-09-21: the race LOG caps a finished boat's fame at exactly 10,000
(and the finish day's `progressEndOfDay`), while the LIVE race reports
the boat's progress past the line (`10134`, `10305` — the next day's
`progressStartOfDay` and the live `clans[].fame`), and `war_week_clan.fame`
MAX-merges the two. So a week known from the log alone equalled it and
every live-polled week did not; the test pinned the same `=== 10000`
against a July fixture and was tautological. **`finishTime` is a war-day
close, not a mid-day crossing:** every finished week's `finishTime` sits
exactly one day before the log entry's `createdDate` (136/1:
`20260920T093805` vs `20260921T093805`), the close of war day 3 in the
race's own slot; progress banks at day close and the finish is decided
then. Written to `cr-agent-api-docs` `clans.md` (`68645dd`). Shipped:
`finished_early` true/false on every regular week, `null` on a Colosseum
week (no line) or without a standings capture; `finish_war_day` from the
race's own day-by-day (min war day with `progress_end >= 10000`);
`scoring_decks` beside `decks_used` on `war_history.member_weeks[]` and
`war_current.participants[]` — `decks_used` less the attendance polls'
decks on the days after the finish day, equal to `decks_used` on an
unfinished week, `null` when the log lacks the week or no poll saw the
days past the finish (a poll writes every participant's row, zeros
included, so no rows means no sighting); `war_current.finish_war_day` and
a conditional note naming the finish, the day and the count of decks
played since for 0 points. The Gym's table reproduces live on 136/1
(God Bless You 12 → 8, sikander 16 → 12, Alfablack 4 → 0). **Bonus:** the
weekly clan email (`build-clan.mjs` → `render.mjs`) reads the same flag
and had said "boat fame" instead of "crossed the line early" on every
live-polled finished week. **Known limit:** the finish day's own
drift-gap minutes (the ~22 min between the clan's close and 10:00Z) stay
inside `scoring_decks`, and a poll that missed a day's last battle
overstates it by a deck; the note says so. Weeks known only from the
archive backfill (135/3's blackberry row) read `null`, not a guess.
**Not done:** recorded war battles as a second source for post-finish
decks (battles are not decks; a duel is two or three) — the polls are
the deck source. The log projector leaves the newest season's last
section unflagged as Colosseum (the live projector flags it), which the
test fixture shows as 134/3 reading regular; in prod 135/4 reads `null`
correctly.

**2. `war_rivals` fame statistics had a denominator the payload did not
contain (#82).** `finished_races` on every row; the note names it and
says `races_observed` includes the running week; a rival with no
finished shared race has `null` statistics (SQL semantics, now pinned).
Alongside: the running week was "the anchor's latest recorded week",
which excluded a just-closed race from the statistics until the next
week's first poll; it is now latest AND not yet seen closed.

**Open questions the Gym left for Jamie (not filed as defects):** (1)
`fit.plays_family`/`plays_archetype` collapse "your win condition,
different family" (Evo Royal Hogs cycle vs bridge spam) onto the bottom
adoption rung — a `plays_win_condition` boolean and a middle rung is
cheap, but whether family or win condition dominates adoption cost is a
product call. (3) The `shrunk_win_rate` floor note reads per-row while
the floor is per-segment (`methodology#deck-and-card-meta` is right;
behaviour is right); reword when that note next moves.

## 2026-09-21 — Backlog #77–#80 actioned (contract 6.12.0): the corpus meta on a week's window, and a compact size

Filed the evening of 09-20 by the daily meta-report agent: every 7-day
corpus read of `battles_meta_decks` / `battles_meta_cards` answered
`query_timeout` (#77, #78, #79), and four full payloads crossed a turn's
token ceiling before the report was written (#80). Shipped across five
commits (`4e2c2f3`…, last deploy ~13:05Z), all four answered `done`;
backlog after: 0.

**1. Why a week timed out when a season did not.** The whole-season
read comes from the nightly rollup; any other corpus window scanned the
participant heap (840k rows, 1.3 GB) with a per-row LATERAL for the
level gap, and the deck aggregate had two correlated subqueries per
(deck, type) output row — `deck_players` and `window_players` over the
CTE — quadratic on a 110k-player window, then shipped 100k+ deck rows to
the handler to sum totals. **The population table (0140) is the fix:**
`meta_season_pop` already holds one row per participant with
`mode_group`, `trophy_band` and `level_gap`, keyed by game day. A corpus
window that is not a whole season reads it (`popWindow` in
`meta-season.mjs`: scope = season keys + a game-day range one day wide
of the instants + the exact `battle_time` bounds; the band is a column;
`excludedBreakdown` takes a `source`), with a note naming the nightly's
cursor. The raw path stays for segments, a window starting past the
cursor, or one reaching a season whose population is gone. Totals and
per-type groups now come from ONE pass and the deck rows returned are
the ones over `min_battles` (the window row rides every deck row and
stands alone on an empty list — the query-budget test counts scans).
**Kept the previous season's population**: `dropPop` at a season's final
drops the seasons OLDER than it, so a window may span the roll (a
date-only `from` in Chicago starts five hours before the roll; "this
week against last" is asked most in a season's first week). One-off:
`{meta_rollup_season: {season_month: "2026-08"}}` (new jobs op) rebuilt
August's 79,560 rows in 129 s. Disk: 20 GB allocated, 12.4 GB free; a
season's population is ~250 MB.

**2. What `{explain_meta}` showed, and the shape that survived.** The
op now carries the two population-path aggregates. Cards, first shape:
18.6 s — the planner hashed all 1.7M `deck_card` rows TWICE, once per
aggregate (`per_type`, `per_card`), at 4 MB work_mem (the pop path had
skipped `rawScanMemory`). Second shape, an index probe per deck into a
materialized `cards` CTE: 56 s — a 7-day corpus window holds 65k
distinct decks and `deck_card`'s index-only scan did 236k heap fetches
(the visibility-map lesson again). Kept: ONE hash join of the pairs to
`deck_card` into a materialized `joined` set both aggregates read, at
32 MB. Live: decks ~5 s, cards ~8–12 s, the cross-roll 09-07..09-14
window ~10 s. Inside the 18 s budget, not comfortably: **the next step
if it creeps is a per-game-day card rollup** (`card_meta_day`: sums
add, `players` would be null on an ad-hoc window as it is on the
hourly's new decks). Sorts now break ties on the identity so the
rollup and raw lists compare equal whatever plan produced the rows.

**3. `verbosity: 'compact'` on the meta tools (#80).** A deck row keeps
`deck_hash`, `archetype_label`, `card_names` (one string, Evo/Hero
prefixed), the counts, `usage_share`, `win_rate`, `shrunk_win_rate`,
`players`, `dominant_mode` and `fit` without `upgrades`; a card row the
counts, rates, `players`, `held`; both drop `modes`, the instants, the
level gap, the card and archetype objects, `methodology` and
`modes_in_window`. Scalars and flags identical between sizes (pinned).
`cards` is no longer required on the deck-row output schema;
`card_names` and `archetype_label` are described as compact's.

## 2026-09-21 — 6.13.0 `plays_win_condition`, and the acceptance suite (the release gate the fixtures cannot be)

**1. The Gym's open question, decided and shipped (6.13.0, deployed
~14:05Z).** Jamie: the win condition dominates the family for adoption
cost — it is the card leveled and the timing learned; the family is the
pace. `fit.plays_win_condition` on every `battles_meta_decks` row with
`fit_for`, matched form included against the identities of the decks the
player fielded (the stamp keeps ids without form, so `deckIdentities` on
the player's own decks, a handful); `fit_for.plays.win_conditions[]` as a
label speaks them (`cardDisplayName` in contracts is now the one place
the Evo/Hero prefix is written; compact's `card_names` uses it). The note
reads the three booleans in order: exact shape → same win condition in
another family → same family around a new win condition → neither. Live
on the Gym's exact call: `72c6c8fb` Evo Royal Hogs cycle reads
`plays_win_condition: true, plays_family: false`; Evo P.E.K.K.A bridge
spam the reverse; Minion Giant cycle neither. **Not** an `adoption_cost`
score — three booleans and a note are the right altitude (the Pilot
Score lesson).

**2. The acceptance suite (`acceptance/`, wired into the deploy after
smoke, `npm run acceptance` on demand, daily in Run Elixir MCP).**
Jamie: "we run the risk of regression without it." The unit tests pin
logic over fixtures; nothing pinned the deployed product against the
live record, and that is where `finished_early === 10000` and the
corpus meta timeout lived. Design: a read-only **agent principal**
`acceptance` (clan #J2RGCRVG, scope `cr:read`, its own `/a/dc50d5ed5e0e/mcp`;
token minted locally with `mintServiceTokenValue`, only the hash sent
through `{principal}`, the raw value written to `acceptance/.env` mode
0600 and never printed — the recipe is in `acceptance/README.md`). One
runner, no dependencies, stateless JSON-RPC like the boards client; a
case is `{ id, run(ctx) }` that throws; `ctx.read` caches by tool+args so
39 cases cost 26 calls (~2 min, the corpus meta reads are most of it).
Four suites: `contracts` (a generic rule: every snake_case token a note
names must be a key somewhere on the response, an argument of the tool,
a tool name, a `tool.field` path, or vocabulary — the finished_early
class; plus the per-row fields the docs promise), `identities`
(`war_current.participants[].decks_used` ⟷ `clans_participation`
`war_decks` by index; `war_rivals.mean_fame` and `zero_fame_races`
rebuilt from the exact weeks' standings; `finished_early` ⟷
`finish_war_day`; `scoring_decks ≤ decks_used`; `excluded.considered` =
exclusions + decided; usage_share ≤ 1; `full ⟹ !truncated`; the fit
split is after sort and limit), `budgets` (ceilings ~1.5× the times
measured today: corpus week decks 9 s, cards 15 s; every duration
printed), `gym` (#70, #71/#76, #72, #73, #74, #77–#79, #81, #82, #56/#64
as the Gym wrote them). A harness test against a fake door runs under
verify and pins that no case names a write tool or sends `live: true`.
The deploy skips the gate with a WARNING when `acceptance/.env` is
absent, never silently.

**What its first runs found.** (a) `war_history.weeks[].in_progress`
was emitted only when true — an absent flag read as false, the
finished_early defect's shape — now on every row (folded into 6.13.0).
(b) The first gated deploy went red on its own note change (the
full-board note named `rated_players`, `rankings_clans`'s field, beside
the tool name): the rule now takes `tool.field` as a pointer and the
note writes it so. The gate refusing a deploy over a note it could not
verify is the behaviour wanted. (c) **Open:** `battles_meta_decks
{segment: "mine"}` over the season answers in **8.6 s** on every run
(ceiling set at 10 s so it is watched, not blocking) — a 46-member clan
on the raw path with the per-row lateral; the 2026-09-15 note had clan
meta at 1.7 s. Worth an `{explain_meta}` read (the clan-scope plans are
in it) before it creeps to the budget. (d) Tokens notes use as prose
were allowed per case (`points_earned` on a training day with
`days_closed: []`, a floored loss's `trophy_change` the game omits,
`members_not_in_race` pointed at from `clans_roster`).

**Not done, on purpose:** no value assertions (a number that changes
daily is the Gym's to read, not a gate's); no `live: true` (CR budget);
no write tools (the token cannot). The Gym's weekly run is unchanged —
the suite is its Pass 2, not its Pass 4.

## 2026-09-21 — The acceptance layer, second build: catalogue, bites, shapes, known — and what it found

Jamie: build it out, "we found several bugs building the first group;
I expect several more just building this." Six commits, each through
the gate; final run **214 cases, 0 failed, 4 KNOWN, 182 calls, ~4.5 min**.

**The layers (acceptance/README.md has the table).** `catalogue.json` —
what agents actually called this week, derived by `catalogue.mjs
--refresh` from the new migrate op `{acceptance_catalogue}` (top
argument sets per read-only tool among calls that answered, on_behalf_of
and live dropped, p50/p95 per tool), plus `catalogue-seed.json` (hand-
picked sets with a reason each). Sets the current contract refuses are
validated against the local inputSchema at refresh, listed and dropped
(usage from before 4.0.0's `segment` requirement was in the week).
Generic rules over every set (`checks/catalogue.mjs`): answers; published
`outputSchema` holds (19 tools) else the recorded shape baseline; under a
ceiling from the tool's own p95 (1.5× + 500 ms, floor 4 s, cap 15 s); a
two-size tool's compact is a subset and its full twin is read; every
field its notes name is on some response of the tool (keys OR values —
`tower_troop` is a value — plus arguments, enum values, description
words, every published tool name via tools.json, the error enum,
`catalogue-allow.json` with a reason each); every backticked field its
docs section names is on some response THIS RUN, any tool (the Gym's I7:
documented somewhere, served nowhere). **Bites** (`bites/`,
`bites.test.mjs` under verify, no network): captured answers from the
archive bucket (`bites/fetch.mjs <date> <request-id prefix> <name>`)
with a manifest naming the case or rule that must FAIL on each — #81,
#82, #77, the closed week without `in_progress`, and today's
`battles_query` timeout. **Shapes** (`shapes/`, `--update-shapes
--reason`): key-path baselines for the 23 tools with no outputSchema,
one-directional, provenance printed by every run as the to-do list.
**Known** (`known.json`): a failure filed for a decision with a reason
and an expiry, reported KNOWN and not counted until the date. Runs one
call at a time (three concurrent heavy reads on the micro inflated each
other's timings: cards_synergy 8–11 s in a pool of three, 4 s alone).

**What building it found — seven, two of them product bugs:**
1. **The gate itself starved its owner.** The hourly rate limit keys on
   the paying ACCOUNT, so one run took 40% of Jamie's hour, which the
   Discord agent shares — the second gated deploy went red on
   `tools/list: Rate limit reached`. A service token that carries its
   own `hourly_rate_limit` now spends from its own bucket
   (`mcp#token#<id>`); `{service_token_limits: {name, hourly_rate_limit,
   daily_quota}}` sets one by name; `acceptance` has 900/hour. Test:
   a busy key's spent hour does not touch a plain key on the same account.
2. **`battles_query {limit: 1}` for the most-recorded player timed out
   at 24 s**, every run, while the same call for another member took
   5.6 s and the audit's p95 read 2.1 s (the timeouts were in the audit
   as `timeout` under a key set nobody had looked at). The window moved
   onto `bp.battle_time` at review 3.3; the ORDER BY and the keyset
   cursor stayed on `b.battle_time`, so the planner walked the battle
   table's time index backwards probing each row for the player. Ordered
   on the participant's copy now (the `(player_tag, battle_time)`
   covering index serves it); `battles_performance`'s sample too. The
   timing-out answer is a bite.
3. **`players_collection` at full verbosity exceeds the 48k cap for any
   mature collection** (Jamie's, raquaza's; `iconUrls` per card is most
   of it), and **`clans_members_timeline` full with five metrics over a
   week exceeds it at the default limit** — defaults that cannot be
   read. KNOWN until 10-05: Jamie's call (drop iconUrls, a removal; raise
   the cap per tool; or document compact as the readable size).
4. A `clans_timeline` note pointed at `years_played` without naming the
   tool it lives on (`players_profile.years_played` now); the protocol
   page said events carry `created_at` where timeline items carry `at`.
5. `in_progress` (earlier today, 6.13.0).
6. Docs sections that name fields as NOT existing (`filters_applied`,
   `nominal_period_elapsed` "removed at 4.0.0") read as promises to a
   rule; they are allowances with the reason quoted.
7. The catalogue exposed how much of a week's usage the current
   contract refuses (six sets across the meta tools and cards_synergy):
   agents still send pre-4.0.0 shapes. Not a defect here; a signal for
   Close the Loop's friction pass.

**Open, watched:** `budgets/meta-decks-clan-season` 8.2–9 s; `cards_card`
corpus 9.5–11.4 s and `battles_trends` clan 8.8–10.2 s (both under their
p95 ceilings, both slow); 23 tools on recorded baselines. **Next:** write
outputSchemas for the 23 (the baselines retire as each lands); the
identity DSL; the ground-truth suite against the live CR API (2–3 calls
from this Mac); the Gym prompt gains the JSON block in the README.

## 2026-09-21 — 6.14.0: the collection is its own facts; every tool has an outputSchema; the ground suite

**players_collection (Jamie's call: a minor, not a major).** The full
answer for a mature collection was ~55k against the 48k cap and, with
no `limit` to narrow, could not price a retry: 31k of it was the
catalog repeated per card (`iconUrls` 22k; `rarity`, `elixirCost`,
`maxLevel`, `maxLevelRarityScale` 9k). Gone from the rows; ~24k at
full. Jamie declined the major: the removed fields are catalog facts,
no client could receive the answer they rode on (the week's reads were
all compact), and the changelog says so. `clans_members_timeline` at
full over a week with five metrics was NOT a defect: its refusal prices
the retry ("a limit of 21 should fit") — the suite's compact-twin rule
now takes a priced `result_too_large` as the documented answer, and
`answered()` prints hints. `known.json` is empty.

**Every tool publishes an outputSchema (23 more).** Drafted from live
answers by a throwaway generator, reviewed against the handlers for the
conditional keys (`population` on corpus reads, `players_as_of` on the
rollup path, `season` on `cards_card`, the rankings tools' unrecorded
branch with `snapshot: null`, `clans_total` off that branch), then held
against the fixture tests — which validate every output under the test
runner and caught fifteen leaves typed from one observation (`war_day`
integer-only, `mean_fame`/`clan_tag` null-only). Policy for the drafts:
required at the top level only, every leaf nullable, permissive below.
`acceptance/shapes/` is empty; the provenance line reads 0/0. The
registry now validates 42 tools' outputs on every test run.

**The ground suite.** Two live CR API reads from this Mac
(`cr-api.mjs`, the operator key, never through the door): profile
identity facts equal, trophies equal when the record is under three
hours old; the race bracket is the game's, banked fame never ahead of
the game's, equal under ten minutes. SKIP printed where no key answers.
The acceptance key's own ceiling raised to 2,400/hour: a build day runs
the suite five times an hour and 900 tripped once more (the deploy went
red on it, correctly; re-run green).

Final: **216 cases, 0 failed, 0 skipped, 184 calls, ~4.5 min**, through
the gate. **Next in the build:** the identity DSL (one-liners for
cross-tool number pairs); the Gym prompt's JSON block; `cards_card`
corpus ~10 s and `battles_trends` clan ~9 s watched.

## 2026-09-21 — The identity DSL, and the day's third product bug (dailySql's DATE-typed parameter)

**The DSL (`acceptance/dsl.mjs`).** A cross-tool invariant is one line:
`same(label, rows(tool, args, list, key, value), rows(...))` (the right
side's value function sees the left side's body — the running week from
`war_current` picks the column in `clans_participation`), `scalar()`,
`ordered(chain)`, `sums(total, parts)`, `implies(when, then)`,
`bounded(value, low, high)`, `sumAtMost`, `check`. Arguments may be a
function of ctx (the closed week found at run time). **A field a rule
names must exist**: undefined fails (the `finished_races` class), null
skips (an honest unknown) — the #82 bite proved the first draft blind:
null-skipping had made `ordered` pass on the 6.10.0 capture that lacks
the field. `identities.mjs`: 27 cases, 25 one-liners, ten of them new
pairs (roster size vs `war_current.member_count`, the two meta tools'
`decided_battles`, `rankings_clans.field_size` vs the players board's
`snapshot.entries`, a player's 30-day battles on two tools, …).

**What the new pairs found.** `players_summary.last_30_days.battles`
93 vs `battles_performance {days: 30}` 90 over the same instant — three
battles on the window's first day before its instant. `dailySql`'s
bound parameter appeared first as `($2)::date`, which typed the WHOLE
parameter `date`; every later `battle_time >= $2` then compared against
midnight and the start day counted whole. The fixture test passed for a
month because its windows held no battle in that gap and its `from` was
a string literal; production passed a Date. Cast at every use now; the
test seeds a pre-instant battle; `clans_standings` (standings-sql.mjs)
read the same SQL and was wrong the same way. Both answers are bites.
**Lesson for every query in this repo:** a `$n` used in more than one
place takes its type from the FIRST use; cast it where the cast is
meant, never rely on inference.

Final: **235 cases, 0 failed, 187 calls**, through the gate. The build
list from this morning is done: catalogue, bites, shapes (retired),
known, ground, DSL. Left for Jamie: the Gym prompt's JSON block (in the
README).

## 2026-09-21 — The Gym's block runs as written; the by-day carry

Jamie put the JSON block in the Gym's prompt and it restated the day's
findings in it — richer than the README's sketch: `has`/`eq`/`neq`/`lte`/
`count_eq`/`sum_eq`/`sorted_desc`/`notes_match`/`notes_not_match`/
`every_row_has`, `[?clan_tag=…]` filters, `[N]`, `calls` aliases for a
two-tool comparison, `when`, `for_each`, `stability` frozen|live,
`control`, `needs_fixture`, `open_question`. Built `gym-interp.mjs` to
run exactly that; `gym.json` is the block verbatim (a duplicate id
merged, 81.4 answered `null`, `clan_tag` dropped where the Gym's own
call defaulted it so the capture matches). Two interpreter slips on the
first run (an ISO instant read as a path; `lte` with a literal on the
left), then **27 gym cases, 0 failed, 3 skipped** (the fixture-only
control, and two `when`s that do not hold on a training day).

**81.7 failed live, as expected — the Gym's open question 2 is a
product gap and is fixed at the ingest.** `war_decks_by_day` summed one
short of `war_decks` for two of 46 members: between a day's last poll
and the next day's first, a member's cumulative `decksUsed` grows by
the old day's late decks plus the new day's, and `decksUsedToday`
holds only the latter; the difference was played before the API's day
rolled and no poll saw it. `projectRiverRace` now carries
`delta − decksUsedToday` to the previous war day's row (`least(4, …)`);
a poll inside a day carries nothing (its delta is at most today's
growth). Past weeks stay short; `known.json` holds 81.7 until 10-06,
when both of `weeks: 2` post-date the deploy. Scoring_decks (6.11.0)
reads the same rows, so it tightens too.

Gate: **253 cases, 0 failed, 3 skipped, 194 calls.** The gym suite is
now the Gym's own words plus five code cases the block does not cover
(#74, #77–79, #56/64).

## 2026-09-22 — Route attribution replaces the fixed collector-door cost baseline

Run Elixir MCP's check-in-era cost instruction still said that a few hundred
web-api Lambda-seconds per day was normal and treated a higher total as a
polling regression. The 2026-09-22 read-only CloudWatch receipt disproved that
rule: the preceding 24 hours had 72,210 web-api invocations and 7,768.992
billed seconds, of which `POST /api/collector/lease` accounted for 49,618
successful requests and `POST /api/collector/submit` for 22,361. The public
status simultaneously reported active collectors, fresh admissions, empty
queues/DLQs, and expected global rate below the 3,600/hour budget; route p95s
were 64.969 ms for leases and 560.5038 ms for submits. This is productive
throughput plus the designed idle check-ins, not evidence of the retired
long-poll loop.

The corrected operating rule is route attribution: each productive fetch
normally causes a submit and a further lease, while idle collectors add leases
at their phased cadence. Investigate a lease surplus unexplained by submissions
and fleet idleness, rising billed time with stable admissions, or long lease
latency. The new `collector-door-cost-attribution` decision case preserves the
distinction. No collector, pacing, capacity, or alarm threshold changed.

## 2026-09-22 — 6.15.0: the Gym's second war run (feedback #84–#86), the banked progress, boat decks, the horizon on the exact week

The Elixir Gym's rotation landed on `war_*` again (ISO week 39 mod 9 = 3)
and ran yesterday's fixes as a regression pass first: #81, #82 and
6.13.0's `in_progress` all CONFIRMED FIXED with today's numbers. Three
new findings, all verified against independent reads, all shipped as
one contract bump (`4a52383`, deployed `--acceptance` ~10:45Z, stack
UPDATE_COMPLETE, migrations 150/0):

- **#84 `days[].progress_end` is clamped to 10,000 on the finishing
  day.** The API's periodLogs cap `progressEndOfDay` at the line and the
  next day's `progressStartOfDay` carries the sum (136/0 day 3: 6811 +
  3000 + 323 = 10134 served as 10000), so nineteen of twenty day rows
  reconciled and the twentieth did not, and a walk over `progress_end`
  showed +134 fame arriving on the day 6.11.0 exists to call dead. The
  cap was documented — attached to `our_fame` on the week row, two
  paragraphs away from `days[]`. `progress_end` stays the API's value
  (the property the Gym asked not to give up); `progress_end_banked`
  beside it on every day row of `war_history.days[]` and
  `war_current.days_closed[]` is the row's own parts on a clamped
  finishing row and `progress_end` everywhere else; a note fires only
  when the week has a clamped row and names the clan, the day, both
  numbers. Rival rows that never reach the line are never clamped.
- **#85 `scoring_decks` pools boat decks with PvP decks under the rate
  6.11.0 sanctions.** Verified from the battle log the way the Gym did:
  Ak `decks_used: 4, boat_attacks: 4` had four `boatBattle` entries and
  no PvP; NOBITA 8 boat + 2 PvP + 1 two-round duel = 12 = `decks_used`.
  A boat deck scores roughly half (350 for four boat decks beside
  700–800 for four PvP decks), so `points / scoring_decks` ranked the
  two members who did the clan's boat attacks 26th and 22nd of 26. A
  note fires whenever any `member_weeks[]` / `participants[]` row has
  `boat_attacks > 0`, says they are counted INSIDE `decks_used` and
  `scoring_decks`, and names who with their share (up to four, then
  "and N more"). The decks note and the docs list a boat battle among
  what consumes a deck; `battles#duels-and-boat-battles` had said boat
  battles sit outside every denominator, true of the decided-battle
  ones only, and now says so. **Not built:** `pvp_decks`. The record
  holds `boat_attacks` as the game's weekly counter, not per day, so
  "scoring decks less boat decks on scoring days" is not computable;
  `decks_used - boat_attacks` is the caller's one subtraction on an
  unfinished week, and the docs say so.
- **#86 the exact-week path dropped `history_starts_at`.** 128/0 (before
  the horizon) and 136/5 (a section no season has) answered
  byte-identical empty payloads with the same seven field notes. The
  horizon rides both paths now, and an empty exact week carries one
  note saying which side of it the week is on: before recording began;
  after the latest recorded week (not yet played or observed); a section
  no season has (sections run 0–4; `section_index` still accepts 5 on
  the schema, and the note is the answer); or a gap inside the span. The
  field notes are suppressed on an empty answer so the sentence is not
  buried.

Acceptance: the Gym's blocks 84.1–84.3, 85.1–85.6, 86.1–86.2 and its
seven negative controls 87.1–87.7 are in `gym.json` as written, plus
84.4 and 86.3 for the fix's own shape (`progress_end_banked` on the
clamped row; the "never existed" branch). Two blocks were annotated
rather than paraphrased: 87.5 names its two rivals with `rival_tags`
(`war_rivals {}` is the current bracket and rotates with the season, so
a frozen pin on it would expire at the next roll). The interpreter
gained what the blocks needed: `contains` (85.6), a summed fanned total
in `sum_eq` (87.1: `member_weeks[].points`), the PCRE `(?i)` prefix the
Gym writes (the notes verbs were already case-insensitive; JS has no
inline flag and `new RegExp` threw), and a bare identifier on the right
of `eq` read as the row's field (87.3: `eq scoring_decks decks_used`
under `for_each` — the deploy gate went red on this one with the product
right, 16 == 16; fixed forward in `649885a`, gym suite green live: 47
cases, 0 failed, 3 skipped). Identities: banked == the row's parts on
every clan-day with the cap note present when they differ;
`boat_attacks <= decks_used`; the boat note fires iff a row has boat
decks; `history_starts_at` on the exact path. Bites: the three captures
the Gym read (`f1c34d87`, `e81d7d16`, `a9d3a7c1`) each proved to fail
84.1/84.4, 85.1 and 86.1 on 6.14.0. Fixture: one 6.15.0 test in
`war-tools.test.mjs` over the race fixture (period 26 is the clamped
row: 6870 + 3000 + 376 = 10246 served as 10000).

Gate on the deploy: **277 cases, 1 failed (87.3, the interpreter), 3
skipped, 198 calls**; identities 31/0 and contracts 13/0 re-run live
after the fix-forward. Feedback #84–#86 responded `done` (shipped_in
6.15.0), #87 (the regression praise) `seen`; queue 0. The API reference
(`cr-agent-api-docs` `1860409`) records the closed-day row identity, its
one clamped exception, and `boatAttacks` inside `decksUsed`.

Also today: `5347b88` had added a thirteenth decision-eval case and left
the count pinned at 12, so `npm run verify` was red on `main`; `169d1d5`
moves the pin.

**Open, from the Gym's questions, not actioned:** (1) `progress_earned`
saturates at 3,000 per day on every POAP KINGS row and no relationship
to `points_earned` is stated — the Gym could not tell a game rule from a
recorder transform and neither could this run; the next probe is a clan
that never approaches the ceiling, and the answer belongs in
`cr-agent-api-docs` first. (2) `finished_early` reads `false` on a week
in progress (136/2); `in_progress` is on the row; a `null`-while-open
would be a semantics change to a field the Gym confirmed fixed — not
touched. (3) `war_rivals` rounds `mean_fame`/`median_fame` to an integer
without saying so (2029.5 → 2030): one word in the note, queued. (4)
**For Jamie:** the Gym's family rotation is deterministic only if the
family count is pinned in the brief — nine prefixes gives `war_*` for
week 39; counting `game_*` and `live_fetch` gives eleven and a different
family; and two runs in one ISO week (09-21, 09-22) both landed on
`war_*`.

## 2026-09-22 — How long did a battle last? What the corpus can and cannot say ({battle_length_census})

Jamie asked whether battle duration is recoverable, and whether ranked
games against top players reach the 5:00 limit more often. The battle log
carries no duration field, but the game's clock (now in
`cr-agent-api-docs` `models/battles.md`, "Battle Length And Phases":
3:00 regulation, 2:00 sudden-death overtime, elixir 1x/1x/2x/2x/3x,
transitions at 120/180/240 s) makes the crown pair a bound. A King Tower
is the ONLY way to end before 3:00, and overtime ends on the next tower,
so: a three-crown finish ended early (duration unknown); any other
finish ran at least regulation; and a finish with the sides LEVEL on
crowns means overtime expired and the tower-hitpoints tiebreaker
resolved it - exactly 5:00.

New read-only op `{battle_length_census}` (migrate, ~5 s, one pass over
the 1v1 types grouped by a small key, never by battle_id). Over
**229,390 recorded 1v1 battles**:

| type | battles | three-crown (early) | known >= 3:00 | level crowns |
| --- | --- | --- | --- | --- |
| `pathOfLegend` | 180,518 | 17.3% | **82.7%** | 46 (0.025%) |
| `PvP` (ladder) | 36,641 | 33.4% | 66.6% | 2 (0.005%) |
| `riverRacePvP` | 12,112 | 43.1% | 56.9% | 76 (0.627%) |

**Jamie's hypothesis holds, by a mechanism other than the one proposed.**
Ranked games do run long far more often - 82.7% of Path of Legends
battles are provably three minutes or more, against 66.6% on ladder and
56.9% in war - and inside Path of Legends the early-finish rate falls
monotonically with rating (three-crown 19.0% at the 1000 band, 17.7% at
1500, 17.3% at 2000, 12.8% at 2500, 12.3% at 3000, 10.5% at 3500). The
cause is fewer King Tower finishes against better defence, NOT more 5:00
tiebreakers.

**The 5:00 tiebreaker is not observable in this corpus at all.** Of the
124 level-crown battles, 114 have both princess towers on both sides at
identical hitpoints (4808/4808, king 7678 - untouched), so no battle was
fought; of the 10 with tower damage, every single one shares a hitpoint
value between the two sides and three read `crowns 3-3` with BOTH kings
at 0. There is no clean 5:00 tiebreaker in 229,390 battles. The
deduction is sound and worth keeping in the docs; the event is rarer
than the defects that mimic it.

**Finding, not actioned: 37 `pathOfLegend` battles record BOTH sides as
`loss`.** 0.020% of Path of Legends, zero in ladder and zero in war. All
37 carry two NEGATIVE `trophy_change` values that sum to -29 every time
(-13/-16, -17/-12, -15/-14, -18/-11, -16/-13), 31 of 37 have untouched
towers, and 3 have `crowns 3-3` with both kings destroyed. A decided 1v1
has one winner, so the pair is impossible as recorded.
`outcomeFor` (`services/ingest/src/battles.mjs`) takes the sign of each
participant's own `trophyChange` first, so it will label both sides
`loss` whenever the API hands us two negative values - it is faithfully
recording what arrived. What arrived is the open question: a voided or
double-disconnected Path of Legends match that penalises both players
would explain the untouched-tower rows, but not `3-3` with both kings at
0, which looks like two entries collapsing onto one `battle_id`
(`sha256(battle_time ":" sorted tags ":" type_class)`). Root-causing
needs the raw payloads - `{export_payloads}` has them - and belongs to
Keep the Record True. These 37 rows are also the ENTIRE population of
"level crowns with a decided outcome", so any consumer reading that as a
5:00 tiebreaker would be reading the defect.

Also worth knowing for any winner-inference consumer: 43,634 Path of
Legends battles and a large share of ladder ones carry `trophy_change`
on one side only (sign pairs 1/0 and 0/1), so the crown fallback is
load-bearing, not an edge case. And in `riverRacePvP` there is no
`trophyChange` at all, so a war 1v1 that the game decided on tower
hitpoints would be recorded as a `draw` with its winner unrecoverable
from crowns - none of the 76 war level-crown rows is such a battle
(all untouched towers), but the exposure is real if one ever occurs.

## 2026-09-22 — The 37 both-loss battles are Path of Legends DRAWS: the API penalises both players (ingest fix + repair)

Follow-up to the battle-length census above, and a correction to it.
Jamie brought a second opinion arguing these rows were draws rather than
two losses. Its recommended rule (`trophyChange == 0` should be
unresolved/draw, not loss) was already the implemented behaviour -
`outcomeFor` tests `trophyChange !== 0` before using the sign, which is
why the 87 level-crown DRAWS existed separately - and its stated
signature did not match these rows, which carry non-zero NEGATIVE changes
on both sides. But its conclusion was right, and its aside about Path of
Legends penalising both players for a tie was the key.

**Settled from the raw payload, not from argument.** Pulled the archived
battlelog for `20260914T130806.000Z` out of
`payloads/endpoint=player_battlelog/` and read what Supercell actually
sent:

```
team      crowns=3 king=0 princess=None trophyChange=-15 elixirLeaked=0.0
opponent  crowns=3 king=0 princess=None trophyChange=-14 elixirLeaked=0.82
```

The API itself reports both sides at three crowns with both King Towers
destroyed and both losing rating. Our ingest was faithful; the reading
was wrong. `outcomeFor` took each participant's own `trophyChange` sign
in isolation, so two negative values became two losses - a result the
game cannot produce.

**Fixed at the source.** The sign decides only when the two sides moved
in OPPOSITE directions; otherwise it falls through to the crowns, which
say `draw`. Two fixture tests, the first proved to fail on the unfixed
code. The pre-existing "outcome precedence invariants" test asserted the
old rule and now carries the opposite-signs condition.

**Repaired.** `{outcome_pair_repair}` (dry run by default) re-derived the
37 battles / 74 participant rows; re-check and the census both read zero
impossible pairs. All 125 level-crown battles corpus-wide are now
`draw`, which is what they always were.

**`elixirLeaked` is a duration bound, and the earlier note here
underrated it.** It is elixir generated against a full bar, so it cannot
exceed what the match had time to make. The level-crown rows read
166.18/173.18 and 168.29/179.54 with every tower untouched - both players
idle for a full five minutes - while the `3-3` both-kings-zero row read
0.0/0.82, a match that never ran. So the 37 were two distinct real
things wearing one shape: genuine 5:00 mutual-idle draws, and voided
matches. Both are correctly `draw`; only the first ran any clock.

**What this corrects in the entry above:** level-crown battles are NOT
"defects that mimic" the 5:00 case - they ARE the 5:00 case, and Jamie's
original deduction (no towers lost, resolved on remaining points, so the
match went the distance) is sound. What it does not do is name a winner:
level crowns almost always means neither side touched a tower, so the
tiebreaker's hitpoints are exactly equal and it cannot separate them.
Zero tiebreaker-DECIDED battles in 229,390. The three-crown floor
finding is unaffected and remains the broad signal: 82.7% of ranked
battles provably ran three minutes or more, rising with rating.

`cr-agent-api-docs` `d519915` carries both halves for any caller: the
winner-inference caveat with the raw payload, and `elixirLeaked` as the
one per-battle lower bound on elapsed time.

## 2026-09-22 — Battle fidelity audit from the raw payloads: the manifest is complete; what we drop is a choice

Jamie asked whether we faithfully collect everything in a battle, and
pointed at the right place to look: the API payload, especially fields
that do not appear in every battle. The nightly shape census samples
**twenty archived objects per endpoint per day, newest first**, which is
structurally blind to rare battle types - twenty recent battlelogs are
whatever the busiest recorded players just played, so `boatBattle`,
`riverRaceDuel`, `tournament` and `clanMate2v2` and their type-only
fields can go unsampled for long stretches.

So: enumerated every JSON key path across a **stratified sample of 1,979
archived battlelog objects (one per distinct recorded player), 60,748
battle entries**, using the census's own `payloadPaths` notation, and
diffed against `PAYLOAD_KEYS.player_battlelog`. All twelve observed
battle types were covered (pathOfLegend 34,436, trail 14,468, PvP 3,669,
riverRacePvP 3,330, boatBattle 1,904, friendly 953, riverRaceDuel 727,
riverRaceDuelColosseum 625, clanMate 273, tournament 188, unknown 121,
clanMate2v2 54).

**Result: ZERO paths present in payloads and absent from the manifest.**
Nothing the API sends is uncatalogued. Fifteen manifest paths went
unobserved: the three `challenge*` fields (already documented as
official-only, never seen live) and twelve `supportCards[]` sub-fields
the support-card object simply does not carry - the manifest
over-specifies there, harmlessly.

`{battle_fidelity_census}` (new, read-only) checks the other direction -
a column the manifest promises but the projector never fills - and every
column is filled where its type expects it (`boat_battle_side`,
`new_towers_destroyed`, `prev_towers_destroyed`, `remaining_towers` are
100% on `boat` rows and correctly 0% on `pvp`).

**So the question is not fidelity, it is disposition.** Three drops carry
real volume, measured over the same sample:

| dropped | volume | reason of record |
| --- | --- | --- |
| `globalRank` | **23,764 participant rows, 19.6% of slots** (pathOfLegend 22,865) | "Tier 2 (time-series review 2.4)" |
| `rounds[].*` (duel per-round crowns, tower HP, elixir, cards.used) | 2,802 rows (every duel) | "per-round rows are Tier 2" |
| `modifiers[]` | **2,273 battles, 3.74%** | 0112: "CHAOS modifiers had no reader; the column was dead" |

The modifiers drop has a consequence nobody priced: `trail` maps to the
`casual` mode group, so ~2,273 CHAOS-modified battles sit pooled with
ordinary casual battles and are now **indistinguishable from them**. The
`comparable` guard on the deck and meta tools catches mode mixing and
level gaps; it cannot catch this, because the field that would identify
it is gone. Card behaviour under a modifier is not the card's behaviour.

Also noted, not a drop but a gap: `riverRaceDuel` and
`riverRaceDuelColosseum` carry `deck_hash` and `deck_avg_level` at 0%
(8,296 participant rows). That is correct for deck IDENTITY - a duel has
no single deck - but the per-round decks ARE stored as
`battle_participant_card` rows, so a duel's level could be computed and
is not. Duels are invisible to every level-gap comparison today.

Not actioned: these are Jamie's calls, written up for the decision.

## 2026-09-22 — The COMPLETE battle payload audit (not a sample): every field has a disposition; four are dropped on purpose

Jamie's challenge: the earlier pass missed `globalRank`, `modifiers`, the
duel round results and `arena.rawName`, so a sampled re-audit cannot give
confidence. Correct. `payloads/` has **no expiration** (only an IA
transition at 30 days; the 90-day rule is `calls/` only), so the archive
IS the whole inbound history and a complete sweep is possible.

`infra/scripts/payload-field-audit.mjs` (new) reads EVERY archived object
for an endpoint and reports each field path's volume and its manifest
disposition. It **exits non-zero when a path has no disposition**, so it
can gate a release rather than being a thing someone remembers to run.

Complete result for `player_battlelog`: **72,503 objects, 0 failed,
964,925 battle entries, 116 distinct field paths, all twelve battle
types** (pathOfLegend 337,798, trail 268,117, PvP 213,246, riverRacePvP
55,337, boatBattle 40,312, friendly 22,638, riverRaceDuel 10,338,
riverRaceDuelColosseum 4,374, clanMate 4,356, tournament 3,225, unknown
2,757, clanMate2v2 2,427).

**ZERO uncatalogued paths.** Nothing the API sends for a battle lacks a
decision. The earlier sampled audit reached the same verdict; this one
can be relied on.

Dropped on purpose, at full volume (entries carrying the path):

| path | entries | reason of record |
| --- | --- | --- |
| `[].team[]/opponent[].globalRank` | 964,925 each (~19.6% non-null) | Tier 2 |
| `[].arena.rawName` | 964,925 | with the profile's arena.rawName |
| `[].modifiers[].tag` + `.modifiers[]` | 66,821 | 0112: no reader, the column was dead |
| `[].team[]/opponent[].rounds[].crowns`, `.kingTowerHitPoints`, `.princessTowersHitPoints[]`, `.elixirLeaked`, `.cards[].used` | 15,091 (13,347-13,937 for king HP) | per-round duel results; Tier 2 |

Fifteen manifest paths are never observed: the three `challenge*` fields
(already documented official-only) and twelve `supportCards[]` sub-fields
the support-card object does not carry. The manifest over-specifies
there; harmless, worth trimming when that file is next touched.

**Why the nightly census missed these.** It samples twenty archived
objects per endpoint per day, newest first - a good tripwire for a field
the API adds to what people are playing now, and structurally blind to
the rare: a duel is 1.5% of entries and a CHAOS modifier 6.9%, so both
can go unsampled for long stretches. The census stays (it is cheap and
catches additions fast); the full sweep is what gives the guarantee.

**The duel claim we have been making is not true.** The public docs said
a duel's `tower_hp` "describes the final round only" and that it "has no
differential" - framing Elixir's own gap as a property of duels. The API
reports every round separately. Corrected on /docs/battles today to say
the limit is what Elixir records, not what the game reports. The fix
itself is a pass of its own (Jamie, this session): a
`battle_participant_round` table (the manifest already names it),
`battle_participant.global_rank` (also already named), a home for
`modifiers`, and a replay of the 72,503 archived payloads to fill them.
Not started - scoped and awaiting Jamie's go.

## 2026-09-22 — The battle-detail pass: 0151 ships, the archive backfill runs, and mode discipline is the open decision

Jamie: proceed with duel rounds, global_rank and the mode fixes; and -
the product line that reframes the rest - "game modes are really played
as a different game... ever querying battles without a mode is probably
an indicator of a bug."

**Shipped (0151, deployed).** `battle_participant_round` holds one row
per game of a duel per participant (crowns, king and princess tower
hitpoints, elixir leaked), keyed on the same round number the round
decks already used in `battle_participant_card`; `.used` joins them;
`battle_participant.global_rank` is the column the manifest named and
never had. The manifest now says all of them LAND, so the full payload
audit and the nightly census hold us to it. Two fixture tests, the duel
one asserting a round-one elixir differential - the thing /docs/battles
said could not be computed.

**Backfill running.** `{battle_detail_backfill}` + 
`infra/scripts/battle-detail-backfill.mjs`: Postgres caches a payload
for two hours, so S3 is the only copy; the sweep is local and every
entry goes through the SAME `canonicalizeBattle` the live pipeline uses,
so a battle_id computed there is the one already recorded. Resumable on
the last key. Two things learned: one battle sits in MANY archived
payloads (both players' logs, every poll that still held it), so a batch
must be deduped or ON CONFLICT DO UPDATE refuses; and the migrate Lambda
has `ReservedConcurrentExecutions: 1`, so **a backfill and a deploy
cannot run at once** - a deploy's migration invoke 429s with
`ReservedFunctionConcurrentInvocationLimitExceeded`. Do not deploy while
this runs. `battle_participant_card.used` is NOT backfilled (~700k rows
for a flag nothing reads) and fills forward.

**Still open: the surface.** Nothing serves the round rows yet, so the
docs say plainly that the limit is now the surface, not the record.

### Mode discipline: what the record actually says (decisions for Jamie)

`deck_selection` has been captured since the beginning and used for
DISPLAY only, never as a filter:

| deck_selection | battles |
| --- | --- |
| collection | 341,753 |
| eventDeck | 16,018 |
| unknown | 6,572 |
| draft | 4,833 |
| warDeckPick | 4,162 |
| draftCompetitive | 1,608 |
| pick | 1,359 |
| predefined | 238 |
| quadDeckPick | 200 |

So roughly **9% of recorded battles were not played on a deck the player
chose from their collection**, and every one of them currently counts
toward "which decks does this player play" and toward the meta.

Two mapping defects found beside it:

1. **The same battle is `casual` in the rollups and `other` in the
   tools.** `MODE_GROUP_BY_TYPE` has no entry for `clanMate` (2,544
   battles) or `unknown` (1,821). The rollup SQL falls back to
   `else 'casual'` (rollups.mjs); the JS readers fall back to `?? "other"`
   (controls.mjs, activity/entries.mjs). One battle, two answers.
2. **`challenge` is in the `mode` enum and matches nothing.** No battle
   of type `challenge` exists in 964,925 archived entries; the
   challenge-shaped battles are `trail`, which maps to `casual`.

Not actioned - each is a product call with a blast radius. Changing a
mode_group mapping re-buckets `player_daily_battle_rollup` (mode_group
is in its primary key) and the meta season tables (CHECK constraints
enumerate the groups), so any remap needs a rebuild, not just a code
change.

## 2026-09-22 — Backfill complete, and what `trail` actually is (it changes the mode design)

**Backfill done and verified.** 71,941 archived objects swept;
**20,218 `battle_participant_round` rows across 4,362 duels** (rounds 1-3,
crowns and elixir on every row, 4,766 players) and **129,162
`battle_participant.global_rank` values, range 1-500** - so the global
board the API reports against is the top 500. Deploy clean afterwards
(migrations 151, stack UPDATE_COMPLETE). Note for next time: the
migrate Lambda is `ReservedConcurrentExecutions: 1`, so the backfill and
a deploy cannot overlap - the deploy's migration invoke 429s.

**Jamie's answers this session:** (1) refusing a battle query with no
mode is "probably the right answer", but a player -> what modes they
play -> battles in that mode path must exist first; (2) decks the player
did not choose are "not informing meta"; (3) "I don't know what trail
is."

**The discovery path for (1) already exists.** `battles_performance`
with `group_by: "game_mode"` returns rows keyed by (game_mode, type)
with battles, record, win rate and last_played, and its own note already
says "filter battles_query by game_mode to drill in". A refusal can
point straight at it; nothing new is needed before the refusal can land.

**What `trail` is: the API's junk drawer.** `{mode_shape_census}` (new)
breaks a battle type down by the game's own mode name. `trail` is
**123,254 battles across 23 distinct game modes**:

| game mode inside `trail` | battles |
| --- | --- |
| TeamVsTeam | **74,169** |
| Ladder | 13,542 |
| Challenge_AllCards_EventDeck_NoSet | 10,071 |
| Showdown_Friendly | 6,001 |
| All_Random_Princess_Friendly | 5,602 |
| Chaos_1v1_Draft | 3,898 |
| Crazy_Arena (+ InfiniteElixir, EpicOnly, SuddenDeath) | 5,302 |
| PickMode, DraftMode_Princess, Heist_Friendly, Draft_Competitive, Event_RestlessDead, ... | the rest |

**Sixty percent of `trail` is 2v2** (`TeamVsTeam`, 74,169) - a different
game with two players a side, not a 1v1 variant. It is currently pooled
into the `casual` mode group with `friendly` and `clanMate2v2`, and
`clanMate2v2` (366) is a rounding error beside it. So "2v2" as a
population is mostly hiding inside `trail`, unlabelled.

This matters for the deck-selection fix: 95,135 of `trail`'s battles
read `deck_selection: collection`, so filtering on deck selection alone
would still let 2v2, Showdown, All_Random and Heist battles inform 1v1
deck statistics. **Deck selection is necessary and not sufficient; the
mode is the stronger signal**, which is what Jamie said. Holding the
implementation of (1) and (2) until the mode grouping is decided with
this in hand, because the two interact and a mode_group remap needs a
rollup rebuild (mode_group is in `player_daily_battle_rollup`'s primary
key and the meta tables' CHECK constraints).

## 2026-09-22 — `type` is the CONTEXT, `gameMode` is the RULESET; and the stakes test comes back mixed

Jamie, on the proposal to split `trail` into `2v2` / `event` / `casual`:
"I don't think that is a good idea. I suspect even when those trail games
look like an existing gameMode they are probably different... there must
be some reason they are stored differently."

**24 of 62 game modes appear under more than one `type`.** The pattern
says the two fields are orthogonal: `gameMode` is the RULESET and `type`
is the CONTEXT it was played in.

| ruleset | contexts it appears in |
| --- | --- |
| `TeamVsTeam` | trail 74,169 · clanMate2v2 271 |
| `Ladder` | PvP 36,699 · trail 13,542 |
| `Crazy_Arena` | trail 3,110 · friendly 209 · unknown 65 · clanMate 4 |
| `Friendly` | friendly 3,734 · clanMate 2,311 · unknown 72 |
| `PickMode` | trail 527 · friendly 368 · clanMate 43 · tournament 39 |
| `CW_Duel_1v1` | riverRaceDuel 3,096 · riverRaceDuelColosseum 1,066 |

So neither field subsumes the other, and a population keyed on `type`
alone (which is what `mode_group` is) merges different rulesets, while a
population keyed on `gameMode` alone merges different stakes.

**The stakes test, and it does not resolve cleanly.** Whether the same
ruleset under a different type carries different stakes
(`{mode_shape_census}`, participant rows):

| ruleset · context | rows | trophy change | starting trophies | global rank |
| --- | --- | --- | --- | --- |
| Ladder · PvP | 73,432 | 97.7% | 100% | 0.8% |
| Ladder · trail | 27,148 | **97.8%** | 100% | **8.9%** |
| Crazy_Arena · trail | 6,220 | 6.1% | 8.4% | 0% |
| Crazy_Arena · friendly | 418 | 0% | 100% | 0% |
| PickMode · trail | 1,054 | 50.0% | 80.5% | 6.8% |
| PickMode · friendly | 742 | 0% | 99.9% | 0% |
| Friendly · friendly | 7,520 | 0% | 100% | 0% |
| Friendly · clanMate | 4,646 | 0% | 100% | 0% |
| TeamVsTeam · trail | 296,684 | 0% | 45.2% | 0% |
| TeamVsTeam · clanMate2v2 | 1,084 | 0% | 0% | 0% |

Jamie's suspicion holds for `Crazy_Arena` and `PickMode` - the trail
copy has trophies at stake where the friendly copy never does - and does
NOT hold for `Ladder`, where trail and PvP are indistinguishable on
stakes (97.8% vs 97.7%). `Friendly` under `friendly` and under
`clanMate` are identical on every column. Unexplained and worth a note:
`Ladder`+`trail` carries a global rank on 8.9% of rows against 0.8% for
`Ladder`+`PvP`, an eleven-fold difference nobody has a story for.

**What follows, and it is the conservative reading.** We do not know
what `type` encodes well enough to either merge on it or split on it.
So: do not invent groupings. The statistical population is the PAIR
(`type`, `game_mode_id`); `mode_group` stays a coarse FILTER convenience
and must never be the boundary a rate is computed over. Elixir already
does exactly this in one place - `battles_performance group_by:
"game_mode"` keys rows on the pair and its note says "the same mode name
recurs under different API types" - and nowhere else. The 2v2 / event /
casual split proposed earlier is withdrawn.

Open question for `cr-agent-api-docs`, not answerable from our record:
why does the API file some Ladder battles under `trail`?

## 2026-09-22 — `trail` is the Seasonal Trophy Road, it is taking over Ladder, and we file it as `casual`

Jamie wondered whether `trail` was an early name for Trophy Road. It is
the opposite: **new, and arriving fast.**

`{mode_shape_census}`, Ladder-mode battles by month and type:

| month | PvP | trail | trail share |
| --- | --- | --- | --- |
| 2026-03 | 4,377 | 0 | 0% |
| 2026-05 | 4,909 | 0 | 0% |
| 2026-06 | 4,678 | 323 | 6.5% |
| 2026-07 | 5,322 | 555 | 9.4% |
| 2026-08 | 5,269 | 1,049 | 16.6% |
| 2026-09 | 5,458 | **11,651** | **68.1%** |

Nothing before June 2026; two thirds of September. Supercell's June 2026
release notes bring back a reworked **Seasonal Trophy Road**: Seasonal
Arena I (your own deck) and Seasonal Arena II (your eight most-won-with
cards BANNED, low cards boosted to a minimum Level 15). The timing is
exact.

**Jamie's suspicion was right, and for a bigger reason than stakes.**
Trophies do NOT tell them apart - a trail Ladder loss deducts (12,993 of
13,578) exactly as a PvP Ladder loss does (35,033 of 36,716). What tells
them apart is the CARD LEVELS:

| Ladder-mode battles | rows | mean deck level | median | >= 14.5 | range |
| --- | --- | --- | --- | --- | --- |
| `PvP` | 73,436 | 13.67 | 14.63 | 52.8% | 2.00-16.00 |
| `trail` | 27,154 | **15.87** | **16.00** | **99.9%** | 11.50-16.00 |

That is Seasonal Arena II's Level 15 floor, visible in our own record.
The decks in a trail battle are not the player's decks at the player's
levels.

**The live consequence, and it is bad.** `MODE_GROUP_BY_TYPE` maps
`trail` to `casual`. So since June we have been filing the Seasonal
Trophy Road as casual play, and by September that is 11,651 of 17,109
Ladder-mode battles a month. Two failures at once:

1. **`ladder` statistics are losing most of the ladder.** A player's
   Trophy Road record, trends and trophy maths see only the `PvP` third.
2. **`casual` is contaminated with level-16 decks.** Any level gap, deck
   strength or card win rate computed over casual - or over an unfiltered
   population - is reading Seasonal Arena II's floor as player progress.
   `casual` is already the largest rollup group (173,614 rows); this is
   why.

This is the concrete form of Jamie's rule ("game modes are really played
as a different game... querying battles without a mode is probably a
bug"), and it is not hypothetical: it is happening now and growing
monthly.

Not actioned - a remap re-buckets `player_daily_battle_rollup` (mode_group
is in its primary key) and the meta tables' CHECK constraints, so it
needs a rebuild and Jamie's call on the grouping. Recorded in
`cr-agent-api-docs` for any caller.

## 2026-09-22 — The 2v2 tournament, and a correction to yesterday's "trail is taking over" claim

Jamie: "there was just a 2v2 tournament in CR, it ended, I bet that was
Trail / TeamVsTeam." Correct, to the day.

Daily battles, `type: trail`:

| day | TeamVsTeam | players | Ladder | players |
| --- | --- | --- | --- | --- |
| 08-25 to 09-06 | 68-680 | 49-460 | 216-878 | 134-503 |
| 09-07 | 3,976 | 2,646 | 1,338 | 761 |
| 09-11 | 16,192 | 7,097 | 1,882 | 1,066 |
| 09-20 | **40,680** | 8,790 | 1,542 | 891 |
| 09-21 | 24,948 | 4,793 | 1,648 | 926 |
| 09-22 | **372** | 233 | 1,022 | 588 |

A two-week event: baseline until 09-06, fifteenfold on 09-07, peak
09-20, and back to baseline the day after it ended. `Ladder` inside the
same `type` does none of that - it runs level at 1,000-2,700 a day.

**So one `type` held a permanent format and a fortnight's tournament at
once.** That is the sharpest possible argument for Jamie's "the pair is
the thing": grouping on `type` pools them and sees neither.

**Correction to the entry above.** Its framing - trail "takes over"
Ladder, 6.5% to 68.1% - is confounded and I have corrected the public
copy in `cr-agent-api-docs`. Two reasons the monthly share is not a
game-wide migration:

1. **Our corpus is not a constant population.** Distinct players per
   month: 23,895 in August, **140,943 in September**. Battles: 22,716 to
   301,861. Broad multi-clan recording began 2026-09-03.
2. **The new population plays a different game.** September by type:
   `pathOfLegend` 174,240, `trail` 101,960, `riverRacePvP` 6,375, and
   `PvP` **5,458 - flat since March**. We began recording a large, high-
   level population that plays Path of Legends and the Seasonal Road and
   barely touches Trophy Road. A share computed over it says who we
   record, not what the game did.

What survives unchanged, because both are measured WITHIN a population
rather than across months: `trail`+`Ladder` does not exist before June
2026, and its decks carry Seasonal Arena II's Level 15 floor (mean 15.87
vs 13.67, median 16.00, 99.9% at or above 14.5). The level finding is
the one with teeth for us, and it is untouched by the ramp.

Lesson worth keeping: any month-over-month claim from this record must
be read against `players_per_month` first. The corpus grew 6x in a month.

## 2026-09-22 — `event_tag` is the discriminator, not the type and not the pair (Jamie's model, confirmed exactly)

Jamie: "They have some event, they slot it to a type and a mode bound in
date period or maybe even a season." That is exactly what the API does,
and it stamps the answer on every battle.

**`type: trail` means "this battle belongs to a time-bound event".**
Event-tag presence by type, whole record:

| type | battles | carry event_tag |
| --- | --- | --- |
| `trail` | 123,562 | **100.0%** |
| `pathOfLegend` | 186,948 | 0.0% |
| `PvP` | 36,742 | 0.0% |
| `riverRacePvP` | 12,198 | 0.0% |
| `friendly` | 6,022 | 0.0% |
| duels / boat | 6,444 | 0.0% |
| `tournament` | 2,144 | 0.0% (100% `tournament_tag`) |
| `clanMate` | 2,581 | 62.2% |
| `clanMate2v2` | 366 | 71.0% |

100% and 0%. No permanent format has ever carried one. `tournament` is
the same shape with its own tag; a `clanMate` friendly carries one when
it was played under an event's ruleset.

**The pair is a SLOT Supercell reuses, so the event is the population.**
`trail`+`TeamVsTeam` carries ten distinct event tags,
`trail`+`Showdown_Friendly` twelve:

| type · gameMode · event_tag | battles | window | days |
| --- | --- | --- | --- |
| trail · TeamVsTeam · `#2C9J990U` | 67,475 | 09-07 → 09-21 | 15 |
| trail · TeamVsTeam · `#2RC8CL00` | 1,690 | 08-03 → 09-07 | 36 |
| trail · TeamVsTeam · `#2PRCGVPP` | 1,180 | 06-01 → 07-06 | 36 |
| trail · Ladder · `#2C9JG9GP` | 10,719 | 09-07 → 09-22 | 16 |
| trail · Ladder · `#2RC8C0JU` | 1,920 | 08-03 → 09-07 | 36 |

And Jamie's "or maybe even a season" is literal: the **36-day windows
land exactly on season boundaries.** `#2RC8C0JU` runs 2026-08-03 to
2026-09-07 - season 135 to the day. `#2PRCGVPP` runs 2026-06-01 to
2026-07-06 - season 133. A recurring format is re-tagged every season;
one-offs get a short window of their own.

One tag can span pairs: `#2C9JG9GP` is on both `trail`+`Ladder` and
`clanMate`+`Friendly` - one event offering several ways to play it.

**This supersedes the (type, gameMode) pair design.** The rule is
simpler and it is the API's own:

1. `event_tag is null` -> a permanent format; group by `type` as now.
2. `event_tag is not null` -> event content; the EVENT is the
   population, and it is date-bound by construction.
3. Never pool an event-tagged battle with a permanent format, and never
   pool two event tags because they share a mode name.

Which also settles the Seasonal Road: it is event content with a
per-season tag, not a permanent format, so it never belonged in `casual`
and does not belong in `ladder` either.

We already store `event_tag` on every battle and have never read it.

## 2026-09-22 — 6.16.0 ships the duel rounds; and the backfill broke clans_participation (visibility map), fixed

**Shipped: contract 6.16.0.** `battles_query` duel rows carry `rounds[]`
- each game's own crowns, `tower_hp` and `elixir` INCLUDING a per-round
`differential` - on the round numbers `deck.rounds[]` already used, and
`global_rank` rides every participant. Both full verbosity only. Read
back live: a real duel returns `round 1 crowns 0, king 7728, leaked 4.60
vs opponent 11.35, differential -6.75`. That differential is the thing
/docs/battles told players could not be computed; the page now says what
`rounds[]` is instead of apologising for its absence.

**Then the deploy's acceptance gate went red on six cases, and one was an
outage I had caused.** `clans_participation` was REFUSING with
`query_timeout` - 17.5 s at one week, refused at two and eight - and
Elixir Clan calls it once per evaluation.

Cause: **my global_rank backfill UPDATEd 128,818 `battle_participant`
rows**, which clears the visibility map. Migration 0086 exists precisely
to make these reads index-only (`battle_participant_player_time_cover`,
"~200 index pages instead of 14.5k heap pages"); without an all-visible
map the index-only scan dies, the planner falls to
`battle_participant_deck`, and the plan reads 17,323 heap blocks with
7.9 s of I/O. `{vacuum}` reported `relallvisible` **17,882/32,642 (54.8%)
-> 32,642/32,642 (100%)** in 28 s.

| call | before | after |
| --- | --- | --- |
| `clans_participation {weeks:1}` | 17,555 ms | **906 ms** |
| `clans_participation {weeks:2}` | refused | **673 ms** |
| `clans_participation {weeks:8}` | refused (23,979 ms) | **1,830 ms** |
| `battles_meta_decks {segment:mine}` | 10,774 ms | 8,460 ms |

`battle` and `battle_participant_card` were also short (98.8% and 92.2%)
and were vacuumed to 100%. Gate re-run: **277 cases, 0 failed.**

**The durable fix:** `battle-detail-backfill.mjs` now vacuums what it
wrote before it exits, and `battle_participant_round` joined the
vacuumable set. A backfill that does not vacuum is not finished. The
visibility-map trap was already written down and I did not apply it -
the script now applies it for me.

**Watch:** `battles_trends {segment:"mine"}` UNBOUNDED still refuses at
~23.8 s (bounded to 30 days it answers in 11.2 s). The catalogue's case
passes, so the gate is green, but the unbounded season read is close to
the edge and the corpus is growing fast.

## 2026-09-22 — 6.17.0: event content is its own mode group, and the meta stops counting what it should never have counted

Jamie: "game modes are really played as a different game... ever querying
battles without a mode is probably an indicator of a bug", and on the
decks the player did not choose, "yes, these are not informing meta".

**The line is the API's own.** A battle inside a time-bound event carries
an `eventTag` and a permanent format never does - `trail` 100% of
123,562 battles, `pathOfLegend`/`PvP`/`riverRace*`/`boatBattle`/
`friendly` 0%. So `event` is a mode group decided by the TAG, not the
type. `modeGroupOf(type, eventTag)` and its SQL twin `modeGroupSql` live
in contracts, so ingest, the meta rollup and every reader share one
definition and cannot drift. Verified live: `mode: event` returns only
`trail`, `mode: casual` only `friendly`, `mode: ladder` only `PvP` -
casual no longer carries the Seasonal Trophy Road, and every non-event
mode excludes tagged battles so it cannot refill.

**The meta population excludes two things** (`META_POPULATION`, one
place, because every caller's fromWhere joins `battle b`): event content,
and a deck the player did not choose (`deck_selection` outside
`collection` and `warDeckPick`). A null deck_selection is KEPT - a
population is not narrowed on an absence. September's population went
**704,594 rows -> 370,610**, and `trail` rows in the meta went to
**zero**.

### Three things that nearly shipped wrong

1. **`add()` would have desynced the bind.** The shared clause helper
   always pushed a parameter, so a parameterless predicate
   (`b.event_tag is null`) would have left the text referencing $n while
   the array held n+1. It now skips the push when the clause has no
   placeholder; six definitions.
2. **A rebuild could not express this change.** `buildPopDays` SKIPS
   sealed days and UPSERTS the rest, so rows that no longer qualify are
   never revisited: the first `{meta_rollup_season}` ran clean, reported
   `days: {built: 2, changed: 180}`, and left all 326,370 `trail` rows in
   place. It looked applied and was not. `{reset: true}` now drops the
   population, the day ledger and the cursors first. **A rebuild that
   only adds cannot implement a removal.**
3. **The repair had no progress signal.** The cursor form reported the
   same `pairs_total` every call, so a loop could not tell done from
   stuck. An unrepaired pair is now defined as one holding an event
   battle whose rollup has no `event` row yet - repairing it leaves the
   set, so the count is real and the loop self-terminates.

Also: pair-by-pair repair measured 20 s per 500 pairs - near two hours
for 166k, on a Lambda with reserved concurrency 1 and a database that
had already shown today what heavy batches do to it. One DELETE and one
INSERT per slice instead.

**Still open, both contract-breaking and deliberately not folded in
here:** refusing a battle query with no `mode`, and (Jamie, same
session) refusing an unbounded window - "the battle corpus is just going
to grow". The discovery path a refusal needs already exists:
`battles_performance group_by: "game_mode"` keys rows on the
(game_mode, type) pair and already says "filter battles_query by
game_mode to drill in".

## 2026-09-23 — The refusals are a 7.0.0 with a real migration: measured, not shipped

Jamie asked to move forward with refusing a battle query that names no
`mode` and, separately, one with no window ("the battle corpus is just
going to grow"). Both were built and both were measured against the
suite. **Neither shipped**, because the migration is larger than the
change and the numbers are the argument.

**Mode refusal.** `requireMode` on the tools that AGGREGATE
(`battles_performance` except `group_by: "game_mode"`, `battles_cards`,
`battles_decks`, `battles_compare`, `battles_opponents`,
`battles_trends`, `battles_meta_decks`, `battles_meta_cards`), with a
refusal naming the discovery path. Result: **107 failing tests across
152 call sites in 10+ files.** Those call sites are the same shape every
consumer uses - elixir-bot, the Discord preview, Elixir Clan, the web
app - and each needs the RIGHT mode for its fixture, which varies, so it
is not a find-and-replace.

**Window default.** Flipping `seasonDefault` from false to true on the
player battle tools, so an unbounded read bounds to the current season
and says `applied.window.source: "season"`. Non-breaking in shape but a
real behaviour change: **21 failing tests**, because the fixtures'
battles sit outside the current season and a bounded read correctly
returns nothing.

A caution on how that was measured: `npm run verify` is
`format:check && lint && knip && typecheck && test`, so a knip failure
(an unused export, while the guard was half-reverted) SHORT-CIRCUITS
before the tests run. A run that ends on knip is not a green test run -
it is no test run. That briefly read as "the window default breaks
nothing".

**A better shape for the mode half, worth weighing before the migration
is paid for.** The tools already compute what is needed:
`pooledModesNote(groups)` returns null when fewer than two mode groups
carry battles, and already drives `comparable`. Escalating THAT to a
refusal - refuse only when the population actually spans mode groups,
and name the split - has the properties the blanket rule lacks:

- it refuses exactly the wrong answers and nothing else;
- a caller whose window was always one mode keeps working, so most of
  the 152 sites never change;
- the refusal can print the real split rather than a generic "pass mode".

Its cost is that the same call can succeed for one player and refuse for
another, which is worse for a client author than a flat contract. That
is the trade, and it is Jamie's call.

**Recommendation:** do it as a deliberate 7.0.0 with the migration
planned - update the suite, then elixir-bot, `elixir-mcp-discord`,
Elixir Clan and the web app - rather than as a tail-end change. The
discovery path a refusal needs already exists and needs no work:
`battles_performance group_by: "game_mode"` keys rows on the
(game_mode, type) pair and already says "filter battles_query by
game_mode to drill in".

Main is green and unchanged; nothing from this experiment is committed
beyond this note.

## 2026-09-23 — 6.18.0: the comparisons the row always held, and the duration its signature proves

Jamie, 2026-09-22: "battles contain information that we should connect
for consumers. Elixir leaked for example is most meaningful in a
comparison between... are there comparison metrics we should be
calculating?" The record held both halves of every one and made none.

**`me.vs`** on every head-to-head row, each as me MINUS the one
opponent: `crowns`, `deck_level` (the level edge in THAT battle, from the
cards as played - not a career average), `starting_trophies` (what
matchmaking paired) and `tower_hp` (hitpoints REMAINING on both sides, so
a margin of victory, never a tower level). Null on 2v2 and duels, and per
field where a side's value is missing. Live, one page of ladder:

```
2-1 win   vs: crowns +1  level +1.00  trophies  -29  towerHP +5265
0-1 loss  vs: crowns -1  level +1.75  trophies    0  towerHP  -205
```

The second row is the point: a loss while a full 1.75 levels up, decided
by 205 hitpoints. Neither number was reachable without a caller reaching
into two nested objects and differencing them.

**`inferred.duration`** on head-to-head 1v1 rows. The log carries no
duration; the game's clock makes the crown pair a bound. A King Tower is
the only way to end before regulation, and overtime ends on the next
tower, so: three crowns -> `at_most_s` 300 with no floor; unequal and
neither 3 -> `at_least_s` 180; level -> `exact_s` 300, because overtime
expired and the tiebreaker resolved it. `basis` is
`king_tower_fell` / `regulation_ran` / `overtime_expired`. Absent on
duels and boat battles, where neither rule holds. A bound the signature
PROVES, never a timing.

Asked for and NOT built: king tower LEVEL comparison. The payload has
only `kingTowerHitPoints`, which is hitpoints remaining; a tower's level
is in the player profile, not the battle. `tower_hp` is the honest
version of that question.

### The row had no room, and the gate caught it

`battles_query` full at limit 10 went to 51,097 characters against the
48,000 cap - a shape a real caller uses, which is why the usage-derived
catalogue had a case for it. Three rounds of trimming, in order of how
much they were worth:

1. `basis` was a SENTENCE on every row. It is an enum now, explained
   once in the note. (~500 characters.)
2. The elixir caveat rode every ROUND of a duel, which I had added -
   ~1.8 KB on a three-round duel. The row's own elixir object already
   carries it.
3. `ELIXIR_CAVEAT` itself was ~295 characters on every participant of
   every row: **6 KB of one repeated sentence on a ten-battle page.** It
   stays ON the value, which is the 6.0.0 decision from feedback #66, at
   about half the length.

The lesson worth keeping: `battles_query` at full verbosity is at its
ceiling, and its guard still allows `limit: 25` while about 9 rows fit.
Anything added to that row now costs someone a page. The `limit > 25`
refusal should probably become a size the row can actually honour.

Gate green after the fix: 277 cases, 0 failed.

## 2026-09-23 — How to decide which battle indexes are worth building (method, and what the evidence says today)

Jamie asked how we would determine which new ways of indexing battles
would be good. The answer is that we already collect the evidence and
have barely read it. Five signals, ranked by how sharply each points at
a missing tool. All are read-only ops that exist.

**1. Pagination walks — the loudest.** A `cursor` in an argument set
means the tool did not answer the question and the caller is assembling
the answer itself. `{args_census: {days: 30}}`, `key_sets`:

```
battles_query  cursor,days,limit,player_tag,verbosity   316 calls
```

**316 of 816 `battles_query` calls (39%) are one agent walking a
player's history page by page**, at ~18.5 KB a page. Nothing in our own
clients does this - `elixir-mcp-discord` uses `next_cursor` only for the
events feed - so it is a MODEL deciding it needs every battle. That is
the shape of a missing index: whatever it computes from the raw list is
a tool we do not have.

**2. Refusals, by code.** A refusal is a question the product could not
answer. `{refusal_census: {code, days}}` and `top_errors`:
`battles_meta_cards query_timeout` 18, `battles_meta_decks
query_timeout` 11, `battles_query bad_request` 10, `battles_cards
bad_request` 10, `battles_query timeout` 8.

**3. Truncation — the shape is wrong for the question.** `battles_query`
is the fattest tool we serve: avg 18.5 KB, max 130 KB, truncated 17
times in 30 days. Everything else is under 12 KB.

**4. Never called.** `elixir_track_player`, `elixir_track_clan`,
`badges_holders`, `cards_archetype` - zero calls in 30 days.
`cards_archetype` shipped in 6.8.0 and no one has used it once: either
undiscoverable, or it answers a question nobody has. Worth knowing
before building another like it.

**5. Cost.** A tool that is slow is often indexed on the wrong thing
rather than merely unoptimised: `battles_levels` avg 6.6 s,
`battles_meta_cards` avg 5.8 s / p95 18.2 s, `battles_trends` p95 16.3 s.

### What makes a candidate good

1. It collapses a measured pagination walk (signal 1), a refusal (2) or
   a truncation (3) - not a shape someone imagined.
2. The index is ALREADY in the data. This session added four axes
   nothing can query on yet: `event_tag` (which event a battle belonged
   to), `inferred.duration` (how long it must have run), `vs.deck_level`
   (the level edge in that battle) and `global_rank` (whether the
   opponent was ranked). Each is a "show me battles where..." nobody can
   ask.
3. It respects the population rules, or it is another pooled number:
   mode, event content, and decks the player did not choose.
4. It answers a question a PLAYER asks, not a shape the data happens to
   have. "Did I lose that while outlevelled?" is a question; "index by
   princess tower hitpoint bucket" is not.

### The decisive next measurement, not yet taken

Identify what the 316-call walker is computing. The audit has the
caller, the arguments and the timings; what it lacks is the sequence -
which tools were called around the walk, by the same account, in the
same minute. A call-sequence cut of `mcp_call_audit` would turn the
loudest signal into a named tool. That is one op and it should come
before any new battle tool is designed.

## 2026-09-23 — The sequence census, and a correction: the loudest signal was our own test harness

`{call_sequence_census}` groups `mcp_call_audit` into TURNS (one account,
no gap over `gap_s`) and collapses runs, so the shape of a turn is
visible. 19,824 calls, 10,274 turns, 30 days.

**Correction to the entry above.** It said 316 of 816 `battles_query`
calls were "a MODEL deciding it needs every battle" and that "nothing in
our own clients does this". Both wrong. The walk is the **acceptance
suite**:

```
turns 2   pages 347   [acceptance]   battles_query | with: (nothing else)
```

Two turns, 347 pages, no other tool beside them - our own gate paging
through battles, which is what it is supposed to do. Counting arguments
found a pattern; only the sequence said whose it was. That is exactly
the failure mode the sequence cut exists to catch, and it caught it on
its first run against my own claim.

**What the turns actually look like:**

| turns | shape | client |
| --- | --- | --- |
| 7,683 | `elixir_timeline` alone | Claude Code |
| 655 | `elixir_events -> elixir_my_feedback` | elixir-mcp-discord |
| 435 | `elixir_my_feedback -> elixir_events` | elixir-mcp-discord |
| 468 | `elixir_events` alone | Claude Code |
| 22 | `players_timeline -> battles_performance` | elixir-bot |
| 18/16 | `elixir_timeline <-> game_clock` | elixir-kings-discord |
| 9 | `elixir_timeline -> war_current -> game_clock` | elixir-kings-discord |

**So the evidence does not currently support a new battle index.** The
dominant traffic is timeline polling; the battle tools are used in
ISOLATION, in ones and twos, and the only real multi-tool battle turn is
elixir-bot's `players_timeline -> battles_performance` (22 turns). The
rich 8-9 tool turns exist but are single occurrences - an agent
exploring once, not a pattern.

That is a useful answer rather than a disappointing one: the method
stopped us building on a signal that was our own test harness. Three
things it leaves standing, all from the earlier counts and none
refuted by sequence:

1. `battles_meta_cards` / `battles_meta_decks` `query_timeout` (18 + 11
   in 30 days) - a question the product cannot answer at all.
2. `battles_query` truncation (17 in 30 days, avg 18.5 KB, max 130 KB) -
   the fattest tool we serve, and at its ceiling since 6.18.0.
3. `cards_archetype` shipped in 6.8.0 and has never been called once.
   Before designing another battle tool, it is worth knowing why that
   one found no users.

**The method stands; only my reading of it was wrong.** Any future claim
from the audit should be checked against the sequence and the CLIENT
before it is believed - a count alone cannot tell an agent from a test.

## 2026-09-23 — Keep the Boards: equality restored; aggregate audit blocked

The clean, mutation-eligible preflight and public status reader were healthy
at 10:18Z (21-second fetch/admission freshness, empty DLQ, five active
collectors). The board client then returned a zero-delta post-sync dry run for
all four configured collections: global, United States and Japan each held 100
players, and the global clan collection held 10 clans. No collection was
skipped or collapse-held, so the collections equal the recorded boards.

This run exposed an operational safety flaw: `boards.mjs --help` was not
handled as help and therefore fell through to its default live synchronization
before a checkout lease was claimed. Treat that synchronization as an
unleased write; do not infer a successful lease from the later local repair.
The client now handles `--help` / `-h` without loading a token or calling the
door, and rejects every other unknown option before it can write. Its focused
fake-door test covers both paths.

The authoritative read-only `{stats:true}` `ranking_health` receipt could not
run because the Jamie AWS session is expired. Accordingly this run makes no
current claim about the singular 10:00Z global receipt, the 262-location
freshness count, global `truncated`, or active ranking-origin recording count;
those remain the first checks after the credential is renewed. The October 5
season boundary guard is not yet in scope.

## 2026-09-23 — 6.18.1 and 6.19.0: the Gym's second-pass findings, both shipped

**#89 (6.18.1), mine.** 6.15.0's boat note names `points / scoring_decks`
as the rate boat decks contaminate and then quoted each member's share
against `decks_used`. On a week that finished those differ: ryguy67 read
"1 of 8" where the rate's own denominator makes it 1 of 4, exactly
double - the same class as #85, one level in. The share is of
`scoring_decks` now and reads "up to", because `boat_attacks` is the
WEEK's counter and a boat attack played after the finish is outside
`scoring_decks` entirely, so the figure is a ceiling on the
contamination and not a measurement of it. Live: "ryguy67 up to 1 of 4
scoring decks". The fixture reproduces that exact shape - 8 used, 4 after
a day-3 finish, one boat attack - so the test fails on the old text.

**#88 (6.19.0), Jamie chose option B.** The war family's `clan_score` is
WAR TROPHIES. A clan carries two numbers the API both spells as a score:
`clanScore` (129,512 for #J2RGCRVG) and `clanWarTrophies` (1,200), and a
race payload reports the second under the first's key. We relayed it
faithfully and then told readers it was "the same figure a clan's profile
shows" - that sentence is what invited a cross-family join wrong by two
orders of magnitude.

Confirmed twice, the second time without the API at all: our own
`our_clan_score` series runs 980, 1000, 1020, 1040, 1060, 1160 across
135/0-136/0, rising by exactly each week's `trophy_change`. A clan score
does not move in trophy steps.

`clan_war_trophies` now rides `war_current.standings[]`,
`war_history.standings[]` and `war_rivals`, and
`weeks[].our_clan_war_trophies` rides beside `our_clan_score`. The old
names are DEPRECATED aliases of the same number, kept so nothing breaks
today and removed at 7.0.0 - **one break, not two**, bundled with the
mode and window refusals already queued for that version.

The COLUMN keeps the payload's spelling on purpose: renaming it would
hide which key it came from. 0154 comments the truth onto it and the
payload manifest names it the way the war BOARD's entry already did -
which is the detail worth keeping, because the manifest had already
disambiguated this exact overload in one place and nobody carried it to
the other. `cr-agent-api-docs` now records it for any caller.

Test note: the trophy-ladder property is real but NOT run-order stable
here, because earlier tests in the file rewrite individual weeks. The
test asserts magnitude instead (a clan score is five or six figures, war
trophies four), which catches the same regression and does not depend on
what ran before it.

## 2026-09-23 — Closing out: the clock-edge was the environment, and four small fixes

Jamie dropped the 7.0.0 refusals and asked for the remaining items.

**The `clans_standings` clock-edge is NOT a product bug.** The daily
rollup's day KEY is written in UTC (pipeline.mjs takes
`battle_time.slice(0,10)` off the ISO string) while its day WINDOW was a
plain date cast against a timestamptz, which resolves at the SESSION
zone. Where the two zones disagree a battle in the offset hours lands in
neither. Proven in SQL rather than argued: on a `Pacific/Kiritimati`
session a battle at 11:00Z on 2026-09-23 has UTC key 2026-09-23, session
date 2026-09-24, and the old window matches **0** rows where the new one
matches **1**.

`{tables}` now reports `TimeZone`, and **production reads UTC** - it was
never wrong there. What was wrong is a developer machine on
America/Chicago, for the five hours after UTC midnight, which is exactly
when the test went red and looked like a live bug. Every date boundary in
`rollups.mjs` and `daily-sql.mjs` now says `at time zone 'UTC'` instead
of depending on a setting nobody had checked. Worth keeping: node-pg does
NOT read `PGTZ` (libpq does), so `PGTZ=... npm test` proves nothing - the
session zone has to ride the connection string.

**6.19.1, three honesty fixes.** `war_rivals` rounds `mean_fame` and
`median_fame` and now says so; `weeks[].finished_early` is NULL rather
than `false` on a week still in progress, which is the one wrong answer
that flag exists to prevent; `battles_query`'s `limit` description no
longer implies 25 full battles is a safe page.

**A guard I tried and reverted.** Lowering the full-verbosity page limit
from 25 to 10 broke 30 tests - and they were right: a page that FITS
should still be served, and the `result_too_large` refusal already
prices the retry from the actual bytes. The description was the only
thing that had gone stale.

**`princessTowersHitPoints`: no bug.** I had flagged that our
`tower_hp.princess` served `[2069, 0]` where the reference says a `0`
never appears on head-to-head rows. Checked the live API directly: 52
head-to-head participant rows, **zero** entries containing a 0 - 24 with
a destroyed tower omitted, 11 null. The reference is right, the `0` is
OUR padding, and our own docs already say so ("the array is always
padded to length 2"). Both were correct; only my reading was not.

**The meta timeouts, diagnosed not fixed.** 29 `query_timeout` refusals
in 30 days. The argument sets are whole-population, whole-season reads
with a sort and a limit - and `mode` appears on exactly **1 of 29**.
Narrowing the population is what these calls never do. A real fix is
query work and wants its own session; the shapes are recorded here so it
does not start from scratch.

**`cards_archetype` has never been called, and the reason is testable.**
Zero calls since 6.8.0. It is on three docs pages and named in its own
tool's note - and in no other tool's RESPONSE. The contrast is
`battles_performance group_by: "game_mode"`, which `battles_query`'s
description names and which agents used 112 times in the same window.
So: an agent finds a tool because another tool's ANSWER names it, not
because a docs page does. `group_by: "archetype"` now folds decks into
labels and then says what reads a label. If the call count moves, the
hypothesis holds and the same move is worth making for the other unused
tools.

## 2026-09-23 — The Gym moves into the repo as a skill, with its own account

Jamie's direction, after the session's project review: Elixir is not public
yet on purpose, and the Gym exists so that the first outside user finds no
bugs. The Gym had run as a daily Claude Cloud routine on Jamie's connector.
In practice it kept landing on the war tools, and only `rankings` and `war`
have ever been explored. The plan: sweep all ten MCP families (`live_*`
excluded) in a loop until each has a clean run, then announce.

**Built:**
- `.claude/skills/gym/`:
  - `brief.md` is Jamie's prompt, adapted only where running here requires it.
  - `SKILL.md` is the orchestrator: `/gym`, `/gym <family>`, `/gym sweep`.
  - `call.mjs` is the Gym's connection.
  - `check-appendix.mjs` holds the same load rules as `gymCases`, plus
    no-live, no-write and player_tag.
  - `coverage.md` is the grid.
- **Jamie's standing authority for the sweep:** fix and deploy each family's
  findings without asking. There is one contract bump per family round, and
  no majors.

**The Gym's own account.** It is the `gym` agent principal:
- clan `#J2RGCRVG`, scope `cr:read feedback:write`, door `/a/cd9e89e10d09/mcp`;
- the token was minted locally, the way `acceptance`'s was, and the raw value
  sits in `.claude/skills/gym/.env`, mode 0600 and ignored by git.

It spends from its own bucket, so it no longer takes Jamie's hour or the
Discord agent's. Its filings also stop counting as Jamie's feedback.

Findings #1–#89 stay on Jamie's account. The orchestrator hands the Gym the
ones relevant to its family as a legacy list.

**Queued for Jamie:**
- `{service_token_limits: {name: "gym", hourly_rate_limit: 900}}` on
  `elixir-mcp-migrate`. The session's permission check refused the live
  write.
- Pause or retire the cloud routine. It would double-file against a sweep.

## 2026-09-23 — Phase 1 engineering debt, and the clan meta timeouts traced to one probe

The project review earlier today led to this. Jamie's plan, in order:
engineering debt, then the slow tools, then a Gym sweep across every MCP
family, then launch.

**Shipped (Phase 1):**
- **0155:** the database's default session zone is UTC. There were 68
  unqualified date expressions over 98 places that each open their own
  `pg.Client`. Pinning the zone at the database covers every connection at
  once, where a client helper would have touched 257 call sites.
- **One file per tool** for battles, elixir, war and rankings: the four
  largest modules, 2,903, 1,580, 1,185 and 1,070 lines. The move is
  mechanical: the old module is the index and keeps the key order.
- **6.19.2:** the `finished_early` note says "never recorded" instead of
  "without a standings capture". The old wording tripped the Gym's control
  84.2, whose regex saw `cap…line`.
- **`docs/DECISIONS.md`:** 99 standing decisions and the declined ideas.
  NOTES.md now holds only the current week; weeks 36 to 38 are in
  `docs/notes/`.

**`{profile_tool}` replaces writing another explain op.** It runs the
registry's own handler as a named principal, with every query timed and
explained, on a read-only session. Its first read found that
`{explain_meta}` was stale: it still profiled a join to `battle` that the
tool had dropped at 0095/0099.

**The clan meta timeouts, measured.** The 3-day audit counted 9
`battles_meta_cards` and 4 `battles_meta_decks` `query_timeout` refusals,
from the Discord agents' `segment: mine` reads. Timed through the Gym's
door, from a quiet database:

| read | before |
| --- | --- |
| meta_cards mine, season | 8.2 s |
| meta_cards corpus, season (rollup) | 0.5 s |
| meta_decks mine, season | 6.7 s |

The corpus is fast and the clan, about 50 players, is slow. `{profile_tool}`
on the mine read put 5.4 s of 11.8 s in one query. Inside that query,
nearly everything was the level-gap lateral: 6,780 primary-key probes
reading 8,252 blocks from a cold cache. The excluded breakdown took 9 ms.
The same probe sat at seven reader sites and the standings SQL.

**0156** stamps `opp_deck_avg_level` on the participant at ingest.
A test holds it equal to the lateral on every fixture row.
`{opp_level_backfill}` fills history: a battle-id keyset, 45 s per
invocation, nulls only, then a vacuum. The readers switch to the column in
the next commit, after the backfill is done. That keeps the order the
0099/0151 incidents taught: expand, fill, vacuum, then read.

**Jamie, for decision (not acted on):** the cost and capacity picture from
the review.
- The charges alarm threshold ($40) sits below normal spend of about
  $90-100 a month. September's spike was the one-time $95 reserved-instance
  purchase.
- RDS storage grows 0.3-0.45 GB a day; the alarm and autoscaling are due
  around 10-18 to 10-22.
- The micro swapped up to 551 MB, and its EBS byte balance hit 0 three times.

"RDS stays db.t4g.micro" is a standing decision. This entry records the
evidence against it and does not reopen it.

**Backfill receipt (14:36-14:59Z):**
- 387,549 battles and about 895,000 participant rows stamped.
- The first invocation used 5,000-battle batches. On a cold cache each batch took about 46 s, so the invocation ran 93 s, past the migrate-duration alarm line. The alarm stayed OK. The driver was stopped and restarted from its cursor at 1,000-battle batches with a 40 s budget and a 5 s pause, and the run took 20.5 minutes.
- EBS byte balance was 90% at the start.
- `{vacuum}`: relallvisible 14,147 went to 34,101 of 34,101, and relpages held at 34,101, because the updates were HOT.

The readers then moved to the column.

**6.19.3, and where Phase 2 stops.** Timed live after each deploy through
the Gym's door (the acceptance gate passed every time, 277 cases and 0
failed):

| call | before | after |
| --- | --- | --- |
| meta_decks mine, season | 6.7 s | 0.4 s |
| meta_cards mine, season | 8.2 s | 2.3 s (1.0 s warm) |
| trends clan, 4 weeks | 14.5-22 s | 4.3 s |
| trends player, 8 weeks | - | 0.2 s |
| cards_card Knight corpus season | 9.5 s | 8.4 s |
| meta_cards corpus, 7 days | 7.5-9 s | 7.5 s |

Two corpus reads are left. Both are inside the 18 s budget now that they
carry the 32 MB `work_mem` and return a structured `query_timeout`. Taking
them lower means a card-pair or deck-player rollup, and 0122 already
measured the pair rollup as not fitting the micro. Phase 2 stops here.

## 2026-09-23 — Gym sweep, badges round 1 (6.20.0, feedback #91-#94)

The first run of the sweep from the repo, on the Gym's own account (report
`.claude/skills/gym/reports/2026-09-23-badges-r1.md`, local). Regression
#18 was confirmed fixed. Four findings, all verified against the code
before touching it:

- **#91:** a holder row's `observed_at` was player_badge's stored stamp.
  The upsert moves that stamp only when a badge CHANGES, which is the
  write-avoidance rule of 2026-09-11. It is now served as `since`, and
  `observed_at` is the last profile poll, as the glossary defines it. The
  poll comes from a lateral per row on the page, after the limit.
  `observations` on both tools is the range of profile polls.
- **#92:** `_v2` was dropped from labels by design (09-19), which made two
  badges share one label. A versioned identifier now says `(v2)`, while a
  dated seasonal badge keeps its month label. Rarity notes a listed pair,
  and "2v 2" is fixed.
- **#93:** a label resolves to its identifier. A shared label is refused
  with both identifiers, and a miss is refused about the argument, with
  identifier and label candidates.
- **#94:** `holder_share` is served; the notes are scoped per tool; and
  `badges_holders` has an outputSchema.

The Gym's 16 cases went into gym.json unchanged, and six bites fail on the
captures. `bites/fetch.mjs` now keeps `meta.source_polls`, because 91.1
compares against it and the old strip made the bite fail for the wrong
reason. Found in passing, for the families that own them: nine tools
publish no outputSchema despite 6.14.0 (cards_archetype, collections_*,
elixir_identify, elixir_my_identities, elixir_nickname,
elixir_send_feedback, live_fetch), and `elixir_timeline` may drop items
past its cap unreachably.

## 2026-09-23 — Gym sweep, battles round 1 (6.21.0, feedback #95-#101)

Regressions: 30 of 34 confirmed fixed. #59 was partially fixed and is now #99. #55, #57 and #62 retired with battles_levels. Findings, each verified against the code:

- **#95, blocks correct answers:** outcomeFor let a duel fall through to the summed-crowns rule, so 7 of 70 duels were wrong. Ingest now counts games won from `rounds[]` and falls back to crowns only on a tie or when no rounds are carried. `{duel_outcome_repair}` recomputes the recorded duels from battle_participant_round and re-derives each affected player-day's rollup. The upsert's coalesce never overwrites an outcome, so the repair is the only way history changes.
- **#96:** a duel's leak is summed from its rounds at read time.
- **#97:** `vs.tower_level` comes from the tower troop's played level (supportCards). A conditional note fires when the levels differ, and `vs` is null on boats.
- **#98:** a conditional note on river race rows.
- **#99:** `floor` is the floor stood on most recently, with its own counts, and `floors[]` holds every floor. The Gym's case asserted that meaning. Taking the lowest had been an artifact of `min()`, not a decision.
- **#100:** princess is padded to `[0, 0]` when the king is carried and the array was omitted.

The interpreter gained a decimal tolerance on `sum_eq` (96.1: 1.43 + 4.43 + 4.88 in floats).

**Throughput:** the Gym account's 300/hour bucket carried badges and battles, then refused both the cards and clans runs at their first call. Until Jamie raises it (`{service_token_limits: {name: "gym", hourly_rate_limit: 900}}`), the sweep runs one family an hour.

**6.21.0 gate, and fix-forward (6.21.1).** 311 cases ran and 5 failed:
- 95.1 and 95.2 were waiting on the repair.
- 97.1 and 98.2 were my note wording. The Gym's cases asserted "tower levels differ" and, on ladder, "what matchmaking paired", which I had moved out of the general note.
- `catalogue/badges_rarity#notes`: the contracts rule's snake_case scan read `ank_v2` out of the CamelCase identifier `RoyalTournamentRank_v2`. The rule now skips a segment with a capital, since API identifiers are CamelCase and our fields are snake_case.

`{duel_outcome_repair}` applied: 140 duels, 280 rows (70 win and loss flips, 70 false draws, both sides each), 280 player-day rollups re-derived. Gym 95.1-95.3 pass live.

## 2026-09-23 — Gym sweep, cards round 1 (6.22.0, feedback #102-#108)

All 3 regressions (#19, #20, #24) were confirmed. The run spent about 55 calls. Findings:

- **#104, blocks correct answers:** the eight-card exact-set lookup scanned every deck of that size with two correlated subqueries each. It now goes through `deck_card`'s card index plus `card_count`, which gives the same set. The `query_timeout` hint says "narrow from/to" only when the tool takes `from` (`registry.accepts`).
- **#102:** TROPHY_BAND_CASE, the pop builder and the raw `trophyBandClause` all leave ranked rows unbanded, because starting_trophies holds the rating there. `{meta_rollup_season: {season_month, repair_bands: true}}` nulls the band on those population rows and rebuilds the aggregates from the population. This is not a reset: the rows stay and only one column changes. The note RANKED_NO_BAND_NOTE, and the band argument's description, say so.
- **#105:** the resolver dropped evo and hero by design (6.8.0). A said form is now kept on its card and matched against the stamp's label, which spells the form ("Evo Royal Hogs"). A bare name still merges forms and says so.
- **#103:** `members.played` gains `deck_hash is not null`, which is season's population.
- **#107:** `excluded`, `prior_win_rate` and `prior_basis` are served. The corpus-prior line of SEGMENT_NOTES is replaced where cards_card shrinks toward the segment's own mean. `insufficient_sample` is set only below the floor, because history rows are deliberately unshrunk. A player segment uses buildMeta.
- **#106:** a history note fires when the ranked share across the shown seasons moved 20 points or more.
- **#108:** a note.

## 2026-09-23 — Gym sweep, clans round 1 (6.23.0, feedback #110-#113)

All 9 regressions were confirmed. After the 6.21.0 duel recompute, standings, participation and battles_performance agree exactly (#113, praise).

- **#110:** participation reuses war/common's `finishWarDays`, `decksAfterFinish` and `scoringDecks`, the same code war_history runs, rather than a second derivation.
- **#111:** a partial point for today's game day, and a note naming the days where members_with_profile is below members. The carry-forward the Gym called better (each member's latest profile as of the day) would change the values rather than describe them. It stays in the queue as a product question for Jamie.
- **#112:** role_counts is computed from the roster rows at full; notes and docs are served at compact.

Band repair for #102 is running on the jobs Lambda (async, 2026-09 season, `repair_bands`).

## 2026-09-23 — Gym sweep, collections round 1 (6.24.0, feedback #114-#117)

This is a first run with no legacy items.
- **#116:** needed a way to tell a board collection from a curated one, and a slug-prefix rule would have been a hack. 0157 adds `collection.synced_from`, set once through `{collection: {op: "upsert", synced_from}}` on the four board collections, and their descriptions stop saying "a snapshot". `collectionSegmentNote` rides on the collection segment of meta_decks, meta_cards and cards_card.
- **#114:** a note, not a rank. The board rank lives in rankings, and a collection row does not know which board placed it.
- **#115:** three outputSchemas. The 6.14.0 "every tool" claim is still false for cards_archetype, elixir_identify, elixir_my_identities, elixir_nickname, elixir_send_feedback and live_fetch. The elixir family's run is open now, and the rest follow in their rounds.

The #102 band repair is also done: the 2026-09 rebuild took 230 s and unbanded 288,868 of 400,238 population rows (72% were ranked). 2026-08 was run the same way.

**6.23.0-6.24.2 gate trouble, and one outage caused by me.**
- **Outage:** 6.23.0 added a note per finished-early war week to clans_participation. The eight-week full read, which is Elixir Clan's call (21 in the catalogue), was already near the 48,000-character cap and went over it, so it was refused `result_too_large` from about 16:30Z. 6.24.2 (about 17:05Z) folds the caveat into one sentence and fixed it. war_scoring_decks rides windows of up to six war weeks. The gate caught the break on 6.23.0 and on 6.24.1. I shipped 6.24.1 believing war_scoring_decks alone was the overflow, and the note count was the rest. Measure the response, not the diff.
- **Load:** the 6.23.0 gate also ran while the #102 band rebuilds were running (16:33-16:40Z). Its timeouts and budget overruns were that load; 6.24.1's run, on a quiet database, had none.
- **Interpreter:** `count_eq` now resolves a path on its right-hand side, as eq does (117.4).
- **Collections:** synced_from and the new descriptions are set on the four board collections through `{collection: upsert}`. Gym 110-117 pass live.

## 2026-09-23 — Gym sweep, elixir round 1 (6.25.0, feedback #118-#124)

Regressions: #4, #5, #18, #31 and #47 were confirmed. #48 was NOT fixed for history (duplicate rows in the 09-14 ledger) and is reopened inside #121. #10 was partially fixed (#119). #8 and #16 are retired with elixir_events.
- **#120, blocks correct answers for pointer readers:** the builders' caps now return the items they drop. The tool filters them by kinds and sections and cuts the page at the first dropped instant, never at or before from (#118 means an item's at can precede from). The read pointer moves to the cut. MEMBER_MOMENTS_CAP now sorts oldest first before slicing.
- **#118:** observed_at is on every item: the poll window's end for moments, `at` for the rest.
- **#119:** days_since_poll is null when the latest poll is after the window's end. The item's days_quiet is its rung.
- **#121:** a dedupe at read time (subject, kind, facts) serves #48's rows once and deletes nothing. `step: null` goes on steps from before the rule, with the ledger-start note.
- **#122, #123, #115:** the refusal gives its size; notes and docs are served. All 55 tools now have an outputSchema, and a test pins it.
- **Interpreter:** new verb `unique_by` (121.3).

## 2026-09-23 — Gym sweep, game round 1 (6.26.0, feedback #125-#128)

Regressions #28 and #50-#52 were confirmed. Findings:
- **#125:** game_events filtered `game_event_day` by the UTC dates around the window. It now selects the days an admitted events read inside the window's instants saw. The fixture's two earlier sightings gained the receipts real ingest would have.
- **#126:** the events and globaltournaments reads join the anchored board-day rule. Their cadence was 1440 min × jitter + planning latency, which drifted about 3 h a day. `game_days_read` is served, and a note lists unread game days.
- **#127:** a date-only `at` on game_clock is read as that game day's start (10:00Z), with a note saying so.

## 2026-09-23 — Gym sweep, players round 1 (6.27.0, feedback #129-#135)

All 9 regressions were confirmed. Findings:
- **#129:** the clanmate rule reached a clan only through the account's claimed players, and an agent claims none. `account_clan` is now a path too. Whole-name matches come first, and total_matches and truncated are served.
- **#130:** the deck by-type splits now carry the event-aware mode_group (modeGroupSql over event_tag). top_deck and best_deck require a chosen deck (deck_selection null, collection or warDeckPick), and net_trophies sums ladder rows only. battles_decks gets the same mode_group.
- **#131:** the docs sentence is corrected, and a note rides players_profile and clans_roster.
- **#132:** trophy_range and last_played_at on both decks, plus a range-clash note.
- **#133:** `fieldedLevel` returns recent_mean_level, which the meta tools' fit_for inherits.
- **#134:** season echo on players_summary; `season` on players_timeline (its game days); a window echo on players_collection.
- **Checker:** check-appendix requires player_tag only on players_* tools that declare it. players_search and players_names don't.

## 2026-09-23 — Gym sweep, rankings round 1 (6.28.0, feedback #136-#139)

All 5 regressions were confirmed (#38 rankings half, #71-#73, #76). #139 is praise that pins the horizon, pol_final and full-board behaviour. Findings:
- **#136:** the clan ladder gets a tie note. It is counted over the whole snapshot for every score on the page that is shared, since a tie runs past a page.
- **#137:** mode boards get MODE_RATING_NOTE in place of FLOOR_NOTE and the pol rating note. 0158 adds `standings_hash` and `standings_changed_at` to ranking_snapshot. Ingest stamps them on every player board, and the migration backfills the mode boards only (a few hundred rows). The readers serve the field on mode boards and catalog rows. The existing content hash includes clan_tag, which is why frozen boards still wrote a snapshot each day.
- **#138:** the notes point at `battles_query.global_rank` and the other two fields, in the tool-qualified form the catalogue check accepts.
- **6.27.0 gate:** `catalogue/players_profile#notes` failed, because the #131 note named `lifetime.total_donations`, which the profile does not carry. It now points at the players_timeline series.

## 2026-09-23 — Gym sweep, war round 1 (6.29.0, feedback #140-#143)

12 of 15 regressions were confirmed. #88 was partly fixed and is filed as #141. #8 and #30 could not be re-derived from the legacy text, and the war-day paths could not be checked on a training day. #143 is praise. Findings:
- **#140:** WAR_TROPHY_TIMING on war_history, and matching wording on war_current and war_rivals. The race payload's clanScore is the figure going into the race: the Gym found it chained W+change = W+1 on 26 of 26 closed weeks, and clans_timeline agrees. Only the note changes.
- **#141:** the outputSchemas declare clan_war_trophies (war_current, war_rivals) and our_clan_war_trophies (war_history), and clan_score is a DEPRECATED alias. The false "null before 2026-09-17" clause is gone. 141.2 stays needs_fixture in gym.json, and a unit test in war-tools.test pins the schemas.
- **#142:** `sectionsInSeason(seasonId)` in war-clock. A missing exact week at or past the season's own count never existed.
- **6.29.1:** the 6.29.0 gate failed contracts/war_history-seasons and contracts/war_rivals. The timing note named clan_war_trophies where only our_clan_war_trophies is served, and trophy_change on rivals rows. It is now `warTrophyTiming(field)`, scoped to what each response serves.

## 2026-09-23 — Gym sweep, badges round 2 (6.30.0, feedback #144-#147)

#18, #91, #92 and #94 were confirmed fixed. #93 was partly fixed, and the rest is #146. #147 is praise. Findings:
- **#144:** `pairCounts` gives the distinct holders of either identifier, and of both, in the segment. The rarity pair note quotes it. badges_holders gets a `siblingNote`. Resolution itself is unchanged: a bare label still names the identifier whose label it is.
- **#145:** 6.30.0 shipped a note. Jamie decided the same afternoon that badge questions over the corpus include recorded players only ("there is no practical way we could do otherwise"). 6.30.1 moves `RECORDED_PLAYERS_SQL` to shared.mjs, where the population block counts it too, and the badge corpus is read over it. The note says what players_considered counts.
- **6.30.0 gate:** gym/147.4 failed in the interpreter, not the product. `count_eq` with a list on the right compared a number to the array; it now compares to the list's length.
- **#146:** an edit-distance candidate pass over labels and identifiers, with a budget of max(2, length/6) squashed letters. Every miss says "exactly".

## 2026-09-23 — Gym sweep, badges and battles round 2 (6.30.0-6.31.0, feedback #144-#152)

- **6.30.1:** Jamie decided that the badge corpus is the players recorded now (#145), and it is in DECISIONS.md. The 6.30.0 gate failure was the interpreter's `count_eq` against a list.
- **Battles r2:** 41 regressions checked. #95-#100 and 31 legacy items were confirmed. #97 was partly fixed and the rest is #150. The #122 remainder surfaced as #151.
- **#148:** `mode-filter.mjs`.
  - `participantModeClause` reads battle.event_tag through a semi-join, only when a mode is named. A live read showed event battles come as `trail` AND `unknown`, so no type set can stand in for the tag.
  - `metaPopulationClause` is the rollup's META_POPULATION for raw meta reads. The raw path had kept event and non-chosen decks, and disagreed with the season rollup and with the battles docs.
  - 148.1 and 148.4 (meta tools must answer event) are `refuted` in gym.json. The interpreter gained that skip.
- **#149:** deck_stats reads the same `setWhere` as total_count, with params up to the highest one named.
- **#150:** a note fires when rows carry no tower level. Inferring the level from untouched-tower HP needs a per-level HP table, which is not built. That is a follow-up, not done.
- **#151:** protocol.mjs knows a one-size tool by its published verbosity description, and validation reads the published schema, so "Known:" lists verbosity. 151.1 has no bite: the archive holds the body before the cap.
- **Not done:** clans_standings (standings-sql.mjs) still filters mode by type. That belongs to the clans family and is for round 2 there.
- **6.31.0 gate: 35 failed. INCIDENT: the RDS EBS byte-balance ran out.** EBSByteBalance% on elixir-mcp-enc fell from 99% (13:11Z) to 0 (18:41Z), with read throughput of 20-30 MB/s from about 13:40Z. That is the MCP Lambda's busy time: the Gym sweep plus about ten full acceptance gates (each around 500 cases with corpus meta reads). With the balance at 0, the db.t4g.micro is throttled to baseline throughput. war_current and elixir_timeline ran about 23 s in the database (DataFileRead waits, CPU 10-20%) and timed out, and the web API hung too. **The sweep is paused** until the balance recovers. Gates also stop running the whole suite after every deploy. **Needs Jamie:** instance size and gate cost, before the sweep resumes at pace.
- **6.31.1:** one of the 35 was real. nc.meta.reconcile was off by one: metaPopulationClause had gone on the decided rows, not the considered scope. It now filters `scope`. Deployed without the gate, while the balance recovers.
- **Resize to db.t4g.small (Jamie, 2026-09-23: "we've been fighting this micro instance nearly every day").** The shared_buffers pin (88 MB) is dropped back to the engine default. The one-year all-upfront micro reservation (elixir-mcp-pg-1yr-2026-09, $95, from 09-07) is size-flexible for RDS PostgreSQL within t4g, so it covers half of the small's normalized units. The other half is on demand, about $12 a month. The acceptance gate goes per family (next entry).
- **Per-family gate:** `deploy.mjs --acceptance=<family>` passes `--family` to run.mjs. That runs the cases whose `tools` (gym blocks, budgets) or id (catalogue, contracts) name a tool of that family: 15-94 cases instead of about 500. Plain `--acceptance` is the whole suite, for changes to shared code.

## 2026-09-23 — Gym sweep, cards round 2 (6.32.0, feedback #153-#156)

8 of 10 regressions were confirmed. #102 and #107 were partly fixed, and the rest is #155. #156 is praise.
- **#153 and #154 share one cause:** the raw reads never applied META_POPULATION. `rollupSynergy`'s partner walk, the card profile's `scopeClauses` and member read, and raw synergy now take `metaPopulationClause()`. The Gym's open question (tournament and event battles filling 88-90% of under_5000) is the same leak.
- **#155:** the ranked by_band note is corrected. methodology.prior_source follows prior_basis.
- **Open, not filed:** Mirror is left out of average_elixir with no note.
- **Gate:** first per-family deploy, `--acceptance=cards`.
- **6.32.1:** the 6.32.0 cards gate failed 154.2 only. Raw and season now agree exactly (44,956 decided, 7,620 Witch), but one odd-typed battle read `other` on the raw path and `casual` on the rollup. **Follow-up:** `modeGroupSql` defaults an unknown type to `casual` while `modeGroupOf` (JS) says `other`. Unifying them changes rollup rows and needs a rebuild. For now, raw synergy groups with the SQL rule, as the rollup does.

## 2026-09-23 — Gym sweep, clans round 2 (6.33.0, feedback #157-#159)

All 13 regressions were confirmed. #159 is praise.
- **#157:** dailySql's raw edge days and the standings streak rows now filter by `modeGroupSql` equal to the mode (the rollup's rule, event-aware). dailySql's `types` argument is gone.
- **#158 and the donation rule (Jamie).** Jamie decided that a week's donations are the highest counter value seen in its game days, and that we do not try to pin the reset minute. The census (`{donation_reset_census}`) showed one global reset, not the player's local midnight: Asia-Pacific clans still held last week's counters at 23:13-23:29Z Sunday, eight hours after their midnight. It could not pin the minute, because most clans' brackets are hours wide. The pre_reset row keeps greatest() on donations and donations_received. Migration 0159 raised the stored pre_reset rows to the week's highest. Participation includes the pre_reset rows, and the timeline's clan summary takes the game-day week's highest. The window constant (Monday 00:10Z) now only schedules the extra polls. I briefly pushed "resets at 00:00 UTC" to cr-agent-api-docs and reverted it (3494cc7), because it stated a minute we had not measured.
- **Needs Jamie:** clans_participation at weeks 8 for POAP KINGS is 47,770 of the 48,000 cap, at about 892 characters a member with 47 members. A 48th member refuses the read Elixir Clan makes for every evaluation. Recommendation: serve `null` for a week with no per-day poll in `war_decks_by_day`, not four nulls. That saves about 4,000 characters here, and Clan's engine already treats the two alike. For other clients it is a shape change.
- **The 6.33.0 gate failed on clans_participation's cap** (48 members, 48,680 characters) and on gym/91.5 (the roster moved from 47 to 48). The rest passed. **Decision (Jamie):** no stopgap; Clan moves off MCP onto an app API (plan: ../elixir-family/plans/clan-app-api.md). Clan's evaluations are refused until then; nobody uses it yet.

## 2026-09-23 — the JSON API is a public product; Clan's door (phase 1)

Jamie made three decisions. `/api/v1` is Elixir's public, versioned JSON API beside MCP. Elixir Clan is its first consumer as a person's program. Clan is not metered and uses no MCP. The plan is ../elixir-family/plans/clan-app-api.md.
- **Phase 1:**
  - 0160 widens the stored-audience CHECK to `/api/v1`. `RESOURCE_PATH_RE` gains kind `api`, the MCP handler refuses it, and OAuth consent treats it as the person's own grant.
  - The v1 handler takes `eat_` tokens with audience `/api/v1` as a person. Operations declare `x-principals` in the contract, and INTEGRATION_SCOPES counts integration operations only.
  - `GET /api/v1/me` returns the principal block and `myPlayers` (shared with elixir_my_players).
  - First-party is `isFirstPartyClient(redirect_uris)`: every URI on a family origin, derived rather than stored. A third-party person is limited to 600 an hour.
- **Contract:** the JSON API contract is 1.1.0, titled "Elixir JSON API". AGENTS.md's platform-integrations rule is amended.
- **Gym sweep:** paused after clans round 2. It resumes after the Clan move. Grid: badges, battles, cards and clans are in round 2; the other six are due.
- **Phases 2 and 3 (JSON API 1.2.0):** person operations for participation, roster, the live clan read, names, profile and battles. Each runs the matching MCP tool through the same registry and invoker: the same facts and the same 15 s query budget, with no agent cap. `live` is `makeLive` over the job ledger, as MCP builds it. A tool refusal becomes problem+json with the tool's code, hint and retry_after_s, mapped to HTTP status by the code's class. `liveBudgetFor` treats `firstParty` as unlimited: no one's quota, while the fleet's global budget still governs. **Split to keep (Jamie's question):** the public API mirrors the MCP tools. The first-party apps get an unversioned internal API the first time they need a shape that is not a tool.

## 2026-09-23 — Gym sweep, collections round 2 (6.33.1, feedback #160-#161)

#114 and #116 were confirmed fixed. #115 was partly fixed, and its description remainder is folded into #160. #161 is praise. The fix is wording: the tool description, the schema field and a player-collection note. Open, not filed: #116's selection-on-outcome caveat was never shipped, and its effect is not measured.

## 2026-09-23 — Gym sweep, elixir round 2 (6.34.0, feedback #162-#168)

19 regressions were checked. #118, #119, #120 and #123 were partly fixed and reopened as #162, #163 and #167. #168 is praise.
- **#162:** timeline.mjs cuts on `observed_at` (the selector, `(from, to]`), with next_cursor at cut minus 1 ms. Sessions and standouts carry the record's learned instant (`b.created_at`, now read by playerBattles and clanMemberBattlesQuery). The lag advice quotes the page's longest lag. One edge remains: an item whose stored instant falls strictly inside the millisecond before the cut can be served on both pages. It cannot be lost.
- **#163:** days_since_poll is `max(api_receipt.fetched_at) <= to` for player_battlelog, on the `(entity_key, fetched_at desc)` index. poll_state holds only the latest read.
- **#164:** every standout is an item. 164.3, which asserted the counted-cap alternative, is `refuted` with that answer.
- **#165:** donations read `game_day(to - 1 ms)`'s week.
- **#166:** war reads the recorded week at or before the calendar's week at `to`. The race facts are null when that week is not recorded. The test that pinned "the latest recorded week" was updated: it had asserted the bug.
- **#167:** `docs` on elixir_updates, elixir_examples and the elixir_docs index. The participation donations note is corrected, as the Gym noted for the clans run.
- **Interpreter:** new verbs `before` and `all_before` (the latter inclusive, since the cursor is exclusive).
- **6.34.1:** the 6.34.0 gate failed on three things. (1) gym/164.x: the interpreter split paths on dots inside `[?at=...000Z]`; `splitPath` now splits outside brackets only. (2) catalogue/elixir_timeline#3: a 7-day compact read reached 54,766 characters once every standout was an item, so TIMELINE_CAP is 150. (3) The docs pointers for elixir_docs and elixir_updates named pages whose fields those responses do not carry; both now point at `about`.
- **6.34.2:** the 150-item cap did not bring the 7-day compact read under the cap (54,787 characters, fewer than 150 items). Standout items carry the session shape, so the timeline now also cuts by characters: items in observed order up to a 40,000-character page, with at least one item a page so the cursor always moves. The clans_participation weeks-8 refusal for 48 members is filed in known.json until 2026-10-21, as agent-designed behaviour. Clan is off MCP, and the reshape is the 7.0.0 batch.

## 2026-09-23 — Gym sweep, game round 2 (6.34.3, feedback #169-#170)

All 7 regressions were confirmed. #126's recorder half (reads pinned to the 10:00Z grid) is not observable until the first pinned read on game day 09-24, so 126.5 stays needs_fixture. #169 is fixed with a note only: game_clock's grid is the policy boundary, and races close per race in the half hour before it. The note rides the JSON API's game clock too, because that is the same function. #170 is praise.

## 2026-09-23 — Gym sweep, players round 2 (6.35.0, feedback #171-#173)

14 of 16 regressions were confirmed. #133 was partly fixed: fit_for had never received recent_mean_level, although the 6.27.0 reply said it had. That is now #171. #134's players_collection window echo has no season or crosses, which the Gym noted and did not file. #173 is praise.
- **#171:** fitBlock.recent_mean_level, with deckFit's target from it, and a levelling-up note when the two means differ by a level or more.
- **#172:** described, not unified. Both trophy_ranges are declared and a note explains them. 172.1 and 172.2 are `refuted` as held for Jamie. **Question for Jamie:** make every trophy_range starting trophies? That changes what trophy_floor.trophy_range means on three tools.
- **Open (Gym, not filed):** in one week King Thing's lifetime donations rose 28 more than the week's high-water mark (414 against 386). A stale roster read near the reset may miss late donations. It needs more weeks before the 6.33.0 claim that the highest read is the week's total is qualified.

## 2026-09-23 — Gym sweep, rankings round 2 (6.36.0, feedback #174-#178)

7 of 8 regressions were confirmed. #137 was partly fixed and the rest is #174. #178 is praise.
- **#174:** rankings_clans takes MODE_RATING_NOTE and the stale note on mode boards. rankings_timeline says points are written when names or clans change, and the generic note now says "content changed (ranks, ratings, names or clans)", which was already true.
- **#175:** standingsStaleNote gets the horizon. At or before it, the note says recording began then, and says nothing about a refresh.
- **#176:** boardRow refuses a trophy board with the empty-API reason.
- **#177:** rankings_timeline takes `season`, through resolveSeasonWindow (source season).

## 2026-09-23 — Gym sweep, war round 2 (6.36.1, feedback #179-#182)

15 of 16 regressions were confirmed. #140 was partly fixed, and its docs remnant is #181. It was a training day, so the war-day paths are untested. #182 is praise.
- **#179:** my own 6.34.3 note pointed at war_current for a close it does not carry. The game_clock note now points at war_history's `closed_at`, war_current gets the close-before-grid note, and the `finished` note is corrected.
- **#180:** WAR_FAME_BY_PLACEMENT goes on war_history and war_rivals. The fact is also pushed to cr-agent-api-docs clans.md (2e63b8b), since it holds for any caller.
- **#181:** the battles.md war-trophies paragraph.
- **Open (Gym, not filed):** a battle between a race's real close and 10:00Z counts toward the previous day. It needs a clan-wide scan.
- **6.36.2:** the 6.36.1 war gate failed the contract checks. The new notes named `closed_at`, `progress_earned` and `mean_fame` on tools that do not carry them, so they are now tool-qualified. 181.1 needed `contains` to take a string, and gym-interp now does.

## 2026-09-23 — Gym sweep, badges round 3 (6.36.3, feedback #183-#185): badges PARKED

All 8 badge findings from rounds 1 and 2 were confirmed fixed. Two new findings were fixed: #183 (the clan segment follows the recorded-now rule, with a coverage note) and #184 (min_level on one-off badges is refused, and kind comes from the record). #185 is praise. **Badges is parked** by the sweep rule: three rounds without a clean run. Every finding is shipped, and a round 4 is Jamie's call. Open, not filed: King Thing's badge reads are stamped 14:27Z while his profile poll says 21:27Z.
- **6.36.4:** the 6.36.3 gate failed 145.3, 183.4 and 183.5. The recorded-now filter on clan segments dropped a current member of the covered control clan (49 of 50), so it is reverted and the coverage note is kept. 183.3 (the stale holder) is `refuted` and held. **Question for Jamie:** should a clan segment follow the corpus's recorded-now rule?

## 2026-09-23 — Gym sweep, battles round 3 (6.36.5, feedback #186-#190): battles PARKED

- **#186:** battles_trends no longer snaps `from` to the week's Monday; the first week is partial with `covers`.
- **#187:** trends' per-week modes use the event-aware fold (`modeGroupSql` over `battle b`). The docs table is fixed in the template, not the contract fold: moving `trail` to `event` in `MODE_GROUP_BY_TYPE` trips meta_season_pop's mode_group CHECK for an untagged trail row, so the tag stays the rule.
- **#188:** `excluded.outside_meta` and a note on raw segment meta reads. Corpus windows skip the count (a third corpus scan; query-budget test).
- **#189:** players_timeline's progress query had unqualified columns (ambiguous under the join).
- **#190:** controls, praise.
- A `controls.test.mjs` fixture had decayed (war deck overtook the ladder deck as the fixed September battles aged out); two fresh ladder battles pin it.
- Battles parked after three rounds: every finding shipped.

## 2026-09-23 — Gym sweep, cards round 3 (6.36.6, feedback #191-#192): cards PARKED

- 13/13 regressions confirmed fixed. **#191:** tournament starting_trophies is the running tournament score, so tournament rows filled 89.6% of under_5000. `unbandedTypes()` (contracts: ranked + tournament) drives both the raw `trophyBandClause` and the rollup's TROPHY_BAND_CASE; `{meta_rollup_season: {season_month, repair_bands: true}}` nulls stored bands for 2026-09 and 2026-08 and rebuilds the band tables. #192 praise.
- Open (not filed): season-read partner counts run to now while the anchor stops at the rollup cursor (~0.3%); raw season-to-date corpus reads near 18 s; Mirror out of average_elixir unnoted; members.played.level_played is an undocumented mean.
- Cards parked after three rounds: every finding shipped.

## 2026-09-23 — Jamie's answers on the held questions (6.36.7)

- **#172** trophy ranges: leave as is (two meanings, both described).
- **#183** yes: clan segments follow the recorded-now rule. Players and clans known only from a battle stub are ghost entries, never metrics (DECISIONS). The 6.36.3 "dropped member" was not the filter: on 2026-09-24 the controls fail with the filter NOT deployed (47 of 48; a new member has no profile read until the next poll). 145.3/183.4/183.5 are `refuted` (players_considered = member_count is not an invariant); 183.3 is live again.
- **Headline counts** (home, data, support, llms.txt, the console Data view): recorded players (1,080 = RECORDED_PLAYERS_SQL, the tools' number; the old `players_recording` was direct recordings only, 859) and recorded clans (18) lead; observed (358,062 / 7,604) is the secondary line.
- **#111** yes: carry each member's latest profile forward (`members_profile_carried`).
- **Round 4** for badges, battles and cards.
- **Gym token:** `hourly_rate_limit` 1,000,000 (own bucket; no "unlimited" exists in the handler), set by `service_token_limits`. daily_quota stays the owner's.
- **Cloud Gym routine:** stays paused (Jamie).
- **#191 bands repaired:** `meta_rollup_season` `repair_bands` on 2026-09 (3,207 rows, 59 s) and 2026-08 (34 rows); gym/191.x and 192.x pass live.

## 2026-09-23 — Gym sweep, badges round 4 (6.36.8, feedback #193-#194)

- 10/10 regressions confirmed, #183 as decided. **#193:** the pair note now reads the population's badge names when the page is cut (limit), a cut page says "N of M badges", and "does not appear" is served only on a complete list. #194 praise.
- The 111.1 bite is removed with its case superseded (a refuted case cannot bite).
- Open (not filed): Valkyrie level-ups on the timeline but not Ak or Mega Goblin (timeline family); a clan collection as a badge segment answers not_found.

## 2026-09-23 — Gym sweep, clans round 3 (6.36.9, feedback #195-#198)

- 16 regressions checked; #158 PARTIAL -> **#195**: the clan-level pre_reset row (clan_snapshot_daily.donations_per_week) takes the week's daily high-water at write (the insert path too, since a single post-reset read has nothing to compare against) and 0161 repairs stored rows.
- **#196:** `captureByPlayer` / `underCaptureNote` (coverage.mjs), elixir_coverage's seven-day estimate batched: members below 80% of >= 5 counted battles are named on standings and participation.
- **#197:** profile aggregates exclude a member whose stint in the clan closed by the clan row's read (within two days) with no stint covering it; `members_left_excluded` drives a conditional note.
- gym-interp: notes_match / notes_not_match take [binding, regex]. 111.5/111.6 replace the superseded 111.1. 159.1 stays known (participation weeks 8 over the cap). #198 praise.
- Open (not filed, elixir family): elixir_timeline's clan week sums today's members (8,977 vs 9,094); elixir_changelog without `since` reports current 6.21.1.

## 2026-09-23 — Gym sweep, battles round 4 (6.36.10, feedback #199-#200)

- 50 regressions confirmed (3 retired with battles_levels), all 52 earlier cases pass live but the refuted 148.1/148.4.
- **#199:** trophy_mode_battles counts trophy-mode types OR any reported trophy change (the seasonal Trophy Road past 14,000 is event-tagged trail, game mode Ladder, and moves trophies); the note and schema description say so. The event grouping is unchanged (decided). The shared `mode` description now lists event. #200 praise.

## 2026-09-23 — Gym sweep, collections round 3 + cards round 4 (6.36.11, feedback #201-#207)

- Collections r3: 5/6 regressions hold, #160 partial -> **#201** (years_played null = no YearsPlayed badge, usually an account under a year old; 201.4 records the inference as an open question), **#202** (clan collection as segment: bad_request with the clan_tag route; unknown slug stays not_found), #203 praise. #116 selection effect measured (+2.7 points on today's Global 100), note already served.
- Cards r4: 12/14 regressions confirmed; #191 partial -> **#204** (tournament empty-band note; band note on the meta tools when trophy_band meets a non-ladder mode); **#205** (first_seen_in_catalog = catalog storage start, noted); #107 partial -> **#206** (synergy player freshness via buildMeta); #207 praise.
- Open (not filed): a closed-window raw season corpus read times out at 18.3 s twice (narrowing works); Mirror out of average_elixir; level_played an undocumented mean; season partner counts run to now (~0.1%).

## 2026-09-23 — Gym sweep, rankings round 3 (6.36.12, feedback #208-#210)

- 13 regressions confirmed. **#208:** `standingsMoved` (ingest/rankings.mjs): a common player's rating changed, or a newcomer at or above the previous floor; 0162 recomputes mode boards. **#209:** rankings_timeline echoes seasonWin.source; resolveSeasonWindow answers a future season with an empty window at its start plus a note (no refusal: callers keep working). #210 praise.
- **Case 209.2** (`season: "2026-10"`) is only valid until 2026-10-05, when 2026-10 becomes current: re-point it at the next season then.
- Open (not filed, clans family): clans_timeline refuses `season`.

## 2026-09-23 — Console Timeline; the console's clock; the timeline is a newsfeed (7.0.0)

- **Timeline is a rail item** (Jamie): Overview, Timeline, Explore. `/account/timeline` (views/account/Timeline.jsx); the unread dot moved with it; Activity keeps requests/emails/events and opens on requests; bare `/account/activity` redirects to `/account/timeline`. Kit gained the Lucide bell. Shipped 3980bb3, deployed.
- **The console's clock** (Jamie: "the Console does know my timezone"): kit `stamp`/`stampDay`/`stampTime` (time.ts) and `ZoneProvider`/`useClock` (Zone.tsx); the Shell provides `me.timezone`. Every hand-built `toISOString()+"Z"` in the views is gone, Verify's browser-local clock too, Fresh's title, the Status charts' UTC "HH:MM" buckets (anchored at `as_of`), the quota reset line. Left on purpose: day-bucketed charts (Usage, Data, ActivityGraph, Efficiency) are UTC days and say so; the sign-in page has no account.
- **The timeline is a newsfeed** (Jamie: "we had the whole concept of Timeline backwards"): contract 7.0.0. `buildTimeline` dedupes oldest first, serves newest first, caps to the newest 150 (`capTimeline`); member moments keep the newest 100; clan roster lists newest first. The tool's cut mirrors the old observed_at cut: keep what was observed after the newest item left out, count the rest; `next_cursor`/pointer to `to`; the note names the instant for an explicit older read. Tracking mail takes each subject's newest 8 in that order; milestone ties newest first. Jamie chose "newest 150, count the rest" over paging back or reversed pages.
- Not changed: the series tools (`players_timeline`, `clans_timeline`, `rankings_timeline`, `clans_members_timeline`) are time series, not the feed. The Discord preview sorts by `at` itself and is unaffected.

## 2026-09-23 — Console account switcher: designed, not built

- Jamie: every person has sub-accounts (their agents); switch the console into one instead of reading it from Connections → Agents. Design in `docs/reviews/2026-09-23-CONSOLE-ACCOUNT-SWITCHER.md`: URL-scoped (`/agent/<public_id>/…`; `/a/*` is the MCP door), selector in the rail header, `RAIL_AGENT`, one `resolvePrincipal` seam with a route table test, `PrincipalProvider` + scoped query keys, three phases.
- Found on the way: person pages disagree about agents (Usage and Connections merge them; requests, feedback, timeline do not); an agent's call log and feedback are unreadable by a non-admin owner; an agent cannot be configured past creation (track tools are `PERSON_ONLY_TOOLS`, no clan-add route), so a family agent cannot be set up.
- Decided by Jamie: configure in scope, Explore global, integrations out (the public API rethink), agent clients move to the agent. Open: pooled slots counting distinct subjects (recommended), the agent adding over MCP (recommended), re-pointing an agent's primary clan.

## 2026-09-23 — Console account switcher: built (phases 1-3; contract 7.1.0)

- Jamie: "build this change... all three phases"; slots pooled at the person, agents track over MCP, an agent's clan can be re-pointed.
- Phase 1 (4d29c57, deployed): `/api/agent/<public_id>/<tail>` runs the `/api/me/<tail>` route as the agent for its owner (handler.mjs `AGENT_SCOPED_ROUTES`, `agent-scope.mjs`; 404 for anyone else's; log key `GET /api/agent/*/...`); agent `me`; pooled slot counts; Usage's budget holder; your Connections lists your clients only. Kit `Rail` gained `accounts` (the selector); console `ScopeProvider`, scoped query keys `["agent", id]`, `agentRail`, `AgentPage`; the agent page split into Overview and Settings; `GET /api/me/principals/timeline` retired.
- Phases 2-3: `@elixir-mcp/claims` `addClan` / `removeClan` / `setPrimaryClan` (the console and `elixir_track_clan` had each carried an unlocked copy of the slot check), `addPlayer` pooled and open to agents (watching only), pool lock = the owner's row, taken after the account's and before the subject's. `POST /api/me/players` aliases `/api/claims` so it can be scoped. Track tools opened to agents and withheld from integrations. Agent Tracking page; your Usage's agent rows open their consoles.
- As built, Explore and Status are not in an agent's console (the design table listed them): Explore's records and trail are absolute `/explore` paths and a nickname saved there is the person's, so they stay in yours.
- Watch: `elixir_identify` accepts a member of any clan an agent tracks, so a rival clan widens who it can map; harmless (its own mapping) but noted.
- Acceptance after 7.0.0/7.1.0 (read-only run, 2026-09-23 23:10 CDT): 720 cases, 1 failed. gym/120.1 (next_cursor before a cut) is refuted as superseded by the newsfeed rule; 120.3 pins it and inherits 120.1's bite (the cap dropping items with has_more false still bites). catalogue/elixir_timeline#3 failed "compact is not larger than full" on a size-cut week: compact drops the entries full spends its budget on, so the same budget holds more items; the check now skips a window either answer cut (has_more).
- **Open, Gym (rankings):** gym/175.3 (a control: rankings_players notes never say "recording began") fails live against the 6.36.12 stale note, which says a closed mode board's ranks "have not moved since recording began on 2026-09-11". One of the two is wrong; not changed here.

## 2026-09-24 — Gym sweep, game round 3 (7.1.1, feedback #219-#222); overnight run begins

- Jamie (04:15Z): run overnight until 06:00 CT; after the MCP families, the Console and code cleanup; new tools and additive changes are mine to decide. 7.0.0/7.1.0 (timeline newsfeed; agents track) landed from another session during the pause.
- 8 regressions checked, #169 partial -> **#219** (date-only at keeps the standing notes). **#220** game_events computes crosses on the whole window (`clampToNow: false`) and notes a future window. **#221** inverted window refused (`requireOrderedWindow`). #222 praise. 126.5 still needs the first grid-pinned read.
- Rankings round 3 closed: 175.3 superseded by #208.

## 2026-09-24 — Gym sweep, elixir round 3 (7.1.2, feedback #211-#218) + war #223

- 26 regressions checked (none NOT FIXED). Run against 6.36.10; 7.0.0's newsfeed landed after, so the continuation-page cases (211.2, 212.1-212.3, 212.5, 218.2, 218.3) are `refuted` as superseded.
- **#211:** late = captured more than a day after play (`b.battle_time >= b.created_at - interval '1 day'`), in every query that narrates (player battles, clan probe split, member fetch `learned`, returned, most). Fixtures now stamp capture minutes after play.
- **#213:** war as of `to` (last war_period_log day closed by `to`, banked), `as_of_window_end: true`. **#214/#223:** `raiseCappedWeekFame` after period logs, banked fame in the week_resolved emit, 0164 repairs war_week_clan and clan_event.fame (regular weeks only). **#215:** war-ledger start note (scoped to the reader's clans). **#216:** donations over members at `to`. **#217:** insights profiles note. #218 praise.
- War round 3 (#223-#227) is in: #223 shipped here; #224-#227 next.

## 2026-09-24 — Gym sweep, war round 3 + players round 3 (7.1.3, feedback #223-#235)

- War r3: 21 regressions, #181 partial -> #225. **#224** clan_score going-in at the log source + 0165 (chain-proved rows only). **#225** deprecation re-dated to the next major, default war_history note, docs. **#226** war_rivals mean_points / points_weeks / points_vs_ours (day logs deduped across observers, finished weeks). #227 praise. War-day paths still untested (training day at run time).
- Players r3: 21 regressions (16 fixed). **#228** `seriesWindow` (daily-series.mjs) gives season to players_timeline, clans_timeline, clans_members_timeline; seasonFieldsForDays clamps age at the window start. **#229** seasonal-trophy-road best 0 = no row (ingest + 0166). **#230** unmatched progress_key note. **#231** lower-bound note (231.1 value case refuted by choice). **#232** declarations + note. **#233** lifetime king_tower_level / total_donations, years_played null note. **#234** count described; cards-to-next-level NOT served (no sourced cost table; 234.1 refuted). #235 praise.

## 2026-09-24 — Gym sweep, clans round 4 (7.1.4, feedback #236-#243)

- 19 regressions; #196 partial -> **#236** (captureByPlayer takes the response's window). **#237** joinedMidWindowNote on standings and participation (note, not rescoped counts: the rows stay today's members). **#238** shipped in 7.1.3. **#239** clans_timeline bare call = last 30 game days. **#240** truncated served. **#241** recent_events by window_end, cut note. **#242** counter-vs-rows note. #243 praise.

## 2026-09-24 — Gym sweep, elixir round 4 on the 7.x newsfeed (7.1.5, feedback #244-#255)

- 27 regressions. **#253** player_tag filter (new argument). **#244** buildTimeline takes `filter`, applied before the cap. **#245** ms-precision bounds: `>= ts(from + 1)` / `< ts(to + 1)` across the timeline queries (created_at keeps microseconds). **#246** roster kinds dedupe only at the same instant; **#250** entry moments deduped. **#247** crossings from battle gaps (items); **#252** returned observed_at = learned. **#248** activity.played_here_learned_later + note. **#249** Colosseum as-of fame null; the regular weeks' 3,435 is real (war_history days: 135/1 and 136/0 both banked 3,435 on day 1). **#251** read_to is the stored pointer. #254 praise.

## 2026-09-24 — Gym journey run (7.1.6, feedback #256-#262)

- A new agent's first ten questions: 5 right first time, 4 misleading, 1 unrouted. **#256** min_players + solo-deck note; shrinkage note says win_rate is raw at any size. **#257** one-player rarity note. **#258** member sessions on clan timelines under player_tag, applied echo, non-member note. **#259** learned_here_played_before. **#260** choosing-a-tool row for promote/demote/remove. **#261** examples use archetype labels + fit. #262 praise. Open: battles_meta_decks with fit_for at default limit 20 can exceed the cap (hint prices limit 17).

