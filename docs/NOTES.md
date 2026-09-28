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

## 2026-09-24 — Console audit fixes (web and web-api; no contract change)

A read-only audit (logged-out Playwright crawl of prod, 449 sitemap URLs, axe on 10 pages x 2 viewports; code read of apps/web) found no broken links, overflow or contrast failures, and every web call maps to a real route. Fixed: **B1** timezone reset (server treats ""/"UTC" as reset to null; UI shows the error and lists a saved zone this browser lacks). **B2** `vite:preloadError` reloads once (deploy's --delete removes old chunks). **M1** LogTable `loading`/`error` props, wired on Timeline, Feedback, Activity requests. **M3** the Feedback "shipped" chip is a real link to /updates. **M4** refusal counts exclude dismissed rows (rail dot and agent Overview). **M5** "first used" read last_used_at: now "last used". **F1** Tracking's clan scope defaults to activity. **M8** /data/collect cadence matches recording docs; SINCE only on battle logs.
Left for Jamie (in the morning report): M1's other not-found-on-error pages (CallRecord, EmailRecord, AgentPage, Overview, Collections, Explore), M2 loading-forever pages, M6 (by design: `current` is the product), M7 home pill baked at build, F2-F9 (F8 needs a CloudFront 404 page), polish list. Full report in the session transcript (the subagent could not write /tmp/console-audit/report.md).

## 2026-09-24 — Gym leader journey (r2) + elixir round 5 (7.1.7, feedback #263-#274)

- **#263** `BOAT_DEFENSE_SQL` (war-battles-sql.mjs) in warBattlesSql and the participation war-day branch (PK lookup for boat rows only, the scan stays index-only); compact battles_query keeps boat.side. Standings' rate still counts defenses via the daily rollups (263.3 known to 10-08). Battles after a race closes (~09:38) landing on the prior grid day: not changed, open.
- **#264** roster first stint + rejoined_observed_at; participation tenure held for Jamie (264.1 known): Clan's new-member grace reads it.
- **#265/#269/#270/#271** member sessions named, whole, 2+ battles; member reads never move the pointer. **#266** training-day war null. **#267** quiet summary per member. **#272** presence items from gaps (time-keyed dedupe; returns from gaps, with each member's last battle before the fetch bound). **#273** timeline schema/page bounds. #268/#274 praise. 245.1 retired (274.1 replaces it).
- Console walked signed in as Jamie (magic code via Fastmail, Jamie-authorized): 28 pages, no console errors or failed calls; fixed the seven-emails copy.

## 2026-09-24 — Gym players round 4 (7.1.8, feedback #275-#278)

- 9 regressions: #228-#230, #232-#234 hold (#229 on all 48 members, #233 profile = roster for all). **#275** season_* are the API's legacy leagueStatistics (Trophy Road mirror, frozen best): relabelled + note. **#276** players_profile snapshot.progress (latest per bucket, 35 days). **#277** "lower bound" everywhere pre_reset is described. gym-interp: text_match / text_not_match. #278 praise. #134 (collection window season) unchanged, not refiled.

## 2026-09-24 — Signed-in console walk 2 + badges round 5 (7.1.9, feedback #279-#280)

- Console (read-only walk, 36 findings): fixed **battle record crash** (arena {id,name}), **Explore decks list over the cap** (compact, limit 50), **activity graph at 390 px** (grid minmax, legend wraps), **war weeks rank/fame** (our_rank/our_fame), **members last battle** (last_recorded_battle), selected chip contrast, **WEEK_RE** accepts "136-2", no-records link to Tracking, tracking cadence text, Connections LAST CALL only a real call, admin principal name only for agents. Left for Jamie: timeline read_to vs named readers, duplicate clan/player timeline rows, feedback badge 65 vs 50, admin feedback filer, repeated Card of the Week sends, agent console connections for service keys, polish list.
- Badges r5: 12 regressions hold. **#279** players_considered 0 note. Holder observed_at = greatest(snapshot, poll_state) (91.1/91.4 caught by the players gate).
- A Gym wrote fb.json into the repo root; moved to /tmp/gym-stray/ (untracked scratch).

## 2026-09-24 — Gym cards round 5 (7.1.10, feedback #281-#285)

- 18 regressions, 17 hold; #256 residue -> **#284** (population cutoff wording). **#281** first_played earliest per form. **#282** tower troop refusal (a tower-troop tool is a missing interface, for Jamie). **#283** held observed_at = newest profile read, since = first seen. #285 praise. Explore's deck list limit 20 (it was still 62k at 50).


## 2026-09-24 — Gym collections r4, rankings r4, game r4 (7.1.11-7.1.12, feedback #286-#299)

- **#286** a clan segment pools only recorded members (`RECORDED_PLAYERS_SQL` in `segmentFilter`), with a `coverage` object and note when fewer than the roster count (Jamie's ghost-entry rule). **#287/#288** collection notes. `elixir_my_players` rows carry `clan_name` (JSON API 1.3.0).
- **#290-#293** rankings_timeline floor note names departures, clan-zero note, inverted window refused, unrecorded location lists the recorded ones. **#294** (feature, decided under the overnight mandate) `rankings_clan_ladder` `snapshot.floor_score` + `our_clan`; `clans_roster` `clan_score`/`clan_war_trophies`/`scores_observed_at`. POAP KINGS 130,694, 6,027 under the US floor.
- **#296** game_events names touched game days whose read fell outside the window; **#297** season; **#298** game_clock `is_colosseum`, `weeks_in_season`, `colosseum_starts_at` (additive in ingest's gameClock).
- Harness: `[?k=n]` filters match numeric strings (295.4); 286.4 regex amended (it caught the outside-meta note); `--acceptance=a,b` gates several families in one pass.
- Rankings' out-of-family changelog lead refuted: request 041cd18b ran 2026-09-23T23:05Z while 6.35.0 was live.
- Clan repo cb3a11c: departure cards skip members who rejoined; open ones withdraw ("The member rejoined the clan.").

## 2026-09-24 — RoyaleAPI cross-check, training days, battles r5, elixir r6 (7.1.13-7.1.16)

- **RoyaleAPI export (Jamie):** roster 48/48 (diffs only newer Elixir reads); war 531 member-weeks x fame/decks/boat attacks over 10 weeks: 0 differences; clan finish/trophy change match; banked fame by design (0164); 10,305 = 3 x (3,000 + 435) per the API's periodLogs.
- **Training days (Jamie):** war-day-only was an elixir-bot holdover. 0167 `war_training_day` (own table; never attendance), 0168 `source` poll|battlelog; `war_current.training_today`, `war_history.member_weeks[].training_decks` (7.1.14). Migrate op `{training_backfill:{season_id, apply}}` (7.1.15) rebuilt S130-S136 (726 member-days); the rebuild matched the poll 7/7. cr-agent-api-docs: decksUsedToday counts practice on training days.
- **#300** clan segment note (7.1.13). **#302** conditional recurring-sitting note on member reads; **#303** +N on every capped summary list (7.1.16). 285.2 flaked once (battles arriving between its two live calls).
- **Training days in ONE table (Jamie):** "the same four war decks; you can only play them once [on a war day], so training days are reps." 0169 folds training into `war_attendance_day` keyed by `day_in_section` 0-6 with `war_day` generated (null on training days); whole-week war readers filter `war_day is not null`; 0170 drops `war_training_day` (7.1.17).
- **Clans r5 (7.1.18):** #305 compact weekly-counter delta sums across resets (note only when a reset is inside the window); #306 the training rebuild splits at the race's own close slot (`war_week.closed_at` time-of-day, latest earlier close as fallback); `training_backfill` now re-derives battlelog rows and removes ones the rebuild no longer produces. Re-run S130-S136.
- **Collections r5 (7.1.19):** #308 coverage note says "not recorded now". **Game r5: CLEAN on 7.1.19**, the sweep's first; 126.5 confirmed (09-24 read 10:07:54Z). **War r4 (7.1.20)** on live war day 1: 25/25 hold; #311 glossary clan_score + war_rivals docs, #312 roster vs current-member participants note.
- **Tower troops (7.2.0):** `battles_meta_cards` `tower_troops: true` (population/raw path; the season rollup holds only the eight), `cards_card` tower branch. Deck identity always included the tower troop.
- **Closed-season rollups miss late battles:** the 7.2.0 gate failed 154.1/154.4/207.1 because S135's `meta_season_pop` (built 00:50Z) lacked 74 late-captured battles the raw read had. `meta_rollup_season {season_month: "2026-08"}` rebuilt it (decided 44,956 -> 45,002) and the cases pass. Follow-up: the nightly should re-roll a final season when late battles for it arrive, or the acceptance pair will drift again.
- **Also today:** 7.1.21 decks_today every race-week day; 7.1.22 boat defenses leave clans_standings (0171 + `rollup_boat_defenses` backfill, 2,245 defenses); 7.1.23 current-stint tenure with the 7-day rule; ops `oauth_grants` (13 stale Clan MCP grants revoked for Jamie), `war_gap_census` (about 54 member-days in the race-roll gap across history), `training_backfill` re-derives/removes.

## 2026-09-24 — Pre-beta Gym pass over all ten families (7.2.2-7.2.6, feedback #314-#347)

- Game CLEAN (r6). Findings fixed: #315 tower shares (river race battles carry no tower troop), #317-#320 timeline, #322 board freshness (the keep-the-boards sync stood down at 10:20Z behind this session's checkout lease; re-run 14:45Z), #324-#326 card names, #328-#331 players, #333-#335 clans, #337-#338 roster badges, #340 in-progress fame, #343-#344 our_clan.
- **Open for Jamie:** #342 the API served incomplete Path of Legends boards minutes after the 10:00Z reset (global lost 392 players, cutoff -61); boards re-read 15:13Z and rankings_players notes an implausible cutoff fall, but the recording-side fix (re-read the reset board when it looks incomplete, or read later) touches the 2026-09-11 decision. #345 season_id string vs number is a breaking type change.
- Lesson: holding the checkout lease across 10:20Z blocks the keep-the-boards automation's daily sync.
- Journey r3 (new user, 12 questions, beta verdict): 11 of 12 right on the first call, 22 regressions confirmed fixed. #348: `min_players: 2` let one player's 57-0 run lead the deck recommendation as "3 players, 57-2"; 7.2.7 adds `top_player_battles` (rows with 2-5 players, one raw query over the returned hashes on the `(deck_hash, battle_time)` index) and a carried-row note. Left open (not filed): timeline vs standings differ by 4-5 battles for the same window; `cards_card season.forms[].players` null unexplained; `elixir_examples {example}` has no notes, `elixir_docs {query}` no docs pointer.

## 2026-09-24 — Jamie's pre-beta follow-ups, part one (7.3.0)

Jamie took the seven follow-ups one at a time; decisions are in DECISIONS.md.
- #342: 0173 adds `ranking_snapshot.suspect/superseded_at` and `ranking_board.reread_at`. Ingest flags a full PoL board whose cutoff fell 40+ below the last good snapshot and owes one re-read 30 min on (once per board-day); the next snapshot that board-day supersedes it; the planner treats `reread_at` as due. Readers (timeline, `as_of`, the suspect note's previous snapshot) skip superseded rows. keep-the-boards moved to 06:00 CT (repo toml and the installed ~/.codex automation; the installed one runs WE/SA, the repo says daily - left as found) so it syncs after any re-read.
- Timeline 292 vs standings 312 on the 09-23 game day: not a bug. Timeline = distinct battles, learned basis, played in the clan (292 learned, 293 played); standings = per member, play time, today's members. 13 of Vijay's friendlies were against clanmates (Gem 6, L-Drxgo 6, Sandeep 1) and count on both rows; alex brought 2 battles for another clan. Note and timeline docs say so.
- Closed-season late roll lives in the nightly (not a separate job): the nightly is 60-340 s since the persisted population (last night 63 s), far from 900 s, so the 09-19 projection no longer holds.
- `notes`/`docs` defaulted in the registry wrapper and required by every output schema (tool-conventions test).

## 2026-09-24 — 8.0.0, the major before open beta

- #345: the rankings snapshot block serves `season_id` as a number (rankings_players, rankings_clans, rankings_clan_ladder). No first-party client calls a rankings tool (Clan, Drop, the Discord preview, elixir-bot, poapkings.com checked); clients/boards does not read season_id. 345.1 left known.json.
- #348: 0174 adds `repeat_players` to deck_meta_season(_band), written by the nightly from the dp/dpb temp tables; the raw path counts it from per-(deck, player) sums. `min_players` filters on it; a rollup row not yet rebuilt falls back to `players` with a note. After the deploy, 2026-09 and 2026-08 are rebuilt by hand (`meta_rollup_season`) so the fallback is brief. Gym 348.5 pins the carried deck's absence.
- Deployed 8.0.0 without the gate, rebuilt 2026-09 (74 s; deck_repeat 5.6 s) and 2026-08 (27 s) with `meta_rollup_season`, then ran the full suite: 1,236 cases, 5 failed. 348.5 (a thin band now answers empty: amended, 348.6 pins repeat_players on ranked), 329.1/329.3 (a real bug: `current` compared against the newest bucket, not the newest profile read; 8.0.1 with a unit test), 304.1 (a race between two live reads; passes alone), live_fetch#0 (live_pending flake). 8.0.1 players gate: 116/0.
- The 11000_13000 ladder band returns no decks at min_players 2 this season: 2,292 decided battles, every deck one player's. Honest; the note counts what was left out.
- Feedback #329, #342, #345, #348 answered done.

## 2026-09-24 — Trophy bands, three (8.1.0)

- Census (`trophy_band_census`, a new read-only migrate op, 60 days): 54,140 banded meta battles, 22,994 players; decks with two repeat players per 1,000-trophy bin were 0 everywhere from 1,000 to 10,000 (1 under 1,000), 9/20/39 at 10-13k, 242 at 13k+. No battle started above 14,000 (the cap). 22,118 of ~38k recorded players sit at 14,000.
- Jamie chose under_10000 / 10000_13999 / trophy_road_complete (7,893 / 29,793 / 16,450 battles; 3 / 105 / 186 listable decks) and kept it in v8 (8.1.0).
- 0175 swaps the band checks NOT VALID and nulls every season's bands_rebuilt_at, so band reads use the raw rows (numbers) until `meta_rollup_season {reset: true}` rebuilds 2026-09 and 2026-08; older seasons stay on the raw path. No big-table rewrite.
- Gym: live cases moved to the band holding their old one (amended); frozen 256.1/.2/.4 and 348.1/.3/.4 retired (refuted with the reason); nine bites whose args changed were dropped with their captures.
- Found after the rebuild: `trophy_road_complete` has NO ladder battles. At 14,000 the ladder is Path of Legends (ranked, unbanded), so the cap band is the finished players' river race and friendly battles (Witch: 569 war, 236 casual). CAP_BAND_NOTE says so on the four band readers; methodology documents it.
- `top_player_battles` now rides rows with at most five repeat players (was 2-5 players): deck 72c6c8fb in the wider band has 16 players, 2 repeat, 98 battles. 348.5 amended to pin it; 256.3 moved to under_10000 (18 of 20 top rows solo there); 191.6 pins war, not ladder.
- Gate: battles + cards 301 cases, 0 failed. Rebuilt 2026-09 (126 s) and 2026-08 (43 s) with reset. Seasons before 2026-08 answer bands from the raw rows.

## 2026-09-24 — Tool calls leave Tinylytics

- Jamie removed the server-side `mcp.tool_call` / `explore.tool_call` events (the hosting review found them): 43,290 of the email queue's messages in the week to 09-24 were analytics against ~103 real mails, and 10,408 of those events (24%) were refused by Tinylytics with 429 and dropped by the relay. `mcp_call_audit` and the per-tool EMF metrics already hold every call.
- The invoker lost its `track` dependency (MCP door and Explore); the REST door never passed one. The site's own events (`site.signin`, `signup.*`, `site.feedback`) still ride the relay, and browser analytics are untouched.
- The SQS interface endpoint ($14.60/mo) stays: sign-in and product mail and the editor still cross the VPC through it. Replacing it (an S3 outbox through the free gateway endpoint) is a separate decision.

## 2026-09-24 — The outbox replaces the SQS interface endpoint, step one

- Jamie: no Tinylytics events from the server at all, and mail and the editor hand-off move to S3 so the $14.60/mo SQS interface endpoint can go. SQS stays (retries, DLQs, burst buffering); only the VPC's door to it changes: VPC Lambdas write one JSON object per message to `elixir-mcp-outbox-<acct>` through the free S3 gateway endpoint, S3 notifies the lane's queue, the relay or editor reads, acts, deletes. An object still there after the retries is what dead-lettered; the bucket expires objects at 14 days, the DLQs' retention.
- Step one (this deploy) is expand only: the bucket, its notifications and the S3 queue policy, the grants, and consumers that read an S3 notification OR a message sent straight to the queue (an ops hand-send, and every sender until step two). The web API's sign-in/signup/feedback pings and the relay's Tinylytics client are removed with it.
- Step two switches the senders to the outbox, moves the status page's dead-letter count to "outbox objects older than 15 minutes" (the VPC cannot read SQS without the endpoint), and deletes the endpoint.

## 2026-09-24 — The outbox, step two: senders move, the endpoint goes

- Step one deployed clean (40/40 smoke): S3 accepted the SSE-SQS queues as notification targets, and its `s3:TestEvent` reached both queues. The relay skipped it; the editor's copy arrived 50 s before its new code (the stack updates functions after the bucket), threw `brief_key missing` on the old code and was left for the 900 s visibility retry, which the new code skips.
- Step two: web-api, mcp and jobs write mail (and jobs the editor's brief) to the outbox (`web-api/src/outbox.mjs`); no service imports the SQS client now. The status page's `dlq_messages` is outbox objects past their lane's last retry (email 15 min, editor 60 min), because the VPC cannot read SQS without the endpoint; the DLQ alarms are unchanged. The SQS interface endpoint and its security group are deleted.
- EMAIL.md's 256 KB SQS cap on a rendered mail no longer applies: the queue carries only S3's notification.
- The Tinylytics API token: gone from the relay's environment (verified by name after step one) and from the local `.env`; never in git history; no other local copy. **QUEUED FOR JAMIE:** (1) revoke the token in Tinylytics — the only real purge; (2) delete the `tinylytics_api_token` key from the `elixir-mcp/app` secret (console: Secrets Manager, elixir-mcp/app, Retrieve, Edit, remove the row, Save). An agent cannot do (2) within the secret-safety rules: `asm-exec` has no working backend here (no Secrets Manager Agent on :2773, and the AWS MCP endpoint no longer offers `aws___call_aws`), and every other path reads the value. The previous secret version keeps the token until AWS deletes unlabelled versions, which is why (1) matters.
- Step two deployed 20:14Z (40/40 smoke). Verified live: the only VPC endpoint left is the S3 gateway; web-api, mcp and jobs carry OUTBOX_BUCKET and no queue URLs; the status page's S3 dead-letter count answers without error; the editor's test-event retry at 20:20:27Z ran the new code and skipped it; all four queues and both DLQs empty. End to end: one sign-in code requested for Jamie's address (the authorized walk's first step, code not used) went web-api → outbox → S3 → SQS → relay → SES and was in his Fastmail inbox 6 s later; the relay deleted the object.

## 2026-09-24 — CloudWatch custom metrics: every metric has a reader

- Jamie: "super critical" on the ~$27/mo custom-metric bill. Measured by metric-hours over 7 days (billing is per metric per hour with data): $26.49/mo, matching the bill. `ElixirMCP/Tools` per-Tool $15.52 (224 metrics, 4 measures x 56 tools), Ledger $4.11 (15), WeeklyThingLibrarian $3.46 (another project), Ingest $1.49 (5), Tools totals $1.20 (4), Record/Email/Series $0.69, ElixirClan $0.
- Readers: the dashboard draws only the Tools TOTALS (DurationMs, Errors, DbMs), 13 Ledger gauges, all 5 Ingest, 7 Series, 6 Record; alarms read Tools DurationMs p95, Ledger DeadJobs and OldestQueuedAgeSeconds, Record SeasonWarIdMismatch and WarBattleUnresolved, Email ComposeFailed; Run Elixir MCP reads Ledger PlannedJobs. Nothing read the per-Tool series, Tools ResultBytes, Ledger NotFoundHeld or Series ClanTableMB: cut (their numbers stay on the EMF lines as properties). Expected: about -$16/mo.
- Found: ElixirClan sent no datapoints in 7 days against 414 Lambda invocations, so Clan's `elixir-clan-slow-requests` alarm watches nothing (the handler's `log.metric?.` has no `metric` on `console`). Clan's repo; not touched here.
- Open for Jamie: the dashboard-only Ledger gauges and Ingest counts (~$4/mo) duplicate what Postgres and the status page hold; the account has four dashboards and three are free, and one is "Lambda" (2017).
- Deployed 103a38b (40/40 smoke). Then Jamie: "We are internally logging all MCP calls including duration… I don't plan to log into AWS to review them." So the rule tightened to: a custom metric exists only to back an alarm, and no dashboard. Removed the `elixir-mcp` dashboard (the account's fourth; three are free, so this also ends the $3/mo dashboard charge), the invoker's per-call EMF line and its `ToolLatencyP95Alarm` (the door's `McpLatencyAlarm` on the free AWS/Lambda Duration p95 stays), the Ingest line per submission, the Series and efficiency EMF lines (the census and the table stay), the shape census's metric (its findings are feedback rows), and every Ledger metric but DeadJobs and OldestQueuedAgeSeconds (the rest ride the line as properties). Run Elixir MCP now reads planned work from the status endpoint's `queue` and lost battles from `capture_efficiency_daily`. Expected: Elixir custom metrics about $23/mo to about $1.50/mo, and the dashboard's $3/mo.

## 2026-09-24 — SES only; the JMAP transport and its secret key are gone

- Jamie removed `tinylytics_api_token` and `jmap_token` from `elixir-mcp/app` (mail has been on SES since 09-17). The template still resolved `jmap_token` into the relay's `JMAP_TOKEN`, so the next deploy would have failed the whole stack update on the missing key. Removed: the `EmailTransport` parameter (and its PRESERVED entry), `JMAP_TOKEN`/`EMAIL_TRANSPORT` on the relay, `services/email-relay/src/jmap.mjs` and its tests; the relay sends over SES only. `bootstrap.mjs` no longer needs a Fastmail token to create the secret.
- Drop also sends over SES. The Fastmail token itself must NOT be revoked: elixir-bot still uses JMAP (`FASTMAIL_JMAP_TOKEN`, its own .env), and Drop's AGENT-TEAM `mail-bug-reports.mjs` reads the drop@ mailbox over JMAP (read-only). Receiving stays at Fastmail.
- Still Jamie's: revoke the Tinylytics `tly-fa-` key in Tinylytics (no key API).
- **The 21:19Z deploy failed, and the first diagnosis was wrong.** EmailRelayFunction failed with "Could not find a value associated with JSONKey in SecretString" and the stack rolled back cleanly. `buttondown_api_token` was present (Jamie checked). The missing key was `jmap_token`, referenced only by the relay's PREVIOUS template: updating a resource, CloudFormation re-resolves the old template's dynamic references to rebuild its previous state. Jamie set `jmap_token` to the placeholder "disabled"; main (7fb2e85) then deployed at 21:28Z (40/40 smoke). The relay's env is BUTTONDOWN_API_TOKEN, FROM_EMAIL and SES_CONFIGURATION_SET, and the stack no longer has EmailTransport, so `jmap_token` can be deleted for good.
- Rule for next time: remove a key from `elixir-mcp/app` only AFTER a deploy of a template that no longer references it has succeeded.
- Closed (Jamie, 2026-09-24): the Tinylytics `tly-fa-` key is revoked, and `tinylytics_api_token` and `jmap_token` are out of `elixir-mcp/app` (the deployed template reads only anthropic_api_key, buttondown_api_token, db_password and session_secret). The claude.ai Tinylytics connector uses its own key ("MCP — Claude") and still works.

## 2026-09-24 — Account cleanup: the billing alarm goes

- Account review (Jamie): Clan, Drop and elixir-mcp each carried an account-wide `AWS/Billing EstimatedCharges` alarm ($10, $50, $40) below normal spend, so all three sat in ALARM and never notified again. Removed from all three stacks, with `MonthlyCostAlarmUsd`. Removed by hand the same day: the stopped AWS Config recorder and delivery channel, the `config-topic` and `Admin_email` SNS topics, an empty 2016 Glacier vault, an unused 2016-era VPC (172.30.0.0/16), IAM users `elixir-drop-cr-bridge` (no keys) and `s3files` (an S3FullAccess key unused since 07-26), and the ECR repo `agent-thing` (July 2025, the Librarian API's precursor).
- KEPT: `thingelstad-logs` is the account's CloudTrail destination (trail `Default`, multi-region, validation on); its 365-day expiry is what shrinks it.

## 2026-09-25 — Acceptance catalogue excludes the live lane

- The daily read-only acceptance run received `live_pending` from its one-shot `live_fetch` catalogue case: correct asynchronous live-lane behavior, but an invalid assertion because the harness promises not to exercise live reads. `shapeCatalogue` now drops raw `live_fetch` and `live: true` rows, with a regression test; the committed catalogue no longer contains that call. This is a harness correction, not a recorder or collector incident.
- The catalogue-only read exposed an old daily-allocation assertion. Jamie's weekly-deck decision supersedes it: `clans_participation` now drops `war_decks_by_day`, `war_battles_by_day` and `war_days_battled`; the public docs, output schema, Gym case and historical bite change with the 9.0.0 contract. Its bounded full-participation seed now witnesses the retained weekly fields. `war_history` retains its separately observed exact-week attendance facts. The same single run had two marginal timing-budget overruns (`badges_rarity` 4,064 ms over 4,000; `battles_meta_decks` 10,950 ms over 9,974); both had passed in the earlier full run and production remained healthy, so they are a watch rather than a re-run or threshold change.
- Jamie clarified the SemVer boundary for agent-facing MCP: majors track domain-model shifts, not ordinary wire cleanup. An absent response field withdraws a claim for an agent reading the current declaration; removing an unreliable field is a patch. 9.0.0 stays as shipped, but does not set future precedent.

## 2026-09-25 — Cost-neutral queue and traffic guardrails

- The email and editor SQS visibility timeouts now follow Lambda's six-times-consumer-timeout guidance: 360 seconds for the 60-second relay and 5,040 seconds for the 840-second editor. This prevents a still-running invocation from receiving the same message again; retries and DLQ retention are unchanged.
- Fourteen days of API Gateway access logs measured one-second peaks of 15 requests for the site API and 48 for the MCP API (p99 9 and 7). Their API Gateway-managed `$default` stages now have evidence-sized default ceilings of 20 requests/second with a 40-request burst, and 50 requests/second with a 100-request burst. `infra/scripts/configure-api-throttles.mjs` owns the direct, identity-checked apply/check path because quick-create stages cannot be represented as CloudFormation stage resources.
- The proposed database concurrency control was already shipped and live: web API 20, MCP 20, scheduler 1, migrate 1 and jobs 1. The new infrastructure regression test pins those ceilings instead of adding redundant limits.

## 2026-09-25 — deploy.mjs refuses unknown flags

- The morning's Run Elixir MCP ran `deploy.mjs --help` to check deploy capability. The script ignored flags it did not know, so that was a full production deploy (of the clean published HEAD, so harmless; the run note did not record it). Arguments now parse in `infra/scripts/lib/deploy-args.mjs` before the first AWS call: `--help`/`-h` prints every flag and exits, and anything unknown exits 2 with "nothing was deployed". A test pins the flag list and that the refusal precedes STS, the build and the first `.send(`.

## 2026-09-25 — War facts are weekly aggregates everywhere (9.0.1, JSON API 2.0.0)

- Jamie, reviewing 9.0.0: war_history should do the same, weekly decks, because "we cannot determine the day they were played from the api and cannot guess at the scale that elixir runs. You can for a single clan, but not for what we are doing." And: "We cannot reliably determine a war day rollover so we need to only use aggregates per week." 9.0.0's claim that war_history kept "separately observed" attendance was wrong: `war_days_battled` there was the same polls-plus-grid split participation dropped.
- 9.0.1 removes every per-member day split: `war_history.member_weeks[]` `war_days_battled`, `war_days`, `training_decks`, `scoring_decks`; `war_current.attendance_by_war_day` and `participants[].scoring_decks`; `clans_participation.members[].war_scoring_decks`. Kept: the game's weekly counters, the race's own day-by-day (`days`, `finish_war_day`, from periodLogs) and `war_current.decks_today` (the game's count for the day in progress). `decksAfterFinish` and `scoringDecks` are gone; the boat note quotes boat attacks against `decks_used`. Participation's SQL is four reads, not six (the war-day battle branch and the attendance read only fed the removed fields and a null-vs-0 guess; `war_decks` is now `null` wherever the member has no race row). war_history's member query is one scan of war_participation.
- Versioning (Jamie): the agent-aware rule is MCP only. The JSON API keeps ordinary semver, so it goes to 2.0.0 for the participation day fields 9.0.0 and 9.0.1 removed from `/api/v1/clans/{tag}/participation`; the path stays `/api/v1` (it is the OAuth audience). The integrations page gains a Versions section.
- Acceptance: 15 Gym cases on the removed fields are `refuted` with the decision, 10 `amended` (312.1 now reads the `participants_count` note, 143.1 the boat share against the week's decks); five bites for refuted cases and their four captures go. With the day arrays gone the eight-week participation read fits the agent cap (checked live at 9.0.0: 48 members, full), so the known entries for `catalogue/clans_participation#0/#1` and `gym/159.1` are removed, and so is the two-week seed that only existed to get past the cap. `gym/263.2`'s known entry (race-close vs grid day) is moot. The catalogue again keeps a `live: true` call as its recorded read; only `live_fetch` is dropped.
- Deployed 2026-09-25 13:14Z (8:14 AM CT) from 30cfeb0, on Jamie's go. The 13:06Z blocked-run note (deploy owed: the auto-mode classifier refused the deploy) is resolved by this deploy. Live: contract 9.0.1, JSON API 2.0.0, status healthy. `--acceptance=war,clans`: 273 cases, 31 skipped (the refuted ones among them), 1 failed: `budgets/clans_participation` `{weeks: 2}` at 13,844 ms against 8,000, the first participation read after the deploy. Re-run warm three times: 969, 778 and 768 ms. A cold first call, not a regression; the eight-week catalogue reads in the same pass took 929 and 833 ms.
- Elixir Clan b4a5d61 (fixture carries no day arrays; facts.mjs no longer claims a per-day fidelity) merged to main and deployed by its CI the same morning.

## 2026-09-25 — The consistency pass (9.1.0, JSON API 2.1.0)

- Jamie, after 9.0.1: the war-day change had gone out to one surface and not the others, so check every facet of Elixir against what it connects to, and find the docs and artifacts that no longer apply. The audit (four parallel readers; findings verified against code before they were reported) found decisions realized in one place and not in the next, rules no code carries out, runbooks on retired plumbing, and a ledger that agents were not reading because AGENTS.md and the objective files pointed at NOTES. DECISIONS.md is now the read path; the lines the audit found stale or missing were rewritten or added the same day.
- Jamie's twenty calls, one by one: acceptance stays opt-in per deploy with a loud WARNING when skipped; the war aliases (`clan_score`, `our_clan_score`) and `training_today` go now as a patch; `account:email` is offered only to the family's own apps; removing a primary with other claims is refused (choose a new primary first), with no silent promotion; opponents' decks are meta evidence and the counts say so; `clanMate` and unknown battle types are casual everywhere; one clan report per tracked clan is ratified; collector credits follow points; Drop moves to the JSON API and elixir-bot stays on MCP, unpinned; no collector pin; /status stays signed-in; poapkings.com is left as is, even where it is wrong; the ~726 battle-log `war_attendance_day` rows are deleted (0176); the `cards_card` segment prior is documented as it is; the arena mail headline splits per mode family; `on_behalf_of` is ignored on personal connections and the identity tools become agent-only; integrations are admin-only and leave the tier table; both trophy_range fields stay, documented; the daily cloud Gym routine is retired; and all four housekeeping items.
- Boat defenses leave every count of a member's own battles (`notBoatDefense`, `ownBattlesClause`): performance, compare, trends, participation and the activity feed. The pooled-mode answers (performance, compare) now carry a `modes` split and say they pooled. The clan-report deck tally shows only for a race day in progress.
- Security found by the new tests: a read-only grant could call `POST /api/v1/me/players`. Person routes now enforce the mirrored tool's required scope (403 `insufficient_scope`).
- New guards: `integration-pin.test.mjs` fingerprints the mirrored tools and paths against the OpenAPI version, so an MCP patch that changes a JSON API response fails until the operation's version moves; `migration-rules.test.mjs` enforces the lock and rewrite rules from 0176 on (verified to catch 0152 and 0169); the brief must name every segment tool; every tool with `from` accepts `season`; 9.x retired names are banned from declarations and allowed in docs only as history.
- Housekeeping: the README is rewritten; OPERATORS.md is gone (operators read /docs/operators); finished plans and early reviews are archived; outside the hub, elixir-bot's Battle Intelligence plans are archived (4574ca84), Drop's vendored cr-agent-api-docs copy is gone (8bc7835), and elixir-family's untracked documents were committed and then the executed prompts and built plans pruned (clash-royale 46bc3b6); the `{training_backfill}`, `{series_import}` and `{series_census}` ops are removed and 0177 drops the `staging` schema; `@aws-sdk/client-iam` is uninstalled; `/api/clan` is removed (Clan reads `/api/v1`); deploy.mjs refuses a dirty worktree.
- Deployed 9.1.0 from f4ecbc65; migrations 0176 and 0177 ran; smoke green. The full acceptance run failed 18 of 1,194, all triaged: the war trophies note named a field the seasons shape does not serve and another tool's `clan_score` the alias had been hiding (fixed in 9.1.1 as `warTrophiesNote(field)`); 141.3 and 200.2 amended for today's decisions (200.2 now reads the identity in ranked, where no boat battle exists: trends drops boat defenses, the meta tools' `considered` counts every boat battle); the battles_query timezone seed went to limit 5 because 9.1.0's `form` took a 10-battle full page past the 48,000 cap, and it is the only call carrying `battle_time_local`, so three docs checks fell with it; `account_role_changed` and `decks_observed` are real and rare (allowed, with reasons); 285.1 was a rollup race between its two calls.
- Deployed 9.1.1 from 9ea86fe6: 1,194 cases, 2 failed, both transient on a re-run (a meta budget 252 ms over under load; a donations sum with a poll between the two calls). 342.1 and 342.3 stay known with a corrected reason: the 7.3.0 re-read is forward-only and their boards predate it.
- 9.1.1 also lets `/oauth/userinfo` answer a person's `/api/v1` grant (an agent's audience is still refused), which Drop's move needed: Drop's Sign in with Elixir now reads `GET /api/v1/me` (the person gate and the players) and `POST /api/v1/me/players` (the alt add), audience `/api/v1` (Drop cffc06d, CI-deployed). Not yet proven live: it needs one real Elixir sign-in on Drop, which only Jamie can do.
- Outside the hub the same day: elixir-bot archived its Battle Intelligence plans (4574ca84) and runs unpinned; Drop removed its vendored reference copy (8bc7835); the domain repo committed elixir-family's untracked documents, then pruned the executed prompts and built plans (46bc3b6); the domain guide links ENGINEERING and DECISIONS (2782811).
- Queued, not done: drop the gateway `iam_user_name`, `static_ip`, `key_source` and `cr_key_ref` columns and the `poll_state` heat columns (contract migrations once no code reads them); narrow MigrateRole `s3:PutObject`; the old-band trophy rows and their unvalidated checks; a `war_attendance_day.source` constraint now that one value remains; clan reports are composed in the first recipient's timezone; the "day not date" renames on the JSON API need its next major; the editor DLQ has no alarm.

## 2026-09-25 — The consistency skill

- Jamie asked to formalize the day's audit and follow-up. `.claude/skills/consistency/` is the repo skill: `/consistency <decision>` traces one DECISIONS line across every surface that depends on it (run it the day a line lands or changes), `/consistency sweep` audits every line, the connected repos and the artifacts. Findings are verified against code before they reach Jamie, product calls go to him one at a time, and each drift class with a mechanical guard gets it in the round that found it. `facets.md` is the alignment map and `classes.md` the drift classes, both seeded from the 09-25 sweep; reports stay out of git, like the Gym's, and the 09-25 audit is the first one.


## 2026-09-25 — The reference audit: the payload archive against cr-agent-api-docs

- Jamie asked whether a skill like elixir-bot's `cr-api-doc-audit` belongs here or in the reference, reading Elixir's S3 archive. Here: the reference is public and caller-neutral (no consumer notes, no raw tags), and the archive, its profile and the manifest's path grammar are the hub's. The archive is the better evidence: every distinct payload since recording began (227,949 on 2026-09-25), every recorded clan and player, and fifteen endpoints including boards and event lists a single-clan tool never reads; the bot's buffer is one clan for 60 days.
- `payload-field-audit.mjs` gains `all`, `--json <dir>` and `--per-entity <n>`; its gate behavior is unchanged. `--json` writes the evidence of `services/ingest/src/payload-evidence.mjs`: per path its occurrences, objects, distinct entities (counted, never listed), JSON types, empty arrays and first and last archive day, plus the values of an allowlist of game-vocabulary paths. A test keeps tags and people's and clans' names off that allowlist, because the evidence feeds a public book.
- `.claude/skills/reference-audit/` turns the evidence into doc patches (new enum values first, then undocumented, absent/null, type drift, never-observed), worded by population and date, applied in the reference only when Jamie approves, each new value added to its enum guard. The UNCATALOGUED list stays a hub finding. Understand Clash Royale's evidence step names it. elixir-bot's skill stays until this one has proven itself; then Represent the Game points here for reference drift.
- First run, the same day: a full sweep (227,949 payloads, 15 endpoints, about 16 minutes), two read-only reviewers, 30 patches proposed. Jamie approved 29 and held one (Ranked `trophyChange`/`startingTrophies`, which rests on one clan's sample). cr-agent-api-docs 3716e7b: 16 new game mode ids, the RR_ event, `rounds` on every duel, CHAOS modifiers on all seven rulesets, King Tower HP never null, `deckSelection` filled in, the 2v2 League, battle arenas off Trophy Road, the empty progress key, `periodLogs` absent (not `[]`) on a fresh race, Colosseum days unlogged (five-week seasons), eventTag = one run of an event, board depth and cursors, and no real tag left in its prose. The run also caught this repo's own privacy slip: `[].modifiers[].tag` was on the evidence allowlist and is a player tag (51dc8e82).
- Queued from the run: three elixir-bot test fixtures in the S3 archive (via the 09-15 backfill; the bot's tests are isolated now), and removing them from the kept-forever archive is Jamie's call; manifest paths never observed in six months (support-card evolution fields, `[].challenge*`, `collectionEndTime`/`warEndTime`, clanwars `clanWarTrophies`, leaderboard `expLevel`); probes on 2026-10-02 (four-week Colosseum logging) and one `riverracelog?limit=20`.


## 2026-09-25 — Four procedure skills: ship, tool-change, migration, ops

- Jamie asked for the four suggested after the reference audit. Each was drafted by a worker from the code, then reviewed against it: every quoted DECISIONS line, path, flag and commit was checked.
  - `ship` is the loop done by hand four times today. It covers bookkeeping, verify, commits, the deploy's acceptance scope, and triage (verdicts in `triage.md`). It also covers the read-back, siblings and close.
  - `tool-change` goes from the DECISIONS check and stop list to the conventions and the second derivations. It then covers the seven mirrored `/api/v1` operations, tests, docs, acceptance and the version class, and has a checklist.
  - `migration` is the ladder: sort the change, the rules test, expand and contract, lock_timeout, a plain index in its own migration, the backfill op, vacuum, the header, the lossless record, the fingerprint re-pin. Its `shapes.md` holds the step-by-step shapes and the SQL traps.
  - `ops` is the read paths plus `ops.md`, a catalogue of all 56 migrate ops, 22 of which write, each naming who may run it. `services/migrate/test/ops-catalogue.test.mjs` keeps it equal to the dispatcher. The Gym and consistency skills now hand shipping to `/ship`, and AGENTS.md indexes all seven repo skills.
- Stale text the workers found and fixed:
  - the Gym skill and WORKFLOW listed six mirrored operations (seven since 2.1.0);
  - ENGINEERING said indexes are built `CONCURRENTLY` (none can be: every migration is one transaction);
  - I had written that a deploy "queues behind" a running backfill (it gets a 429 and stops);
  - the fingerprint test was described as comparing a from-scratch create (it compares the ladder with `db/schema.fingerprint`);
  - `resolveWindow()` is private (`resolveSeasonWindow()`);
  - deploy.mjs's header order was wrong;
  - the card-roles importer claimed to refuse an unpushed reference (it checks uncommitted only);
  - two comments said "ten tools" have output schemas;
  - the acceptance README pointed Gym criteria at `checks/gym.mjs`;
  - AGENTS.md's verify omitted typecheck.
- Queued, not done:
  - The migrate handler runs the migration ladder for any payload with no known key, so a misspelled op or `{"stats": false}` applies pending migrations. It should refuse a non-empty payload it does not know; `{}` stays the deploy's call.
  - `{explain_meta}`'s excluded breakdown has drifted from the tool's.
  - `{series_backfill}` defaults to a 240 s budget, past the 90 s duration alarm.
  - Checksum immutability is enforced only when production applies a migration; no test catches an edited shipped file.
  - The rules test does not require `set local lock_timeout` (0172-0175 lack it).
  - No test enforces the changelog's `breaking` field.
  - No runbook grants `{terminate_backends}`, `{gateway_drain}`/`{gateway_recover}`, `{collection}`, the `{account_*}` ops or `{oauth_grants}`, so each is Jamie's call.

## 2026-09-25 — The Needs-you list, decided (9.1.2)

- Jamie took every recommendation, one at a time.
  - **Only `{}` migrates:** a migrate payload whose op key the dispatcher does not know is refused (`unknown_op`), with a test.
  - **Incident authority** for Run Elixir MCP: `{terminate_backends}` on a migration or backfill backend past five minutes, `{gateway_drain}`/`{gateway_recover}` for a collector submitting errors or bad data. Recorded in its Action section, in DECISIONS and in the ops catalogue. Account-touching write ops stay his.
  - **The four small fixes:**
    - `{explain_meta}` now EXPLAINs the tool's own `excludedBreakdown` SQL through a stand-in client, so it cannot drift again.
    - `{series_backfill}` and its driver default to 45 s, under the 90 s alarm.
    - `db/migrations.sha256` pins every shipped migration and `migration-lock.test.mjs` fails an edit (checked by editing 0177 and reverting).
    - The rules test requires `lock_timeout` on a migration that locks a table it did not create.
  - **`decks_today` is the game's counter only** (contract 9.1.2), and the timeline's clan `war.decks` with it. The grid-placed battle count, `over_cap` and `decks_observed` are gone, the names banned by the retired-names test, and `war-battles-sql.mjs` removed with its last reader.
  - **`{mode_shape_census}` gains `ranked_by_league`.** It is run once after this deploy to settle the held Ranked patch.
- Outside the hub:
  - elixir-bot retired `cr-api-doc-audit` (89b17f86); Represent the Game points at the reference audit.
  - The reference now says the river race log is ten weeks: one `limit=20` read on POAP KINGS returned the same ten with empty cursors (cr-agent-api-docs bc6be0f).
  - Understand Clash Royale has a dated watch for four-week Colosseum logging, from 2026-10-03 (clash-royale bc4c37a).
  - The Clan item resolved itself: that session pushed its work and is still working under its lease.
- **The archive fixtures, found read-only.** Five objects, all stamped 2026-05-28T22:20:24Z, one elixir-bot test run:
  - a clan stub under entity `ABC`;
  - two player stubs under `ABC123`;
  - a race stub under `J2RGCRVG`;
  - a one-card catalog under `GLOBAL`.

  `ABC` and `ABC123` are not valid tags (the hub's normalizer refuses them), and `{poll_state}` finds no receipts or state for either. The two stubs under real entities carry no clans, periods or members for a projector to write. Deletion waits on Jamie's look at the exact list.
- After the 9.1.2 deploy (acceptance for war, elixir and clans: 436 cases, 0 failed), two live reads. A misspelled op (`{"stat": true}`) answered `unknown_op` and ran nothing. `{mode_shape_census}`'s `ranked_by_league` settled the held reference patch on the whole record: leagues 1-6 carry `trophyChange` only on a win, always +30 (47,571 wins, no loss) and never `startingTrophies` (95,148 participants), and league 7 carries both on every participant (397,202). The patch was applied as counted (cr-agent-api-docs a1a17b9), without the sample's tournament and boat-battle parts. timeline.md's "ranked battles carry none" was corrected and deployed. The snapshot commit 7360275f says a1a17b9 but recorded bc6be0f; this commit's snapshot is a1a17b9.
- The archive fixtures, removed on Jamie's go. All five matched the list by byte count, and each is now a delete marker that `HeadObject` answers 404 (the bucket is versioned, so the old versions stay recoverable):
  - `payloads/endpoint=clan/entity=ABC/…3bfd67fefcfc3a02`
  - `player/entity=ABC123/…458fd7fbf8cac5f7` and `…87133eab6876acd6`
  - `currentriverrace/entity=J2RGCRVG/…230a6a07a9cb877d`
  - `cards/entity=GLOBAL/…d9b631282b0bb668`

  DECISIONS records the exception.

## 2026-09-25 — Attested facts: the family's apps write back (9.2.0, JSON API 2.2.0)

Door 3 of Elixir Clan's doors plan (clan.poapkings.com
`docs/plans/elixir-doors.md`). Jamie's three calls, 2026-09-25: admit
attested facts, **separate and labelled**; visibility **per type**; this
round is **Elixir's door, then Clan** (Drop follows in its own session).

- **Storage:** `attested_fact` (0178), apart from `clan_event` and
  `player_event`, which stay collector-only. One row per (source, ref): a
  retry is the same fact and a new detail the attester's newer word.
- **Writes:** `POST /api/v1/clans/{tag}/facts` and `DELETE
  /api/v1/clans/{tag}/facts/{ref}` for a person through a first-party
  client holding the new non-standard scope `clans:attest` (0178 appends it
  to the grant shape checks, NOT VALID; 0179 validates); the attester is
  the person's verified player in the clan with the role
  `clan_membership` holds now, checked against the type. `POST
  /api/v1/players/{tag}/facts` for an integration with `facts:write`.
  `services/web-api/src/attested-facts.mjs`; the registry is
  `packages/contracts/src/facts.ts`.
- **Reads:** the timeline only (`factItems` in `activity/entries.mjs`,
  section `attested`). Decided per reader at read time: clan facts to a
  reader (or an agent's owner) whose verified player is in the clan;
  leaders' facts only to a PERSON whose verified player leads it; player
  facts to whoever has the player as a subject. No reader, no facts: the
  clan mail (`build-clan.mjs`, composed once per clan) carries none, and the
  tracking mail's kind list does not name them.
- **Amended:** DECISIONS "game facts only" and "the consumer taxonomy never
  shapes the domain"; `verify.md`'s "the record is the same for everyone"
  now names the one exception (a clan's word reaches its verified members).
- **Not done here:** Drop's `elixir-drop` integration does not hold
  `facts:write` yet (a `{integration: {action: "configure"}}` in Drop's
  round; Jamie asked that the agent do it). A clan fact appears only for a
  reader who has the clan as a subject; `timeline_pending` does not count
  facts.
- **Shipped** 77dd4c2e: migrations 0178 and 0179 ran (`{"applied":177,"ran":2}`);
  acceptance `--acceptance=elixir` 191 cases, 0 failed, 9 skipped (conditions
  not met). Read-back: status healthy; `/tools.json` contract 9.2.0;
  `/docs/integration-api.json` 2.2.0 with the three fact paths;
  `scopes_supported` ends `clans:attest`; `POST /api/v1/clans/%23…/facts`
  without a token answers 401; `/updates` carries the entry. No live write
  was made to verify (reads and refusal paths only). The privacy page now
  describes attested facts beside game data (not a new bucket).
- **Owed:** a `/consistency` pass on the new DECISIONS line (this session
  swept the docs for contradicted claims by hand; `verify.md` amended,
  the support and privacy "same for everyone" lines are about money and
  still hold).

## 2026-09-25 — Clans on a schedule: `clans:read` (JSON API 2.3.0)

Door 1 of Elixir Clan's doors plan, Jamie's pick after deferring Drop's
move to Elixir-only sign-in. `GET /api/v1/clans/{tag}/participation` and
`/roster` admit an integration holding `clans:read` (the OpenAPI
operations name it in `x-integration-permission`; `INTEGRATION_SCOPES`
reads it), running the same tools through `runTool`, audited by the
invoker. Elixir Clan's integration (`elixir-clan`) is provisioned through
the `{integration}` op with a locally minted digest; Clan keeps the key as
a NoEcho stack parameter, as Drop does. Clan's daily rule waits on one
administrator IAM change in Clan's own stack (Jamie).
- **The 2.3.0 deploy's acceptance** (`--acceptance=clans`): 138 cases, 1
  failed, 9 skipped. `catalogue/clans_timeline#2` ("compact is not larger
  than full") failed again alone, so not a flake: compact ignored named
  `metrics` and answered the five clan metrics. Verdict: fix forward, 9.2.1
  (compact answers the named metrics), with a test in `daily-series`.

## 2026-09-25 — A family app's mail: clan actions waiting (JSON API 2.4.0)

Door 2 of Elixir Clan's doors plan. Jamie's calls: the kind is on to
start; a family app composing mail that Elixir sends is an appropriate
exception to "mail is composed by calling the tools"; only people who can
act on an action are sent it.

- `clan_actions_waiting` is the eighth product kind (bulk, per-account
  switch, one-click off). Rendered by `packages/mail` from the app's plain
  lines, escaped; `tagLink` now tags links into any family app.
- `POST /api/v1/clans/{tag}/mail` (`services/web-api/src/clan-mail.mjs`,
  permission `mail:send`): per player tag, the account whose verified
  claim it is, in the clan today, kind on; `deliver` from jobs does the
  render, archive, outbox and send record; an advisory lock per clan, kind
  and UTC day makes "one a day" hold across the web-api's concurrency.
  The web-api's `email_compose_failed` lines feed the same alarm.
- `facts:write` and `mail:send` are never granted unnamed
  (`DEFAULT_INTEGRATION_SCOPES`; the admin form leaves them unticked).


## 2026-09-25 — A departure's kind reaches the clan and its agent (9.3.0, JSON API 2.5.0)

Jamie, the evening 9.2.0 shipped, while wiring Elixir Clan to the Discord
agent that replaces elixir-bot this weekend: "Departures should be visible
even on a kick… in clan chat everyone sees that the person was kicked. We
then comment on it so everyone knows why." And: where leaders can see
data and agents can't, "assume all of that is fixable and changeable".

- `departure_classified` moves from `leaders` to `clan` in
  `ATTESTED_FACT_TYPES`. `member_away` stays with the leaders.
- The timeline (`factItems`) reads who sees each kind from the registry,
  not the row's stored `visibility`, and the item's `visibility` is the
  type's; a correction (same `ref`) now rewrites the stored column too.
  So no migration rewrites rows written under 9.2.0 (none were expected:
  no clan had turned Elixir Clan's sharing on), and they follow the rule
  anyway.
- Why it matters: a clan's Discord agent posts raw `member_left` items it
  cannot classify. With the kind visible it can wait for the leader's word
  and say "left" or "was removed".
- Contract 9.3.0 (additive for agents); JSON API 2.5.0 (a departure's
  `visibility` reads `clan`). DECISIONS' attested-facts line amended.
- **Shipped:** 6a5e2768, live by 02:26Z on 09-26 (9:26 PM CT on 09-25; a
  timeline read at 02:26:36Z answered `contract_version` 9.3.0). No
  migrations. `/tools.json` 9.3.0, `/docs/integration-api.json` 2.5.0,
  `/updates/2026-09-25-contract-9-3-0/` 200, status healthy.
- **Acceptance** (`--acceptance=elixir`): 191 cases, 4 failed, 9 skipped.
  All four are one pre-existing behaviour, not 9.3.0 (which changed only
  who sees attested facts; none exist yet): gym 303.1-303.3 and 304.2 are
  "frozen" presence windows whose quiet/returned names and +N moved when
  two members left POAP KINGS' roster that day. The clan entry still counts
  them among "players who were members during the window" and lists their
  joins, while its quiet and returned lists and the quiet_crossed/returned
  items read today's roster. 303.3 failed again alone. Verdict: KNOWN until
  2026-10-02, filed for a decision - should a past window's presence keep
  members who have since left, as its header does? - owed to Keep the
  Record True; then fix it or re-freeze the cases.

## 2026-09-25 — battles_deck_sets: four war decks sharing no card (9.4.0)

Jamie, retiring elixir-bot this weekend: "The hardest problem for Elixir-bot
is when members ask it to recommend decks, specifically war decks where you
need 4 decks with no overlapping cards. I suspect that deck
recommendations need to be much more the job of elixir, which is key
because of course players will do the same thing with Claude." Then, on the
design: a new tool (yes), all competitive modes ("just more data"), the
weakest deck protected (yes).

- **The walk it collapses** (dry runs of real #ask-elixir questions through
  the Discord agent's ask lane, 2026-09-25): "Create me a 4 strong war
  decks" took `players_profile`, `link_me` twice and `battles_meta_decks`,
  and returned four decks sharing six cards (Arrows in three); a second run
  (`players_collection`, `battles_meta_decks` twice, `battles_decks`)
  shared Electro Spirit and Fireball. A prompt line made one later run
  valid; the combinatorics are not a prompt's job.
- **Prior art** (research, 2026-09-25): RoyaleAPI's builder dropped
  deck-at-a-time picking ("the 4th deck is always a struggle"); RoyaleTools
  fits to the collection with no outcomes; RoyaleTracker ranks by raw rate
  with no diversity (its ten sets share three decks). A synthetic benchmark
  had greedy failing to find four decks at all where exact search did.
- **What it does** (`services/mcp/src/deck-sets.mjs`, pure;
  `tools/battles/deck-sets.mjs`): the season rollup's eight-card decks over
  `min_battles` (20) and `min_players` (3 repeat players), plus the
  player's own 5+ decks; the collection check in SQL (owned, form unlocked,
  lowest card no more than two under the fielded level); each deck valued
  in log-odds from `deck_meta_season` per mode (shrunk to the mode's prior,
  Trophy Road and Clan Wars minus 0.5 per level of `mean_level_gap`, the
  2026-09-19 measurement), plus 0.5 per level of fit and a 0.05 tie-break
  for a deck they know; branch and bound over the best 1,500 for the sum
  plus the weakest again; alternatives sharing at most two decks; near
  misses with the cards they lost. Evolution/Hero slot rules need no code:
  every candidate is a deck the game let someone play.
- Tests: `deck-sets-solver.test.mjs` (exactness, the weakest counted twice,
  alternatives, require/block, value parts) and `deck-sets.test.mjs` (the
  whole path on a rebuilt season).
- Next, by decision: the upgrade path to decks a player could field is its
  own tool; "complete this partial deck" from co-occurrence is open.
- **9.5.0, the same night (read back through the Discord agent):** asked
  "Create me a 4 strong war decks" as King Thing (fields 15.94), the agent
  called `battles_deck_sets` unprompted and got no set: 889 season decks
  considered, 133 not owned, 419 refused for an Evolution or Hero form not
  unlocked, 334 for a card under 14, 3 left (widening to 5 battles / 2
  players still left 3). A maxed account holds few decks with no card two
  under 16, and most of the meta runs a form someone lacks. Now a form not
  unlocked is played as its base card with `form_term` = minus that card's
  measured form advantage (card_meta_season, form vs base, shrunk, floored
  at 0; the season median where thin), the floor is four levels, and the
  default gates widen once when nothing packs. The 9.4.0 acceptance run's
  one failure, `budgets/meta-decks-clan-season` (10.6 s against 10 s),
  was the post-deploy cold start: 668, 639 and 518 ms alone. Verdict: flake.
- **9.5.0's acceptance** (`--acceptance=battles`): 192 cases, 3 failed.
  `budgets/meta-decks-clan-season` (11.6 s) and `catalogue/battles_trends#1`
  (18.1 s against 4 s) passed alone at 4.3 s and 2.2 s: post-deploy load,
  flakes. `catalogue/battles_deck_sets#notes` was real: King Thing's call
  still returned no set (the notes named `level_term` and `form_term`, which
  only deck rows carry), because 1,585 of 1,864 season decks held a card
  under his floor of 12: main decks maxed, the rest of the collection not.
  **9.5.1** drops the floor on the one wider pass; the gap is priced by
  `level_term` and shown as `fit.lowest_card`.
- **9.5.1 shipped** (61539908). Acceptance (`--acceptance=battles`): 192
  cases, 2 failed, both the same post-deploy timing pair as 9.4.0 and
  9.5.0 (`budgets/meta-decks-clan-season` 12.8 s, `catalogue/battles_trends#1`
  17.7 s; alone 4.6 s and 3.8 s): flakes. Both run before the deck-sets
  case in the suite. `catalogue/battles_deck_sets#0` and `#notes` pass.
  Read back through the Discord agent's ask lane as King Thing: "Create me
  a 4 strong war decks" returned a 32-card set of season decks (97-258
  battles each, one Balloon played as base); "a different last war deck"
  locked his three current war decks (from `battles_decks`) and returned a
  fourth sharing none, its level gap (13.4 vs 15.9) said. The Discord
  brief now names the tool (elixir-mcp-discord df3d75f).
- Owed: the post-deploy timing pair fails every battles deploy now; worth a
  look at whether a warm-up before acceptance, or those ceilings, is the
  fix (not this change's).

## 2026-09-25 — award_standing: the clan's award races mid-season (9.6.0, JSON API 2.6.0)

Jamie: "how will we relay awards status mid week? I guess Clan can publish
the standings each day to Elixir?" — then "Do the mid season standings".
The awards are Elixir Clan's (names, rules, tiebreaks, who is a rookie);
Elixir stays facts-only, so the standing is a fact the app computes and
labels as its own.

- `award_standing` (contracts facts.ts): clan subject, clan visibility,
  about a member; attesters `["app"]`, a new sentinel: the family app on
  its integration key, not a person. Detail: award, award_id, season_id,
  place 1-10, value, unit (points | donations | war_decks), as_of,
  previous_player_tag.
- Written with `POST /clans/{tag}/facts` by an integration holding
  `facts:write` (`writeClanFactAsApp`), taken back with DELETE by the app
  that wrote it (`removeClanFactAsApp`); a person's kinds are refused on
  the key and the app's kind on a person's grant. Source = the
  integration's name (`elixir-clan`, named "Elixir Clan").
- 0180 re-adds the fact_type check NOT VALID with the new type; 0181
  validates it.
- Elixir Clan's morning run writes the running season's podium places per
  computed award (a clan with awards and a policy), one ref per place
  (`standing:<season>:<award>:<player_tag>`), and takes back places no
  longer held. The elixir-clan integration needs `facts:write` added
  (`{integration}` configure) after this deploy.
- **9.6.0 shipped** (0a94dff9; migrations 0180-0181 ran, 179 applied + 2).
  Acceptance (`--acceptance=elixir`): 188 cases, 3 failed, all the frozen
  presence class filed at 9.3.0: gym 267.2, 272.4 and 272.5 name two
  members who left their clan at 03:13Z. KNOWN to
  2026-10-02 with the same open question.
- The elixir-clan integration was reconfigured through `{integration}`
  (`configure`, id e432feb79431): scopes clans:read, mail:send, facts:write;
  limits unchanged (2,000/day, 500/hour, refresh 0). Authority: Jamie, "Do
  the mid season standings" (2026-09-25).


## 2026-09-25 — battles_deck_upgrades (9.7.0)

Jamie: "there is also an angle to think about cards that could be unlocked
with some upgrades... that is a whole other tool", then "Do the mid season
standings and the upgrade tool."

- The reads behind both deck tools moved to `services/mcp/src/deck-sets-data.mjs`
  (priors, form advantages, own decks, the season pool checked against the
  collection, mode records, substitutions), so the two value a deck the
  same way; `battles_deck_sets` answers exactly as before.
- `battles_deck_upgrades`: the baseline is the best set with no level
  floor (the gap is what an upgrade closes). Options are single upgrades
  from decks that could reach the set (their value with every card at the
  fielded level clears the set's weakest deck): a card below that level
  raised at most `max_levels` (default 2), or a form a candidate plays
  unlocked; at most 60 priced, each by re-packing the set with every deck
  holding that card revalued. `gain` is the set value after minus before.
- `within_reach` came from the first test: one card raised by two levels
  moves a deck held two levels under by 0.125 log-odds, never enough to
  join the set, so single options alone never name such a deck. A deck
  outside the set whose every card is at most `max_levels` under is priced
  raised whole (and with its forms unlocked); at most 40 priced, best
  ceiling first.
- Levels, not gold: upgrade costs are not in the record (and `adoption_cost`
  stays declined). `cards_held` is the profile's last count.
- **9.7.0 shipped** (955a9397). Acceptance (`--acceptance=battles`): 192
  cases, 2 failed, the post-deploy timing pair again (both pass alone);
  catalogue refreshed, `battles_deck_upgrades#0` and `#notes` pass (1.2 s).
  Live read on a level-16 account: 0.9 s; the top single upgrades are the
  low cards of the set's weakest deck (counted twice); `within_reach` is
  empty at `max_levels` 2 and names decks needing 19-37 levels at 6.
- 9.7.1: read back through a clan's Discord agent, the answer named cards
  but not the deck each lifts (only `set_after` said so) and read
  `decks_affected` as "helps 210 decks". Each option now carries `lifts`;
  `decks_affected` is described.
- **9.7.1 shipped** (620026c2). Acceptance (`--acceptance=battles`): 197
  cases, 2 failed, the same timing pair (`battles_trends#1` a cold
  query_timeout this time); both pass alone. Read back through the clan
  agent's ask lane with the routine line (elixir-mcp-discord f1872fd): each
  card, its levels, the deck it lifts, the one that reshuffles the set, no
  values.

## 2026-09-26 — war decks as eight cards, duels included (9.8.0)

Jamie's own agent filed #363 and #364 at 04:20Z and 04:24Z, probing the
deck tools as King Thing; an overnight review (Jamie: "spend as much time
as you want until 6am testing... and attending to any code hygiene
issues") found more in the same code.

- **The finding under #363.** A live battle log (2026-09-26): every
  `riverRacePvP` and `riverRaceDuel` entry had `supportCards: []`, every
  Trophy Road entry a tower troop. deck_hash carries the tower troop, so
  the same eight cards were a ladder identity and a separate war identity
  and battles_deck_sets never pooled a deck's war record with its ladder
  record (it claimed to pool "all three modes"). Duels have no deck_hash
  at all, so a war deck played only in duels was invisible: the tool
  told King Thing to find a fourth deck he had.
- **The fix, no migration.** Candidates are card sets
  (`deck-sets-data.mjs` `seasonCardSets`): gated per variant on the three
  competitive modes (the `'all'` row counted casual play), then every
  variant's record pooled (the tower-less hash and one per tower troop in
  the catalog, looked up by primary key); the player's own games per card
  set, 1v1 decks and each duel round with its result from
  `battle_participant_round` crowns. Rendering from the cards themselves
  (`cardSetIdentities`), since a duel-only deck has no deck row.
- **#364.** Contradictions refused up front (require and exclude, a
  required card not held, locked decks sharing cards named in full);
  `packSets` settles a required card no candidate holds before searching
  (the timeout); `locked_decks` echoed with fit; `partial_set` and
  `one_card_short` instead of a dead end; `fieldable` true with
  `exact_form` for a substituted form; tower troops are not checked
  because Clan Wars carries none (answered on the item).
- **The review's finds, fixed here:** locked decks were left out of the
  set value (packSets `fixed`); a locked deck skipped the collection
  checks; the "omit fit_for" hint on a player with no collection; the
  upgrades ceiling ignored cards above the target, its pricing order was
  inverted, and its pool widened on the wrong condition; a future
  `member_away.until` was refused; `role_change_made` took the same role
  twice; `previous_player_tag` went unnormalised.
- **#363's `with_card` bug:** the card filters read round 0 only; they
  read every round now (`with_cards` within one round).
- **Not done (#363 in full):** other players' duel rounds in the corpus
  rollups (`deck_meta_season`), so the meta tools and `cards_card` count
  duel games. It needs the round deck identity stored at ingest (a
  column on `battle_participant_round`, round decks projected into
  `deck`/`deck_card`), a backfill op over every recorded duel and a
  rollup change: migration work for a day Jamie is around, not a night.
  `battles_cards` also still reads round 0 only.
- **9.8.0 shipped** (d6fd0560, with bd6aa1d3 the census manifest). Battles
  acceptance: the timing pair again, both pass alone; the elixir family:
  one real failure, gym 187.3, `elixir_docs {page: "battles"}` over the
  48,000-character cap with the new text. 9.8.1 moves the war-deck
  sections to their own page, `/docs/war-decks`.
- **9.8.1 shipped** (18bcda32): the elixir family 188 cases, 0 failed.
  Read back live: King Thing's first set is now his own four war decks,
  the duel-only Furnace/Skeleton Barrel deck among them (8 duel rounds, no
  deck row). Through the clan agent (dry run, his words): the four-deck
  answer is right; "a different last war deck" read his war decks from
  `battles_decks` rows, missed the duel deck and recommended it back to
  him. 9.9.0: `battles_decks.duel_decks`.
- 9.9.0/9.9.1 shipped (6a0b3f2a, 35a19425; 9.9.0's duel_decks pushed a
  30-deck page past the result cap, gym 151.3/152.3; 9.9.1 slimmed it and
  both pass). Replayed: the agent now knows the Furnace deck is played in
  duels, but a search free to choose any fourth chose the one he plays.
  9.10.0: `exclude_decks`; the ask routine says to exclude the current
  fourth.

## 2026-09-26 — Run: bounded acceptance transport

The daily read-only acceptance run passed its initial contract, identity and
budget cases, then one MCP request remained in flight for more than four
minutes. The runner had no transport deadline, so the read-only process was
stopped rather than left consuming a connection; it was not re-run to obtain a
green result. The public status, migrate `{stats}`, alarms, scheduled jobs,
RDS headroom, OAuth discovery and preview evidence were healthy at the time.

`acceptance/door.mjs` now uses a 20-second `AbortSignal` deadline, matching the
door's 18-second analytical budget; the failure becomes an ordinary acceptance
result instead of an unbounded operator process. `acceptance.test.mjs` pins a
stalled request. This is acceptance harness code only, so no production runtime
deploy is required. `npm run verify` passed before publication. The next daily
acceptance pass is the first live confirmation of the bounded failure path;
capacity and record-capture watches remain with their existing owners.

## 2026-09-26 — Keep the Boards: current collections, incomplete regional coverage

The authorized Keep the Boards run confirmed the global Path of Legends
snapshot at 10:07:54Z: exactly one receipt in the 10:00Z--10:15Z policy
window, 1,000 entries and `truncated: false` (`elixir-mcp-migrate`
`{stats:true}`, CloudEngineer identity). All four board-driven collections
were then synchronized and the post-sync read showed no additions or drops.

Regional coverage remains an objective gap: 172 of 262 enabled locations were
confirmed within 26 hours (90 stale), and 608 active recordings have
`origin = ranking`, above the approximately-400 alert line. The same stats
receipt reported eight `rankings_pol` 404s in the trailing 24 hours, but does
not identify the stale locations or prove causation. Preserve the daily
cadence, sticky retention and one global rate budget; Run Elixir MCP owns the
regional planner/collector/admission seam, while Keep the Boards retains the
ranking-presence watch. See `AGENT-TEAM/notes/2026-09-26-keep-the-boards.md`
for the complete receipt and collection movement.

## 2026-09-26 — Duel rounds are decks (0182, feedback #363), step one

Jamie approved the backfill for duel support. Each duel round now carries
its own deck and its own result: `battle_participant_round.deck_hash` (the
round's eight cards with no tower troop, the identity every Clan Wars
battle already has) and `outcome` (win, loss or draw by that round's crowns
against the other side's same round). Ingest writes both and puts each
round deck in `deck`/`deck_card`, named at once; the `{duel_round_decks}`
migrate op fills the rounds recorded before, from a cursor, then
`{vacuum}`. Nothing reads the columns yet: step two moves the season
rollups and the meta and card tools onto rounds (a round is one war deck
used), and `battles_deck_sets` drops its own merge of round decks so a
round is never counted twice.

## 2026-09-26 — Duel rounds are games in every meta count (9.11.0, #363), step two

The history fill ran live at 13:0x UTC: 23,290 rounds filled in two calls
(45 s, 30 s), none left null; `battle_participant_round` vacuumed. `deck`
grew by about 10k rows over the morning, round decks and ordinary ingest
together.

A duel now counts as its rounds wherever a deck or card is counted. One SQL
rule in contracts, `duelGamesSql`: a relation's rows pass through with
`round` 0, a duel's become one row per recorded round with that round's
`deck_hash` and `outcome`, and a duel with no recorded rounds stays whole
only where a breakdown counts it (`excluded.duels`). The rollup reads its
population through it (0183 adds `duel_rounds` to the deck, card, band and
totals tables, null until a season's rebuild); the live paths of
`battles_meta_decks`, `battles_meta_cards`, `cards_synergy`, `cards_card`,
`battles_cards` and the war-deck tools read the participant heap or the
population table through it, so the rollup-equals-raw test still holds.
No separate population table: `battle_participant_round` is 23k rows, so
joining it at read time costs nothing beside the 563k-row population.
`battles_deck_sets` no longer adds the player's own rounds to the war
record (the rollup has everyone's); `modes.war.your_duel_rounds` became
`modes.<mode>.duel_rounds`. `battles_decks` is unchanged. After the deploy:
rebuild 2026-09 and 2026-08 with `{meta_rollup_season}`.

**9.11.0's first acceptance (full suite): 1,188 cases, 13 failed. Verdicts:**

- 188.3, 200.1 (`considered` against `battles_query` and `battles_trends`)
  and 301.1: product answered wrong, fixed forward in 9.11.1. The first cut
  counted `considered` in games; it counts battles again (a duel once, in
  `excluded.duels`), decided counts games, and `duel_rounds` beside
  `decided_battles` says how many were rounds. `duelGamesSql` keeps every
  row at round 0 and adds the rounds, so one source serves both counts.
- 301.1 amended as well: decided games are `battles_decks`' battles with a
  deck plus the rounds (`sum_eq` takes a list total now).
- 154.1, 154.4, 207.1 (a season rollup against the raw window): the
  rollups predate the rounds until `{meta_rollup_season}` rebuilds 2026-08
  and 2026-09; re-run after.
- `budgets/meta-cards-corpus-week` (15.6 s) and `catalogue/battles_trends#1`:
  first calls after the deploy, 3.3-3.9 s alone.
- 337.1, 343.2 (live cases), `catalogue/cards_archetype#docs`,
  `elixir_timeline#docs`, `war_history#notes`: not this change's tools;
  re-run alone after the next deploy before a verdict.

**9.11.1's acceptance (full suite): 1,188 cases, 11 failed; the rollups
rebuilt during the run** (`{meta_rollup_season}`: 2026-08 in 40 s, 51,568
decided, equal to the raw window; 2026-09 in 86 s, 534,038 decided).
Verdicts, each re-run alone:

- nc.meta.reconcile, 190.3: amended for the decision (23f7beff), with the
  meta identity checks; pass.
- 285.1, 154.1, 154.4, 207.1, 188.3, 200.1, 301.1,
  `catalogue/battles_meta_cards#1`, the three catalogue docs/notes cases:
  pass alone (the rebuild was running under them).
- `budgets/meta-cards-corpus-week`, `catalogue/battles_trends#1`: the
  first call of every fresh acceptance process is 13-16 s in the door's
  own log line and the next is 3.2-3.6 s (13:50:28Z 16,269 ms, 13:50:32Z
  3,550 ms); `{profile_tool}` reads the corpus week in 3.0 s of database
  time. The first-call slowness is this morning's open item, not 9.11.
- 337.1 (#GRJ20LQP is no longer a recorded clan) and 343.2 (live board
  state): live cases whose world moved; `/gym` re-seeds them.

Open: round order as deck slot (#363 item 4) is unverified; nothing names
"deck 1-4".

## 2026-09-26 — `battles_decks` pages and lightens (9.12.0)

Jamie agreed to the recommendation for the deck list near the cap (King
Thing's whole history at limit 30 was about 47,000 characters): light rows
(`card_names`, `archetype_label`, `tower_troop_name`) with the card objects,
tower troop and archetype on the single-deck read (`deck_hash`), and paging
(`offset`, `total_decks`, `next_offset`). The list was also cut at the 100
most-played decks before sorting, so `sort: win_rate` ranked only those; it
now sorts and pages every deck. `duel_decks` reads the rounds' own
`deck_hash` and result (0182) instead of re-hashing the round cards.
`verbosity: compact` drops `modes` and the level detail; `battles_decks` is
no longer a one-size tool, so the one-size tests use `battles_cards` and
`battles_opponents`.

**9.12.0 shipped** (e7f6fb15). Acceptance (`--acceptance=battles`): 197
cases, 3 failed; every `battles_decks` case passed. King Thing's list at
limit 30 is 25.9 KB (was about 47 KB); his whole history, limit 100, 34.4 KB.
Verdicts:

- `budgets/meta-cards-corpus-week`, `catalogue/battles_meta_cards#1`: cold
  reads, not the query. `{profile_tool}` ran it at 15.4 s and at 2.9 s one
  call later. 0182's fill had left `deck` 39% all-visible (`deck_card`
  92%, `meta_season_pop` 83% after the rebuilds), so the meta readers'
  index-only probes went to the heap. The vacuum op now takes `deck`,
  `deck_card` and `meta_season_pop` (878a8cc8); all three vacuumed to 100%;
  both cases pass alone (13.7 s cold, 3.4 s warm; 3.3 s).
- `catalogue/battles_trends#1`: a `query_timeout` alone. `battles_trends`
  has not changed since 9.1.0; this morning's open first-call item, still
  open.

## 2026-09-26 — Collector follow-ups: Go only, signed naming, the `poll` block gone

The collector is Go only, signed and able to roll itself back
(elixir-mcp-collector v3.0.1, PRs #8-#12). Before touching the door, the
fleet was read from `/api/public/status`: at 18:16Z Skeleton Army and
Cannon still reported v2.0.30 (below v2.0.31, so they still read
`poll.idle_backoff_s` and would have waited 0 s after a refusal naming no
`next_check_in_s`); by 18:46Z all five active collectors reported v3.0.0
or later (Hog Rider is draining). Only then:

- **`poll` removed from `CONFIG`** (collector-door.mjs) with its comment
  and the test that pinned it. Jamie: restoring it on 2026-09-12
  (21ccc5f8) for a stale Python collector was the wrong fix; the client
  should have been updated. `packages/contracts` never declared `poll`,
  so there is no contract bump.
- **Python references removed**: the 426 hint points a leftover Python
  collector at the Go installer; `parseClientVersion` keeps reading
  `py-` on purpose (an unreadable version is let through, a readable one
  is what the gate can refuse).
- **Naming verifies what collectors verify** (`name-collector-release.mjs`):
  refuses a release with no `SHA256SUMS.sig`, verifies it with
  `ssh-keygen -Y verify` against the release key (fingerprint checked
  against the line first), requires the VERSION line for the tag and the
  exact release-download url per asset. Dry runs: v3.0.1 and v2.0.30
  (already signed by sign-release) pass; v2.0.29 is refused for no
  signature; a wrong key and a wrong fingerprint are both refused.
  `{collector_release}` checks url shape, 64-hex sha256 and `vX.Y.Z`
  before connecting (new `ops-collectors.test.mjs`).
- **RELEASING-COLLECTOR.md rewritten for v3**; the release key is on
  /docs/operators; DECISIONS gained four lines.

`min_client_version` stays 2.0.30 (raising it retires the pre-signing
rollback lever; Jamie's call). No release was named.

## 2026-09-26 — Collectors show a signed badge and the release key's randomart (0184)

Jamie asked for the Collectors pages to show that each collector runs a
signed release, with "some cool fingerprint thing". From collector v3.0.4
(PR #14), every door call carries `x-collector-binary-sha256` and
`x-collector-release-key` beside `x-collector-version`.

- **Recorded at the door, not at ingest.** The version reaches the pages
  through `last_seen_sha`, which ingest stamps on submit. The door's
  `authGateway` update, which already stamps the heartbeat on every call,
  now stamps the version (coalesced, as ingest does) and the hash and key
  report (exactly as sent, null when absent) together, so the first call
  after a self-update never compares a new binary with the old version.
- **0184**: `gateway.binary_sha256` and `release_key_fingerprints`;
  `collector_release_history` (platform, version) of every named release,
  seeded from `collector_release`, written by `{collector_release}`
  beside the current row. Hashes named before today were never kept.
- **The state** (`services/web-api/src/collector-signature.mjs`): the
  collector reports no platform, and needs none, since each platform's
  binary has its own hash: `signed` when the hash is any named hash for
  its version; `dev_build`, `unverified`, `mismatch`. Public status carries
  the state only; Admin carries the hash and key report too.
- **Pages**: a badge beside the version on Status → Collectors (an icon
  beside the name under 560 px, where the version column is behind the
  table's scroll), a Release column and a red alert naming any mismatch in
  Admin → Collectors, the record page's badge and hash rows, and a card
  with the release key's randomart computed in the browser from
  `COLLECTOR_RELEASE_KEYS` (packages/contracts, now the one copy the
  naming script also reads; a test holds operators.md to it). The
  randomart test runs `ssh-keygen -lv` on the release key and twelve
  fresh keys and compares character for character.
- The console has no light theme (tokens are dark only); the card and
  badge use tokens only, so they follow one if it arrives.

No release was named and `min_client_version` is unchanged.

**Follow-up, same evening: every collector read unverified after the
0184 deploy.** CloudFront's `SiteApiOriginRequestPolicy` forwards a
header whitelist, and it listed `x-collector-version` but not the two new
headers, so the door never saw them; the door tests call the handler
directly and could not notice. Both are on the whitelist now (nine of
CloudFront's ten), and `collector-edge.test.mjs` fails when the door reads
an `x-collector-*` header the edge does not forward.

## 2026-09-26 — main takes only pull requests; deploys take only green main

Jamie: "we have outgrown our cowboy commit to main and push workflow."
Measured first (`gh run list -w validate -L 200`, 2026-09-23 23:16Z to
09-26 19:41Z): 412 commits to main in seven days, every one by an agent;
200 CI runs, 9 red. Six of the red were flakes and three were real
breaks that a follow-up commit repaired (the acceptance bites
`gym/111.1` twice and `gym/244.2`, `248.1`, `248.2` once). CI finished
about 3.5 minutes after a push, and `deploy.mjs` checked only for a
dirty tree, so deploys ran ahead of CI and could ship an unpushed HEAD.
The site build and the Playwright journeys run only in CI, so no deploy
ever waited on them.

- **The ruleset on main**: a pull request is required (zero approvals), the
  `validate` check must be green on a branch up to date with main, history is
  linear, force pushes and deletion are blocked, and there is no bypass. Merges
  are rebase-only with auto-merge on, and merged branches are deleted. The
  agents push as Jamie's account, so a bypass for admins would be a bypass for
  every agent.
- **CI**: the job is named `validate`. That name is the required check
  and the gate's lookup, so renaming it means changing both. A new push
  to a PR cancels that PR's running check. There is no docs-only fast
  path: the whole job takes about 2.5 minutes (verify 81 s).
- **The deploy gate** (`infra/scripts/lib/ci-gate.mjs`): HEAD must be
  `origin/main`, and `validate` must be green on HEAD or on the merged
  PR's head with the same tree, which up-to-date plus rebase guarantees.
  A check that is still running is waited for, up to 15 minutes.
  `--break-glass` skips the gate for a GitHub outage and nothing else.
- **The loop**: the `ship` skill's new Merge step. It runs in one checkout
  under one lease, from branch to merge to deploy. Preflight already
  refuses a checkout left on a branch.
- **Flakes fixed first**, because a required check turns each one into a
  blocked merge:
  - The meta-rollup `repeat_players` and duel tests failed four times.
    The hourly test stamped `created_at = Date.now() + 1 s`, and later
    rebuilds are bounded by the database clock, so a slow runner counted
    those rows and a fast one did not. They are now stamped 1 ms past the
    cursor, which is always in the past.
  - The admin integrations journey failed twice, and that was a real
    console race. TanStack joins an in-flight fetch on a query that has
    no data yet (query-core 5.102.8 `query.js:157`), so a write landing
    before the first list read answered showed the list without the new
    row. `useInvalidate` now cancels the in-flight reads before
    invalidating, which covers all 23 call sites, and
    `test/invalidate.test.jsx` fails without the fix.
  - `players_summary` was already fixed by a188fa48.
- **Watch**: the first scheduled Codex run after rollout has to open and merge
  a PR with `gh` from its sandbox. If it cannot, that run's lease abort names
  the blocked step.

**Rolled out, same afternoon.** The four commits (acb9c160..b595c13f) were
the last direct push. `validate` went green on b595c13f, and deploy.mjs
passed its own gate on it ("validate green on main"). It deployed at 20:12Z
(3:12 PM CT) with no migrations and a clean smoke; no tool changed, so
acceptance was not run. The live app shell serves `index-BPWROorX.js` with
the `useInvalidate` fix. The repo allows only rebase merges now, with
auto-merge, update-branch and delete-on-merge on. Ruleset 24050992
("main: pull requests on a green validate") is active with no bypass. Its
required check is pinned to the GitHub Actions app (integration 15368), so
a status from anywhere else cannot satisfy it. This entry is the first
change to reach main through a PR, after a direct push to main was refused.

## 2026-09-26 - Dependabot dev-toolchain group (PR #51) deployed

PR #51 bumped 18 packages, all patch or minor: the AWS SDK clients
(3.1126/3.1133 to 3.1137), knip, oxlint, prettier, marked, jsdom,
lucide, TanStack Query 5.103.2 and Router 1.170.38, vitest 5.0.1 and
`@types/node`. It was rebased onto main (`gh pr update-branch --rebase`)
and merged on a green `validate` as 96955a28. Deployed at 00:37Z on
2026-09-27 (7:37 PM CT on 2026-09-26) with 0 migrations run and a clean
smoke. No tool changed, so acceptance was not run. `/api/public/status`
reports `health.ok` true. The deploy's vocabulary import moved the
card-roles snapshot's `source_commit` to aada797, which this PR commits.

## 2026-09-27 - Guard the Door: bounded relay failure logs (PR #56) deployed

The weekly boundary sweep found that the email relay's best-effort failure
logs could emit untrusted transport error text, which may contain recipient or
message-body data. A regression captured that leak across the owner,
Buttondown, outbox-delete, and retry paths; the relay now records only bounded
error classes. `npm run verify` and PR #56's `validate` passed; it merged as
76f68c6d and deployed with zero migrations and a clean public smoke. The
post-deploy public status was healthy (zero DLQ messages; five active signed
collectors; one 1 rps, 3,600/hour global budget with its 10% live reserve),
and invalid MCP and JSON API Bearers remained 401 without cookies. No tool
changed, so tool-family acceptance was not run; no production email was sent.

## 2026-09-27 - Verify: Trophy Road only

Jamie: the deck used to verify a player must come from a Trophy Road
battle; it could come from a mode that assigns the player a deck. Both
halves now use the `ladder` mode group (`PvP`, no event tag), the one
definition the tools and rollups share: the target's base is the
most-played deck in the last ten Trophy Road battles (the last-month
rejection set still spans every mode), and only a Trophy Road battle
after the brief is proof. The poll serves `last_battle.trophy_road`, and
the wizard says "Not Trophy Road, so it does not count" of any other
battle. Path of Legends, which the brief used to suggest, no longer
counts. Console and web-api only: no MCP contract or JSON API change.
PR #58 merged on a green `validate` as 952e2786 and deployed at 16:22Z
(11:22 AM CT) with 0 migrations run and a clean smoke; acceptance was not
run because no tool changed. `/api/public/status` reports `health.ok`
true and `/docs/verify/` serves the Trophy Road copy.

## 2026-09-27 - Verify: the proof is any mode again

Jamie corrected the change above: the target should be a deck the player
plays on Trophy Road, but the proving battle may be in any mode. The draw
keeps the `ladder` restriction; the proof is back to any battle after the
brief with exactly the target, and `last_battle.trophy_road` and the
wizard's "Not Trophy Road" line are gone. The brief now says any mode
counts (it used to say "Any 1v1"). PR #60 merged on a green `validate`
as 5c705e2c and deployed at 17:34Z (12:34 PM CT) with 0 migrations run
and a clean smoke; no tool changed, so acceptance was not run.
`/api/public/status` reports `health.ok` true.

## 2026-09-27 - Architecture, efficiency, durability and features review (analysis only)

Jamie asked for a review of the whole service for architectural,
efficiency and durability improvements and for features that would
materially improve it. It is written up as
`docs/reviews/2026-09-27-ARCHITECTURE-DURABILITY-FEATURES.md`. Ten
dimension reviewers each had an adversarial verifier, and a
completeness critic added three gap areas. 93 findings were raised and
91 survived (47 only in part). One conflicted with DECISIONS 41 and was
dropped; one restated a standing position. Nothing in product code
changed and nothing was deployed.

The five findings that change the picture:

- Every copy of the record sits in one account and one region, and the
  restore path is untested.
- Background SQL is unbounded and unnamed. This is the 09-15 and 09-18
  mechanism.
- The global budget is charged only at plan time, and its ceiling is
  about 3,600 recorded players.
- The open-beta preconditions have no owner: privacy.md's promises, the
  brief cut at 2,048 characters in Claude Code, and mail past 900 s.
- Owed work is lost in the NOTES rotation.

Six door and auth-plane findings (one high) went to Jamie directly and
are not described in the public file. Needs Jamie: the thirteen calls
in the review's §9.3. The fix bundles in §9.1 need no decision.

## 2026-09-27 - The review, sorted into lanes; database restore set aside

Jamie read the review and set one part aside: "The one thing I'm not
worried about is restoring the database. … We're running in AWS. I'm very
comfortable with its resilience." That removes:

- the database half of the review's §2.1 (an off-account snapshot copy);
- all of §2.2 (restore runbook, rehearsal, `--stack-only`, longer
  retention, Multi-AZ);
- all of §2.3 (the replay-parity proof).

The line is in DECISIONS under "Declined". Off-account replication of
the archive (`payloads/`) is a separate, account-level question. It is
held in lane C, not declined.

A first plan cut the rest into 23 subsystem chunks. Jamie found it mixed
three kinds of work, so it was re-sorted by who has to decide
(`docs/reviews/2026-09-27-EXECUTION-BRIEF.md`):

- **Lane A: fix and harden** (41 findings) is filed as issues #62-#73,
  with the older bugs #44 and #43 joining the same `review-2026-09-27`
  queue. The queue runs one issue per interactive session, or
  unattended through one orchestrator session that hands each issue to
  a fresh subagent. Blocked issues get the `needs-jamie` label and the
  loop moves on; a failed deploy stops it. An issue closes only when its
  fix is deployed and read back. #62 (door hardening) carries no mechanics; the details
  are Jamie's private notes.
- **Lanes B (features), C (policy) and D (parked)** are held in the
  brief, not filed. When the label has no open issue, Jamie and Claude
  revisit them, starting with B.

Jamie noted that he has not reviewed the policy text in `privacy.md`.
Lane C starts there.

Also recorded: #48 (RDS recovery rehearsal) closes as not planned under
the restore decision, in the queue's first session. #46 (historical clan
roles) waits for the lane B revisit. The relay logging item in the
review's §8.1 was already fixed by Guard the Door (PR #56, `76f68c6`).

## 2026-09-27 - Door hardening (review §6.5, #62): shipped

Contract 9.12.1, JSON API 2.6.1, migration 0185; PR #75, deployed from
`9d88c477` with `--acceptance=elixir` (188 cases, 0 failed, 12 skipped).
The six findings were kept out of the repo until this deploy; they were:

1. **First-party was inferred from redirect URIs, and registration is
   open.** A client registered to a family origin was unmetered on
   `/api/v1` and could ask for `account:email` and `clans:attest`; a
   person who approved it handed those over. Now a first-party client is
   one in `family_oauth_client` (0185; the `family_clients` op) with every
   redirect on a family origin, registration refuses family redirects,
   and Clan and Drop are confidential clients (`client_secret_post`,
   secrets minted on their hosts, Elixir holds only the sha256). Both
   sent the secret on the read-back, and `require_secret` is set for
   both: a token request under their ids without it is 401.
2. **The consent page showed only the self-chosen client name.** It now
   shows the host the code goes to, and says "one of Elixir's own apps"
   for a provisioned client; a name beginning with Elixir or POAP KINGS
   (folded: NFKC, case, punctuation) is refused at registration.
   `POST /oauth/revoke` (RFC 7009) is new.
3. **IP limits keyed on the CloudFront edge node** (`sourceIp`), so
   strangers shared buckets, and the fail-closed registration cap (200 a
   day) was one caller away from refusing every new connection. Limits now
   key on `viewerIp()` (`cloudfront-viewer-address`); registration is 20
   an hour per caller with a 5,000 a day backstop; OAuth consent mail
   shares the site's 5-an-hour-per-address bucket.
4. **Any garbage Bearer wrote a `credential_refusal` row.** Only a
   refusal naming a real key or account is stored now; the log line
   still counts the rest.
5. **An attested-fact overwrite was checked against the new fact only**,
   so an elder could replace a leader's message by ref, and a member could
   repoint someone's away. The ref is now locked and the writer must be
   allowed the stored fact too.
6. **Leaders-only facts (`member_away`) checked only the person kind**, so
   a service key bound to a leader's account read them, and Admin could
   mint such keys. Leaders-only facts now need an interactive credential
   (session or the person's own OAuth grant), and Admin's mint answers
   410 `mint_moved` (existing keys still work and revoke there).

Read-back (19:48 UTC, 14:48 Central): Jamie's account signed in to Clan
by code and to Drop by session through the new consent pages, both
reading `/api/v1` (Clan `/api/me` 200 with the roster; Drop profile),
then signed out of all three. Garbage Bearers are 401 at `/mcp` and
`/api/v1`; a family redirect at `/oauth/register` is 400.

Open: the audit (`family_clients {list}`) found one registered client
named "Elixir Clan" from 2026-09-12, with a clan redirect plus a
CloudFront fallback, so never first-party, and no live grants. Revoking it
waits for Jamie. The committed acceptance bite
`317-2-elixir_timeline.json` (account-section items) is #66's.

## 2026-09-27 — #63 (A2): every database backend bounded and named (contract 9.12.2, JSON API 2.6.2)

Review §3.1-3.3. Three incidents (0099's 35-minute lock, the 09-15 read
queue behind a migration, the orphaned `battle_participant` backfill) had
one cause: a query outlives the Lambda that sent it, because ending the
client does not cancel it, and nothing on the server bounded it.

- **Connection ceilings (template).** Each database function sets
  `PGAPPNAME=elixir-mcp-<function>` and `PGOPTIONS` with
  `statement_timeout` just under its Lambda kill (web-api 18 s of 20,
  mcp 23 of 25, scheduler 45 of 50, migrate 285 of 300) and
  `idle_in_transaction_session_timeout=60s`. jobs is 300 s of 900: the
  longest jobs statement in 29 days of logs was the cards aggregate at
  108 s (09-22); the retired `pop` statement was 227 s (09-19). The
  invoker's per-call `set_config` still overrides the ceiling inside a
  tool (a scratch-DB test pins it). A pinned template test keeps every
  function named and its ceiling under its timeout.
- **0186** sets `client_connection_check_interval = 10s` on the
  database, so a backend notices a vanished client between checks.
  Best-effort: it needs a socket the kernel has closed.
- **Reads wait at most 5 s for a lock** (`lock_timeout` on the budgeted
  read path only; writes carry none) and answer `query_timeout`.
- **Explore and `/api/v1` race the request deadline** (`deadline.mjs`),
  so `clans_participation` and the other unbudgeted reads there answer
  `query_timeout` instead of a 504. Not added to `BUDGETED_TOOLS`: the
  deadline now covers it on all three doors, and the budget would only
  add `work_mem`; measure first.
- **`packSets`** stops at a 4 s time budget as well as its node budget
  (a 1,500-deck pool over 32 cards ran 4.3 s inside its node budget).
- **`{terminate_backends}`** refuses `true`, a missing `like` and a
  wildcard-only pattern (`named_query_required`), floors at 300 s and can
  narrow by `application_name`. **`{backends}`** groups by application
  and names its own connection (`elixir-mcp-migrate:backends`).
- **`{oauth_grants}` revoke** writes its UPDATE and account event in one
  transaction; it and `{collection}` gained tests.

**Shipped** (#77, 750fa9b5; deployed 20:42Z (3:42 PM CT), 0186 ran).
Acceptance (full suite): 1,188 cases, 11 failed. Verdicts:

- 217.2, 285.1: counts moved between calls under live ingest; pass alone.
- `catalogue/cards_archetype#docs`, `elixir_timeline#docs`,
  `war_history#notes`: rare fields absent from this run; pass alone.
- `catalogue/battles_trends#1`: 10.5 s, 10.0 s alone, the first call of
  a fresh acceptance process: the open first-call item from 09-26, not a
  `query_timeout` and not this change.
- 337.1 (#GRJ20LQP no longer recorded), 343.2 (live board state): live
  cases whose world moved, as at 9.11.1; `/gym` re-seeds them.
- 289.3: live case; King Thing's account turned 365 days today and now
  carries `YearsPlayed` level 1 (progress 365), so the "no YearsPlayed
  badge" note correctly no longer fires. `/gym` re-seeds it.
- `identities/implies:a-regular-week-at-the-line-finished-early` and
  `…:no-finish,-no-finish-day`: season 136 week 2 is in progress and POAP
  KINGS crossed the line at 09:38Z today, so `our_fame` 10,305 and
  `finish_war_day` 3 sit beside `finished_early: null` (null while in
  progress, by its note). First in-progress finish since the identities
  were written; `war_history` is untouched here. For Keep the Record True:
  either `finished_early` turns true once the line is crossed, or the two
  identities skip `in_progress` weeks. They clear on their own when the
  week closes Monday about 09:30Z.

Read-back (20:58-21:01Z, 3:58-4:01 PM CT): `/api/public/status`
`ok: true`; the five functions carry their `PGAPPNAME` and `PGOPTIONS`;
`{backends}` answers `as: elixir-mcp-migrate:backends` and grouped a live
MCP query under `elixir-mcp-mcp` (the doors connect per request, so most
reads show none); `{"terminate_backends": true}` answers
`named_query_required`; `elixir_changelog` since 9.12.1 answers 9.12.2.

Pending: the next nightly jobs run under the 300 s ceiling (the meta
rollup's longest statement was 108 s), and a week with no orphaned
backend in `{backends}`.

## 2026-09-27 - #64 (A3): the one global budget, enforced in code (contract 9.12.3, JSON API 2.6.3)

Review §4.1 and §4.2. The bucket was only half a budget: the tick
decremented tokens for every row it PLANNED, including subjects already
queued (so it overcharged while a queue stood), and nothing that minted
live work charged it at all (the live lane, `/api/v1` profile refreshes,
and deck-cards' raw insert of a newly seen card). And planning ignored
queued bulk, so a fleet outage stacked a tick's allowance on top of the
queue every five minutes.

- The tick reads the bucket without a lock (the MCP invoker's 5 s
  `lock_timeout` must never wait behind a planning tick), plans against
  `min(tokens, capacity - queued bulk)` of the bulk share, then charges
  only the rows `enqueueJob` reported `inserted`, with one relative
  update at the end (`chargeBudget`).
- Every new live row takes a token atomically (`takeLiveToken`: `update
  budget_state set tokens = tokens - 1 where tokens >= 1`). None left:
  nothing is queued, nothing is charged (the per-account live quota
  included), and the caller hears `retry_after_s` at the next tick. MCP
  keeps its `pending` shape with a different note; `/api/v1` answers the
  existing 429 `rate_limited` with Retry-After, rolled back whole.
  deck-cards goes through `enqueueJob` now and skips the stub read when
  the bucket is dry; the daily catalog read heals it.
- `budget_charge` (0187) records charges by hour and lane.
  `/api/public/status` `budget` drops `expected_hour` and
  `hour_started_at`; the headline is `fetches_24h` against
  `bulk_capacity_24h` (77,760 at 1/s with the 10% reserve) as
  `share_24h`, with `used_hour` a rolling 60 minutes and `charged_24h`
  by lane. Admin usage `capacity_24h` is the same 77,760. The console
  gauge and `/data/now` lead with it.
- The plan test simulates a two-hour dark fleet: queued plus planned
  never passes the bulk cap, and the first hour of recovery hands out no
  more than the bucket's cap plus an hour's refill. It fails without the
  queued term.

No acceptance: the live lane is excluded from the acceptance suite, and
nothing in a tool's declared shape changed. The ship is smoke plus a
status read-back one tick after the deploy (`charged_24h.bulk` above 0).

Shipped in PR #79 (3c50c4a6), deployed 21:28-21:32Z (4:28-4:32 PM CT)
with smoke only (40 ok, 0 failed); migrate ran 1 (0187). Read-back
21:32:59Z (4:32 PM CT), one tick after the stack flip: `/api/public/status`
`ok: true`; `budget` carries `fetches_24h` 25,623 of `bulk_capacity_24h`
77,760 (`share_24h` 0.33), `used_hour` 1,121 of 3,600, `tokens` 251, and
`charged_24h` `{bulk: 71, live: 0}` from the 21:32:37Z tick;
`expected_hour` is gone; `next_tick_capacity` 226 with 21 queued.
`elixir_changelog` since 9.12.2 answers 9.12.3.

Pending: the first natural live mint showing in `charged_24h.live`
(never manufactured), and a day of `charged_24h.bulk` tracking the
receipts.

## 2026-09-27 - #65 (A4): the whole brief, and spec-shaped error results (contract 9.12.4)

Review §6.1-6.2. All five parts re-verified against `a3ee3d3a`; the line
references held (the query-budget assertion had moved to ~386).

- **The brief fits 2,048 characters** (`INSTRUCTIONS_BUDGET` in
  `protocol.mjs`), ordered identity, one-line rules, START, feedback,
  one manual pointer (`protocol#argument-conventions`), disclaimer. The
  window-source grammar, verbosity, freshness and the `live` detail moved
  behind the pointer; the brief no longer restates them. Identity renders
  in full while the whole brief fits and compact otherwise: the primary
  and "your clan" (an agent: its clan and leader), the rest counted
  ("You also track 13 more players (2 alts, 2 friends, 9 you watch) and 2
  more clans: elixir_my_players lists them"). The review said the full
  list "already rides `_meta`"; it does not (the principal block carries
  kind, subject and clan), so the count points at `elixir_my_players`.
  `brief-budget.test.mjs` renders 50-player/10-clan person and agent
  identities at the 15-character name limit and holds the whole brief,
  disclaimer included, to 2,048 (person ~1,820, agent ~1,985).
- **Person schemas drop `on_behalf_of` and `display_name`** (and
  `segment.on_behalf_of`); `registry.invoke` drops them silently for a
  person before validation, like the one-size `verbosity`. Agent and
  integration surfaces and the whole catalogue (`/docs/tools`,
  `tools.json`) keep them. The person fingerprint moves.
- **No `structuredContent` on `isError`.** Checked first: the Discord
  agent (`src/mcp.js` `callTool`) and the retired elixir-bot parse
  `content[0].text`; the boards client throws on `isError` before reading
  structured content; the acceptance door falls back to the text.
- **`MCP-Protocol-Version`** is validated after `initialize` (absent =
  2025-03-26; unsupported = HTTP 400, -32600, `data.supported`). The MCP
  door's origin policy already forwards the header.
- **Unknown-argument hint** names the contract version and says to
  reconnect.

Contract 9.12.4 (patch: behaviour correction; the person output of
`tools/list` changes, the declarations' shapes do not). JSON API
unchanged. Ship: `--acceptance` (shared protocol code).

Shipped in PR #81 (cd687455), deployed 21:55-22:10Z (4:55-5:10 PM CT)
with `--acceptance`; smoke green, migrate ran 0. Acceptance (full suite):
1,188 cases, 11 failed, the same set #63 triaged at 9.12.2, none touching
this change (the suite's token is an agent's, whose schemas did not move;
its door reads the text block when `structuredContent` is absent):

- `catalogue/cards_archetype#docs`, `elixir_timeline#docs`,
  `war_history#notes`: rare fields absent from this run; pass alone.
- `catalogue/badges_rarity#1` 4,318 ms against 4,000: 1,018 ms re-run
  after a warm-up call.
- `catalogue/battles_trends#1` 12.6 s (11.2 s re-run) and
  `catalogue/battles_meta_cards#1` 15.2 s against 15.0 s (15.7 s re-run):
  the open slow-seed item (10.5 s at 9.12.2, 13-16 s at 9.11.1), not
  this change.
- 289.3, 337.1, 343.2: live cases whose world moved, as at 9.12.2; `/gym`
  re-seeds them.
- The two `identities/implies` finish cases: season 136 week 2 still in
  progress past the line, as at 9.12.2; they clear when the week closes
  Monday about 09:30Z.

Read-back 22:22Z (5:22 PM CT), reads only: `/api/public/status` `ok:
true`. On the acceptance agent's door: `serverInfo.version`
`9.12.4+tools.8eb638847d89`, the agent brief 1,938 characters with every
key sentence inside 2,048; `game_clock` with an unknown argument answers
`isError` with no `structuredContent` and the contract-9.12.4 reconnect
hint; a success still carries `structuredContent`; a `ping` with
`MCP-Protocol-Version: 2099-01-01` is HTTP 400, -32600, `supported`
listed; `elixir_changelog` since 9.12.3 answers 9.12.4. `/tools.json`
says 9.12.4 and `/updates` lists the entry. A real Claude Code session
(`claude -p`, Jamie's personal `elixir-mcp` connection) quoted the whole
person brief back, disclaimer last: his full identity (13 players, 2
more clans) still fits, so it is named, not counted.

Pending: none needing a natural event.

## 2026-09-27 - #66 (A5): captures and the public repo match the privacy page

Review §6.4 and §6.8, lane A; privacy.md itself untouched (lane C).

- **Capture retention.** The archive bucket is versioned, so
  `calls-expire` only wrote a delete marker at 90 days and the
  bucket-wide `expire-superseded-versions` kept the body another 365
  (about 455 days against the published 90). New `calls/` rule
  `calls-purge-expired`: `NoncurrentVersionExpiration: 1` and
  `ExpiredObjectDeleteMarker` (that flag cannot share a rule with
  `ExpirationInDays`). Payload versions keep their year.
- **Bites.** `acceptance/bites/fetch.mjs` reduces every `attested` or
  `account` item to `{kind, section, at, subject_tag}`
  (`acceptance/bites/private.mjs`); `acceptance/bites.test.mjs` fails on
  a committed bite holding more. `317-2-elixir_timeline.json` held nine
  `account_feedback_responded` items with their facts; now stubs (gym
  317.2 still bites). Git history keeps the old copy: feedback ids and
  statuses of the Gym's own account, nothing about a person.
- **Tracking mail.** `build-tracking` passes its `MOMENT_KINDS` filter
  into `buildTimeline`, so the 150-item cap is spent on moments and no
  attested item enters the mail path. `services/jobs/test/tracking.test.mjs`
  (a leader recipient, 160 clan messages newer than their career-wins
  moment) failed before: the moment was cut. `services/mcp/test/attested-readers.test.mjs`
  lets only `entries.mjs` and `attested-facts.mjs` name `attested_fact`
  in runtime code.
- **Skills.** Gym and ops: attested facts are counted, never quoted into
  NOTES or the repo.

No MCP contract or JSON API change. Ship: stack and jobs only, no
acceptance (nothing a tool serves changed); smoke.

Shipped in PR #83 (56608399..cc41c5cf), deployed with no acceptance
(nothing a tool serves changed); migrate ran 0 of 187, stack
UPDATE_COMPLETE, smoke green. `elixir-mcp-jobs` LastModified 22:38:54Z
(5:38 PM CT).

Read-back 22:40Z (5:40 PM CT), reads only: `/api/public/status`
`health.ok: true`; `GetBucketLifecycleConfiguration` on the archive
bucket lists `calls-purge-expired` (`calls/`, NoncurrentDays 1,
ExpiredObjectDeleteMarker) beside `calls-expire` (90 days), and
`expire-superseded-versions` still 365 for the rest; `/updates` shows
the entry. `ListObjectVersions` on `calls/dt=2026-06-27/`,
`2026-06-19/` and `2026-05-30/` is empty, but vacuously: the oldest
capture prefix is `calls/dt=2026-09-10/`, so no capture has reached 90
days yet.

Pending (a natural event): the first captures expire about 2026-12-09.
From about 2026-12-11, `ListObjectVersions` on `calls/dt=2026-09-10/`
should return no versions and no delete markers.

Flake filed (ship skill: a flake is a defect): PR #84's first `validate`
(run 36356099206, notes-only) failed
`query-budget.test.mjs` "the deadline covers work outside the database,
such as a live-lane wait": the invoke took 650 ms against the test's
500 ms bound, with a 100 ms deadline and a 600 ms fake tool. Locally it
answers in 106-107 ms (five runs green); the same test passed on #83's
run. 650 is close to the fake tool's 600 ms, so either a starved runner
delayed the deadline timer or, on that runner, the answer waited for
the abandoned work. Not fixed here (out of #66's scope); owner: the next
`query-budget` change, which should log the elapsed time on failure and
check whether the error path awaits the abandoned promise.

## 2026-09-27 - #67 (A6): product-mail send bugs

Review §6.7, lane A. Every `path:line` in the issue re-verified against
`d5dc74b8`: all four held (`index.mjs` 135-193, 160, 231-238; `ctx.mjs`
21-31; `ledger.mjs` 21-23; `build-clan.mjs` 16-20, 209-211).

- **Ledger before compose.** One `email_issue`/`email_send` query per
  run drops who already has the period's mail (per account, per clan,
  per written issue) before anything is composed; a clan issue some
  trackers have is sent as stored. The `{email: ...}` log line now
  carries `already_sent`, `remaining`, `incomplete` and `ms`. With 90 s
  left the run stops taking recipients and the handler throws
  `email_run_incomplete`, so the async retry resumes from the ledger and
  `elixir-mcp-jobs-errors` fires. `JobsInvokeConfig`
  (`AWS::Lambda::EventInvokeConfig`, $0): `MaximumEventAgeInSeconds`
  3600, `MaximumRetryAttempts` 2, for every async jobs event.
- **Milestone period** is `<UTC date>.<hash of the moments>`, so a
  second moment the same day is a second mail (it had waited for
  midnight); links and the pixel keep the date as the campaign period.
- **Written kinds** send only the issue for their period (today's date
  for `top_100`, `lastGameWeek(now).key` for `card_of_week`); with none
  accepted, nothing sends and the owner gets one `owner_notify`. The
  send no longer upserts the issue, so its status and `issue <key>` note
  survive. Forced sends keep the newest accepted issue.
- **Clan report** composes at the clan's recording scope, not
  `members[0]`'s `account_clan.scope`; days travel as instants and the
  renderer names them in each recipient's timezone (`links.timezone`).
  Closes the 2026-09-26 queued item "clan reports are composed in the
  first recipient's timezone".

Tests: `services/jobs/test/email-run.test.mjs` (scratch database: the
ledger pre-filter, the stop, two milestones in one UTC day, the period
gate with its owner notice and kept note, `buildClan` deep-equal under
two accounts) fails on the old code, six of six;
`packages/mail/test/mail.test.mjs` renders a clan report's days in two
zones and an old `when` label; `infra-controls.test.mjs` pins the invoke
config.

No MCP contract or JSON API change. Ship: stack and jobs, no acceptance
(mail only, nothing a tool serves changed); smoke.

Shipped in PR #85 (22ea45ae..2c4ee306), deployed with no acceptance
(mail and stack only; nothing a tool serves changed): migrate ran 0 of
187, stack UPDATE_COMPLETE, smoke green. `elixir-mcp-jobs` LastModified
23:12:31Z (6:12 PM CT); `GetFunctionEventInvokeConfig` on `$LATEST`
answers `MaximumRetryAttempts` 2, `MaximumEventAgeInSeconds` 3600.

Read-back, reads only: `/api/public/status` `health.ok: true`;
`/updates` carries the entry. The first milestone pass on the new code,
23:20Z (6:20 PM CT), logged `recipients` 21, `sent` 5, `skipped` 16,
`already_sent` 0, `failed` 0, `remaining` 0, `incomplete` false, `ms`
3227.

Pending (natural runs; the lane B revisit confirms): the Monday
2026-09-28 `clan_report`, Wednesday 09-30 `tracking_report`, Thursday
10-01 `top_100` and Friday 10-02 `card_of_week` runs log `ms` and send
with no `already_sent` churn; the Top 100 and Card of the Week send
their own period's issue (or, with none, one owner notice).

## 2026-09-27 - #68 (A7): the written-issue pipeline hardened

Review §6.7, lane A. docs/EMAIL.md, "The written-issue pipeline
hardened", has the design.

- **One spine.** `top100Generate`/`top100Accept` run on
  `generateIssue`/`acceptIssue` with `top100Facts`, `briefNames(brief,
  kind)` from packages/mail, `kind` in the hand-off, and
  `{top100_generate: {force: true}}` as the ops flag. New archive prefix
  `mail/top_100/<date>/`; issues through 09-24 stay under `mail/top100/`.
- **Late accept sends.** `writtenSendDue(kind, period, now)` (slot Thu or
  Fri 14:00Z, pinned to the crons by a test); `issue_accept` then runs
  `runEmail(kind)` and logs `late_send`. Never for an ops brief.
- **Editor errors classified.** `FinalEditorError` (refusal,
  max_tokens, context_window, turn_limit, bad_json) and a 4xx are final:
  `issue.json` = `{_pipeline: {error}}`, jobs `issue_accept` marks the row
  failed and mails the owner "was not written", the hand-off is deleted.
  429, 5xx, 408/409 and connection errors rethrow to SQS.
- **Brief cache breakpoint** on the brief's content block (first user
  block, both passes) beside the system prompt's; the `{editor: {pass,
  turn, stop, usage}}` log shows `cache_read_input_tokens`.
- **Lint binding.** A number in a sentence naming someone must belong to
  that name's brief object (or be global/structural); a `numbers_used`
  claim must print the value at its path. The rotated sample podium
  (`services/editor/test/lint-binding.test.mjs`) fails the old lint two
  of four tests; the 09-18 and 09-24 Top 100 and W38 Card of the Week
  archived issues give zero findings on the new lint.

Tests: `services/editor/test/{lint-binding,generate}.test.mjs`,
`services/jobs/test/issue-pipeline.test.mjs`; verify 1405 of 1405.

Shipped in PR #87 (146f5fe5..1106cfea), deployed with no acceptance
(jobs and editor only): smoke green. `elixir-mcp-jobs` LastModified
23:53:13Z, `elixir-mcp-editor` 23:53:24Z (6:53 PM CT).
`/api/public/status` `health.ok: true`, `dlq_messages` 0; `/updates`
carries the entry.

Pending (natural runs): the Thursday 2026-10-01 generate (10:30Z, 5:30
AM CT) writes under `mail/top_100/2026-10-01/`, its editor turns after
the first log `cache_read_input_tokens` > 0, and the Top 100 sends on
its own period at 14:00Z (9:00 AM CT) or on accept if later; the Friday
10-02 `card_of_week` likewise.

## 2026-09-27 - #69 (A8): scheduler correctness: retries, board metric, session ceiling

Review §2.6 and §4.5, lane A. Line references re-verified against
7f299ea2: `plan.mjs` stamp (now ~720), the anchored due rule (~571),
`pipeline.mjs` error path (~581-602) and `rankings.mjs:269-276` all
held; the ledger's dead path had moved to `settleOnce` (~130).

- **Retries (0188).** `poll_state.retry_at` and `retry_tries`. A newly
  recorded non-404 fetch error (ingest) or a dead job (the settler)
  calls `stampRetry`: now + 15, 30, then 60 minutes; the fourth failure
  stamps none. The planner treats a row as due once `retry_at` has
  passed (as 0173's re-read), every plan clears it, and a cadence plan
  resets the count, so each failed plan earns up to three retries.
  Admission clears both. A retry is charged like any plan; the 404 hold
  is untouched. New EMF property `RetryJobs` (plain, no metric).
- **Board metric.** Confirmed first with one read-only `{stats}`
  before the change: 88 of 262 location boards stale by snapshot while
  the 24 h fetch errors held only 8 `rankings_pol` 404s and no other
  board error, so about 80 stale boards were read without error: the
  empty-board artefact. `ranking_health` now counts `fresh_locations`
  by `poll_state.last_admitted_at` within 26 h, splits
  `empty_locations` (fresh, no snapshot in 26 h) and
  `not_found_locations` (stale, last word a 404 after admission), and
  keeps `snapshot_fresh_locations` as the old measure. Keep the Boards
  reads the new fields.
- **Session ceiling.** `dueAfterMs`: for battle logs,
  `min(cadence x jitter, SESSION_CEILING_MINUTES)`; below the ceiling
  the jitter still spreads cohorts both ways. Roughly +700 polls a day
  (review estimate).

Tests: the plan test walks an events read failing at 10:05Z through
retries at 10:21Z, 10:52Z and 11:53Z, then the next board day, and a
404 that stamps nothing; ledger tests for the dead job and the doubling;
pipeline test for redelivery and admission; migrate test for the
ranking_health split; the ceiling over 400 tags.

**main's `validate` went red at the 09-28 UTC rollover** (the 23:59Z push
of 7f299ea2 ran its tests after midnight). Two clock-dependent tests in
`services/mcp`, neither touched by #69:
- `tools2` Gym #329 inserted its ended bucket 10 days before the fixed
  2026-09-03 fixture read, and `players_profile` keeps buckets from the
  last 35 days by the database clock, so from 2026-09-28 it aged out and
  the test fails on every run. Fixed here, test only: the subject is a
  fresh tag whose profile is read a day before now.
- `live` "players_profile live:true ... serves the fresh snapshot" fails
  only when its stale read (now - 10 min) lands in the Monday pre-reset
  window (to 00:10Z): `readRecordedProfile` orders `snapshot_kind desc`,
  so that game day's `pre_reset` row outranks the newer `daily` row, and
  the tool serves the older snapshot until the game day ends. Passes
  outside the window. Not fixed here (it is a reader question, not a
  test one): filed for Run Elixir MCP. A profile read on a Sunday game
  day after the pre-reset capture serves the capture, not the newest
  read, until Monday 10:00Z.

Shipped in PR #89 (027dab5b..e1744492), deployed with no acceptance
(scheduler, the ingest error path, a migration and an op; nothing a
tool serves changed): migrate ran 1 (0188), smoke 40 ok. Scheduler,
migrate and web-api LastModified 00:26:49-50Z 09-28 (7:26 PM CT 09-27).

Read-back, reads only: `/api/public/status` `health.ok: true`,
`dlq_messages` 0. `{stats}` `ranking_health`: 262 enabled, 254 fresh
(80 of them `empty_locations`), 8 stale, all 8 `not_found_locations`,
`snapshot_fresh_locations` 174 (the old measure). The phantom gap was
the 80 empty boards; the 8 are the 404s the planner holds. The first
tick on the new code (00:27:39Z) logged `RetryJobs` 0 beside
`PlannedJobs` 78; `/updates` carries the entry.

Pending (natural events; the lane B revisit confirms): the next 10:05Z
board tick (5:05 AM CT 09-28) and any natural non-404 error show
`RetryJobs` above 0 within 15 minutes of it; Keep the Boards' next run
reads `stale_locations` as the 404s only; a week of `lost_battles` on
`/api/public/efficiency` with the clamped ceiling.

## 2026-09-27 - #70 (A9): ingest and collector-door hardening

Review §2.5, §2.7 and §6.6, lane A. Line references re-verified
against 0741f979: the door's submit catch (~594-605, now ~603-640),
`pipeline.mjs` (~536-541, the processResult doc now ~535-545),
`ingest/src/handler.mjs` (~10-27), `rollups.mjs` (~23-66) and
`collector-door.mjs` ~29 and ~108-111 all held.

- **Submit retry.** The door runs `processResult` once more on SQLSTATE
  40P01 or 23505 (processResult has already rolled back), logging
  `submit_ingest_retry`; a second failure or any other error logs
  `submit_ingest_error` with its SQLSTATE and answers 500 as before.
- **Alarm.** `SubmitIngestErrorFilter` on the web-api log group
  (`ElixirMCP/Collector SubmitIngestError`, no DefaultValue) and
  `elixir-mcp-submit-ingest-error` at 10 in 15 minutes, about $0.10/mo.
  Measured over the 14 days before (Logs Insights): 279 errors, at most
  7 in any 15 minutes outside three incidents (09-15 60, 09-17 20, 09-23
  26); by message, 109 `Connection terminated`, 120 deadlocks (clan 58,
  player_battlelog 47, player 15), 45 missing-column errors mid-deploy.
- **Rollups.** `refreshDailyRollups` is one statement: the (tag, day)
  keys sorted and deduplicated, an upsert in key order guarded with
  `IS DISTINCT FROM`, and one DELETE of the rows the recomputation no
  longer produces for those keys. Check afterwards: player_battlelog
  deadlocks in `submit_ingest_retry` / `submit_ingest_error`.
- **Write-once archive.** Every `payloads/` put sends `If-None-Match: *`;
  a 412 is already archived (a retried submit re-puts the same key).
  `ArchiveBucketPolicy` denies a `payloads/` PutObject without the
  header to every principal (after `WebApiFunction`, so the header is
  sent before it is demanded). Scratch bucket first, 2026-09-28 00:43Z:
  unconditional put 403, conditional new key 200, conditional existing
  key 412, `calls/` unaffected; bucket and objects deleted. The live
  bucket had no policy before. `MigrateRole` loses `s3:PutObject` on
  `payloads/` (nothing used it), which closes that item in the
  2026-09-25 consistency pass's "Queued, not done" list.
- **429 on submit.** Config's `submit_retry` gains `retry_statuses:
  [429]`. The collector half (retry those statuses with the same
  backoff, not when `Retry-After` is longer than the lease can wait) is
  a collector release; naming it is Jamie's.

Shipped in PR #92 (a02e8dbb, e1e17c6f), deployed with no acceptance
(web-api, ingest and the stack; nothing a tool serves changed, as the
issue says): migrations 188 applied, 0 ran; smoke 40 ok; stack
UPDATE_COMPLETE 00:51:53Z, web-api LastModified 00:52:08Z 09-28
(7:52 PM CT 09-27).

Read-back, reads only: `/api/public/status` `health.ok: true`,
`dlq_messages` 0, admissions continuing. The live archive bucket
policy is exactly `PayloadsWriteOnce`; `elixir-mcp-migrate`'s policy
holds `s3:GetObject` only on `payloads/`; the metric filter and
`elixir-mcp-submit-ingest-error` (OK, 10 per 900 s, to
`elixir-mcp-alarms`) exist. Web-api log since the flip: several hundred
invocations, no `submit_ingest_error`, `submit_ingest_retry`,
`AccessDenied` or `PreconditionFailed` line, so every fresh-content put
passed the policy with the header; a POAP KINGS roster object landed
under `payloads/endpoint=clan/` at 01:03:08Z, after the flip.

Collector half: elixir-mcp-collector PR #16 (d60ce8b) retries a 4xx
named in `retry_statuses`, honouring a short `Retry-After` and giving up
on a long one; its release run published candidate **v3.0.6** (signed;
`name-collector-release.mjs --dry-run v3.0.6` verifies the signature
and lists all seven platforms, nothing written), and the release gate's
full payload audit (`payload-field-audit.mjs`, player_battlelog, 114,110
objects) passed: every observed field path has a disposition. v3.0.4 is named;
v3.0.5 between them changed only CI (e5e4fb9). Owed to Jamie: the
dev-build soak and the naming (RELEASING-COLLECTOR.md §2 and §4).

Pending (natural events): the next 10:00Z rollover shows player_battlelog
deadlocks gone from `submit_ingest_error` (they may appear, once, as
`submit_ingest_retry`); a week with the alarm quiet outside incidents.

## 2026-09-27 - #71 (A10): observability and hygiene

Review 2026-09-27 §5.2, §5.3, §8.5, §8.6. The alarm cost (about
$0.50/mo) was pre-authorized for this run (DECISIONS: cost calls are
Jamie's). Two PRs: the database and alarms first, then secrets and
`/api/v1`.

**Part 1: the database and the alarms.**

- **0189** sets the 0103 autovacuum settings (insert-scale 0.02,
  vacuum-scale 0.05, analyze-scale 0.02, `lock_timeout` first) on `deck`,
  `deck_card`, `meta_season_pop`, `battle_participant_card` and the six
  season rollup tables (`card_meta_season`, `card_meta_season_band`,
  `deck_meta_season`, `deck_meta_season_band`, `meta_season_totals`,
  `meta_season_band_totals`). `{tables}` now shows each table's
  visibility-map cover (`pages`, `all_visible_pages`, `all_visible_pct`)
  and its `table_options`, which is what the week-later check reads.
- **0190** creates `pg_stat_statements` (RDS preloads it:
  `shared_preload_libraries` on elixir-mcp-enc is
  `pg_stat_statements,pg_tle`, PostgreSQL 17.9). The read-only
  `{statements}` op answers the top 20 (at most 50) by total execution
  time and by shared blocks read, normalized text cut to 400 characters,
  and when the counters were reset; `not_installed` before 0190 and
  `not_loaded` without the library (a scratch database), rather than a
  failure. Catalogued in `.claude/skills/ops/ops.md`.
- **Alarms, all to `AlarmTopic`.** `elixir-mcp-door-handled-failures`
  (a metric filter on `tool_failed_unexpectedly` and `db_connect_failed`
  in the MCP log group, and on `tool_failed_unexpectedly` in the web-api
  log group, whose Explore and `/api/v1` run the same invoker; 3 in 10
  minutes; no DefaultValue); `elixir-mcp-web-api-latency-p95` (over 15 s
  for 15 minutes); `elixir-mcp-db-ebs-byte-balance` (under 25%);
  `elixir-mcp-db-freeable-memory` (under 150 MB); and
  `elixir-mcp-site-certificate-expiry` (ACM `DaysToExpiry` under 30 on
  `SiteCertificateArn`). Run Elixir MCP's Doors check names them.
- **Deployed and read back (2026-09-27, evening Central).** PR #94,
  deploy exit 0: migrations `{"applied":188,"ran":2}`, 40 smoke checks,
  stack UPDATE_COMPLETE. The five alarms exist, are OK, and act on
  `elixir-mcp-alarms`; the certificate alarm watches the
  elixir.poapkings.com certificate (`42352a61-...`). Both metric filters
  exist on their log groups. `{statements}` answers (version 1.11; the
  library's counters run from 2026-09-06, 10 statements evicted). By
  total time, the top statements are the `api_payload` insert (351k calls,
  about 44,000 s), the collector heartbeat update (1.0M calls, about
  17,000 s) and the `player_daily_battle_rollup` upsert. By shared blocks
  read, the top are the `deck_card` anchored synergy query (308 calls,
  14M blocks) and the `select distinct bp.player_tag, ...::date`
  activity scan (41 calls, 12M blocks). Those are the inputs the
  instance and cache decisions were waiting on. Not acted on here.
- **Week-later check (about 2026-10-04):** `{tables}` on the ten tuned
  tables should show `all_visible_pct` above about 98 with no manual
  `{vacuum}`.

**Part 2: secrets and `/api/v1`.**

- **`/api/v1` 2.6.4.** A non-ApiError exception now answers 500
  `internal` with no Retry-After. Only a transient database failure
  answers 503 `temporarily_unavailable` with `Retry-After: 5`: a
  connection refused, reset or terminated, a statement or lock timeout,
  a serialization failure or deadlock, or too many connections. The
  clan fact operations' security blocks now name `integrationKey`.
  `services/web-api/test/integration-routing.test.mjs` walks
  `integrationContract.paths` and checks, for every operation and every
  principal kind:
  - the operation routes and is audited as itself;
  - kinds it does not declare are refused `not_found`;
  - the security schemes match `x-principals`.
  Writing the test found a person's `insufficient_scope` refusal that was
  never audited (the operation marked itself tool-audited before the
  scope check); that is fixed. It also found, but did not fix, that the
  invoker writes its own `request_id` on a tool's audit row, not the
  `X-Request-ID` the `/api/v1` response carries. The docs say that
  header ties a response to its audit row, so for tool-backed operations
  it does not yet.
- **Rotation without breakage.**
  - Sessions verify against `SESSION_SECRET` and
    `SESSION_SECRET_PREVIOUS`, and sign with the current secret only.
  - The doors accept `ORIGIN_SECRET` or `ORIGIN_SECRET_PREVIOUS`.
  - Unsubscribe links signed with their own key carry the key id
    `u1.` (`unsubscribe_secret`). A link with no key id is checked
    against the session secrets.
  - Template switches, all PRESERVED:
    - `SessionSecretPreviousInSecret` and `UnsubscribeKeyInSecret`,
      both `false`, gate the references to keys the app secret does not
      carry yet;
    - `OriginSecretPrevious` is NoEcho, empty by default;
    - `SecretEpoch` is on all seven functions that hold a secret
      reference, so one `--param=SecretEpoch=<date>` makes every
      reference, `db_password` included, be read again.
  - `deploy.mjs --rotate-origin-secret` rotates the origin secret, and
    CloudFront now `DependsOn` both doors.
  - `parameters.mjs` omits a PRESERVED parameter the live stack has
    never stored, so its first deploy takes the template default. It
    used to send UsePreviousValue, which CloudFormation refuses.
  - Runbook: `docs/SECRETS.md`. The rehearsal of a session rotation
    signing nobody out is `auth.test.mjs` against a scratch database.
- **`sslmode=verify-full`** on all five `DATABASE_URL`s. Each database
  function's package carries the us-east-1 RDS root CAs
  (`infra/certificates/rds-us-east-1-bundle.pem`, roots only, as RDS
  asks) through `NODE_EXTRA_CA_CERTS=/var/task/certificates/rds.pem`,
  which is AWS's recommendation for Node 20 and later runtimes.

**For Jamie (manual, values only you handle):**

1. Give unsubscribe links their own key: add `unsubscribe_secret` to
   `elixir-mcp/app`, then deploy with
   `--param=UnsubscribeKeyInSecret=true` (`docs/SECRETS.md`, "Unsubscribe
   key").
2. The live session-secret rotation, when you want one, follows
   "Session secret" in the same file. It needs a console edit of the
   secret value, so no agent can run it.

**Part 2 deployed and read back (2026-09-27, 20:45 Central).**
- PR #95 merged on a green `validate`. The deploy exited 0: migrations
  `{"applied":190,"ran":0}`, 40 smoke checks, stack UPDATE_COMPLETE, and
  `/api/public/status` answers `"ok":true`. No acceptance run, because
  no tool changed.
- `verify-full` works on every database function. From 01:46Z on, the
  logs of web-api, mcp, scheduler, migrate and jobs hold no error, no
  `db_connect_failed` and no certificate line. `{tables}` through the
  migrate function answers.
- **A rollout blip to remember.** At 01:45:36Z and 01:45:39Z, two
  web-api invocations failed with `SELF_SIGNED_CERT_IN_CHAIN` and the
  line "Ignoring extra certs from /var/task/certificates/rds.pem". For
  those seconds CloudFormation had applied the new environment
  (`NODE_EXTRA_CA_CERTS`, `verify-full`) but not yet the new code that
  carries the file. Two lessons for next time:
  - an environment variable that names a file in the bundle should ship
    one deploy after the file;
  - a rotation that only moves `SecretEpoch` changes no code and has no
    such window.
- `{tables}`: all ten tables carry the 0189 options. `all_visible_pct`
  is 99.9 to 100 on `deck`, `deck_card`, `meta_season_pop`,
  `battle_participant_card`, `card_meta_season`, `card_meta_season_band`,
  `deck_meta_season` and `meta_season_band_totals`. It is 77.8 on
  `deck_meta_season_band`, and 0 on `meta_season_totals`, a small table
  rewritten nightly. The week-later check reads those two again.
- The parameters are at their defaults: `SecretEpoch` 0,
  `SessionSecretPreviousInSecret` false, `UnsubscribeKeyInSecret` false.
  The origin rotation has not been run live.

## 2026-09-27 - #70 (A9): collector v3.0.6 named

Jamie approved naming candidate v3.0.6 (d60ce8b, elixir-mcp-collector
PR #16: a 4xx listed in `retry_statuses`, now 429, is retried within the
lease) in this session: "Good to move forward with naming 3.0.6". That
approval stands in for the separate dev-build soak (RELEASING-COLLECTOR.md
§2); it covers naming only, so `min_client_version` (2.0.30) and
`CollectorMinEnforce` are unchanged.

- `name-collector-release.mjs --dry-run v3.0.6`, then the real run at
  01:55Z on 09-28 (8:55 PM CT on 09-27): the signature verified against
  the release key, all seven platform keys named (`go-linux-arm` ->
  `collector_linux_armv7`, `go-windows-amd64` -> the `.exe`, as the
  table requires), and v3.0.6 promoted to Latest on GitHub. The full
  payload audit for this candidate passed earlier (entry above).
- Before naming, `/api/public/status` showed five active collectors,
  all on signed v3.0.4 (Hog Rider draining since 09-18).
- Rollback, if it is needed: name v3.0.4.

- The fleet moved within the hour, read on `/api/public/status`: Royal
  Hogs by 02:13Z, Mini P.E.K.K.A and Witch by 02:18Z, Skeleton Army by
  02:23Z, Cannon by 02:43Z (9:43 PM CT). All five report signed v3.0.6,
  active and fetching; `ok: true`, `dlq_messages` 0.

Pending: the 429 retry is exercised only by a real throttle burst, so a
week with no collector quarantined for `missed_streak`.

## 2026-09-27 - #72 (review 7.5): console links, failed writes, Explore's reads

Three console defects from the 2026-09-27 review, one PR, console and
kit only (no tool, contract or JSON API change).

- **Record links.** The kit gains `Link` (`packages/ui/src/Link.tsx`):
  it always renders an href and routes in-app only on an unmodified
  primary click (`isPlainClick`); the router reaches it through
  `NavigateProvider`, which the Shell supplies, and without one it is a
  plain anchor, so Elixir Clan keeps working before its pin bump.
  `LogCell` is `{text, href}`. The Rail, Chrome and the rail identity
  leave a modified click to the browser. About 65 click-only anchors are
  Links now, and actions are `<button className="link">` (a new
  components.css rule). `apps/web/test/links.test.js` pins anchors
  without an href, and console anchors with their own onClick, at zero;
  oxlint runs `jsx-a11y` with only `anchor-is-valid` on (the plugin's
  other defaults found 39 unrelated sites and are off, out of scope).
- **Failed writes.** `packages/client` gains `useWrite(call,
  {invalidate})`: it unwraps, so a refusal or a transport failure is an
  error; refetches only after a success; and hands the error to the
  kit's `WriteError`. All 21 bare writes are converted (devices, agents,
  admin revokes and decisions, gateway lifecycle, connections, email
  preferences, the tracked record, the nickname, the handoff confirm,
  sign-out); "Make primary" no longer clears its refusal whatever the
  answer. `apps/web/test/writes.test.jsx` pins bare `await api.` writes
  at zero.
- **Explore.** A week reads `war_history {clan_tag, season_id,
  section_index}` instead of searching the last 12 seasons (a week older
  than that answered "not in the recorded log"), says the tool's own
  note when the record does not hold it, and renders the standings, the
  days and `member_weeks` as plain tables. A tag lookup's probe seeds the
  record's query (`['explore', kind, id]`), so a lookup is one call.
- Tests first for the named failures (week by name, probe seeding,
  refused sign-out, useWrite). `npm run verify`, the site build and
  `npm run e2e` (9) are green.
- Deploy scope: no acceptance. Console only, so no tool family changed.
- Sibling: Elixir Clan takes the kit through its pin. It does not use
  `LogTable`, so nothing breaks; the pin bump is Clan's own step.

- Merged as PR #99 (a45c07af..c94c887c) on a green `validate`.
  Deployed from main with no acceptance: console only, so no tool family
  changed. Smoke passed, 40 of 40. Read back at 03:17Z on 09-28 (10:17 PM
  CT on 09-27):
  - the app bundle carries the kit's `WriteError` text;
  - /updates shows the entry;
  - `/api/public/status` has `health.ok` true and `dlq_messages` 0.
- Pending, for a natural visit:
  - a signed-in walk: a Cmd-click on a record link opens a new tab, and
    a live war-week page shows all five clans' standings;
  - Elixir Clan's kit pin bump (its own PR; merging Clan deploys it).

## 2026-09-27 - #73 (A12): edge caching, site publishing and feed fixes

Review 2026-09-27 §5.4, §7.6, §7.7 and §8.4. Every line reference
re-verified against d99b0e66; all six parts still held.

- **Edge cache.** One `/api/public/*` behaviour (CachingOptimized,
  GET/HEAD, no origin request policy), first in the list, replaces the
  `/status` and `/stats` behaviours of #23. `/cards`, `/cards/*` and
  `/efficiency` sent `max-age` but missed every time under `/api/*`.
  A test holds every `/api/public` route to GET with its own `max-age`:
  CachingOptimized keeps a response with no Cache-Control for a day.
  Smoke now requires an edge Hit on `/api/public/cards` as well as status.
- **Publishing** (`infra/scripts/lib/site-publish.mjs`). The steps run in
  order: assets without `--delete`, documents with `--delete` but
  excluding `assets/`, the `.txt` charset rewrite (which now restates
  Cache-Control), the invalidation, then a prune. The prune removes an
  asset once no deploy has shipped it for 14 days.
  One deviation from the issue text: only Vite's content-hashed chunks
  are `immutable`. The site's own assets (`site.css`, the rail scripts,
  card art, fonts) keep one name and are busted by `?v=`, and
  CachingOptimized leaves the query string out of the cache key. Marked
  immutable, a browser could hold old bytes under a new `?v=` for a
  year. They get `max-age=0, must-revalidate`, as the documents do.
- **CI builds the site once.** It is built in the site workspace's test,
  inside `npm run verify`. validate.yml no longer builds it again, and
  in CI the Playwright webServer only serves the tree; locally it still
  builds first.
- **Feeds.** `_data/feedItems.js` takes the newest 50 of `updatesView`,
  so contract versions are included. Each GUID is the entry's
  `/updates/<slug>` page (`isPermaLink="true"`), and there is a new
  `/feed.json` (JSON Feed 1.1). A site test checks for unique,
  index-free GUIDs that resolve to pages, and for the same items in both
  feeds. Dropping the redundant `| esc` also fixed titles that were
  escaped twice (`&amp;amp;`). What's new announces the one-time replay.
- **Consistency.** The river-race log window is "ten weeks"
  (cr-agent-api-docs `bc6be0f`) on the four surfaces. The builders'
  "Publish your own stats" example now sets up an agent connection,
  because `/api/v1` serves neither `war_history` nor `clans_standings`.
  A trace found no other surface stating the window or pointing
  builders at a service key for those reads. The acceptance bite
  `167-2-elixir_examples.json` keeps the old wording because it
  captures a past answer. Widening `clans:read` is still Jamie's call
  (§7.7), and nothing was added for it.
- **Glue.** The endpoint enum lists all 15 archived endpoints, which
  match the live `payloads/endpoint=` prefixes (listed before the change). It is
  pinned to `ARCHIVED_ENDPOINTS` (the ingest projector keys) by
  `services/ingest/test/archive.test.mjs`.
- Deploy scope: no acceptance. The changes are stack, site and CI only,
  and no tool family changed.

- Merged as PR #101 (da7102fb..b2947c1a) on a green `validate`; CI
  built the site once (in verify) and the journeys (9) served that tree.
  Deployed from main with no acceptance: stack, site and CI only. Smoke
  passed, including the new edge Hit on `/api/public/cards`; the first
  prune removed 0 assets. Read back at 03:44Z on 09-28 (10:44 PM CT on
  09-27):
  - `/api/public/efficiency` and `/api/public/cards/26000000`: Miss,
    then Hit, Hit;
  - a Vite chunk carries `public, max-age=31536000, immutable`, and
    `site.css`, `index.html`, `/updates`, `feed.xml`, `feed.json` and
    `llms.txt` carry `public, max-age=0, must-revalidate` (llms.txt
    keeps its charset);
  - `feed.xml` has 50 items with unique permalink GUIDs and no
    fragments, 22 of them contract versions, and a GUID page answers
    200; `feed.json` is JSON Feed 1.1 with the same 50;
  - the Glue table's live enum lists the 15 endpoints;
  - `/support`, `/data` and `/examples/publish` say ten weeks, and the
    publish example links `/account/agents`;
  - `/api/public/status` has `health.ok` true and `dlq_messages` 0.
- Pending, for natural events: the next web deploy that changes a chunk
  (the old chunk must stay served, and be pruned 14 days later); a feed
  reader's one-time replay of the newest 50 items.

## 2026-09-28 - #44: the catalog's tower troops are the current /cards list

`cards_catalog` answered five tower troops against the official four:
`29000000` "Archer Queen", beside the real Archer Queen `26000072`.

- **Where it came from: import drift, not game truth.** Every archived
  `/cards` payload (9, 2026-05-20 to 2026-09-16) lists the same four
  `supportItems`. A full read of the archive's 114,947 battle logs and
  62,062 profiles on 2026-09-28 found `29000000` in none of them. The
  card row's first sighting, 2026-05-28 22:20:24Z, matches elixir-bot's
  `tests/test_cr_api.py::test_get_cards_success`. That test mocks a
  `/cards` response of `{"items": [Knight], "supportItems": [{"name":
  "Archer Queen", "id": 29000000}]}`, and the mock leaked into the bot's
  raw payload table the same day as the two test stubs admission
  refused in the 2026-09-15 replay (W38 notes). The replay admitted this
  one as a catalog fetch. Its content hash was already held from the
  09-03 import, so it never reached the S3 archive, and the projector,
  which heals and fills from a fetch of any age, inserted the row as
  confirmed. Nothing goes to cr-agent-api-docs: the API never sent it.
  elixir-bot is retired, so its test stays as it is.
- **The fix (0191).** `card.in_catalog` is what the newest admitted
  `/cards` fetch lists. Only a fetch at least as new as
  `poll_state`'s last admission moves it, and only rows whose membership
  changed are written, so an unchanged re-fetch still writes nothing. A
  replayed or delayed older fetch still fills and heals rows but lists
  nothing. A payload without `supportItems` says nothing about tower
  troops. `cards_catalog.tower_troops` (and the `cards` resource) serve
  `kind = 'support' and in_catalog`. Rows never leave: `deck_sets` still
  pools every support id, and `cards_card` still answers `29000000` by id.
  The fill lists every confirmed row except those confirmed only by a
  `backfill-elixir-bot` receipt at the same instant; the next daily
  fetch corrects any it reads wrong. The fill was checked on sample rows
  on a scratch database.
- The `cards` list keeps its behaviour: a release-day stub still shows
  until the catalog heals it, which the ingest rule "Ingest never pauses
  on catalog integrity" wants. Only tower troops were filtered.
- Tests: `services/mcp/test/catalog-tower-troops.test.mjs`, five cases:
  the replayed leak, a battle stub, later confirmation, removal with the
  row kept and a stale fetch ignored, and a payload without
  `supportItems`. All five fail with the read filter removed.
- Contract 9.12.5 (behaviour patch; `cards_catalog` is mirrored by no
  JSON API operation). Deploy scope: `--acceptance=cards`.
- **Deployed 9.12.5** (PR #103, `115a10ff`) with `--acceptance=cards`.
  Migration 0191 ran (190 applied, 1 ran) and smoke passed. Acceptance
  ran 118 cases with 0 failed, so no verdicts were needed. Read back at
  04:18Z on 09-28 (11:18 PM CT on 09-27): `tower_troops` lists the four,
  and `29000000` is gone. The fill had already left it unlisted, which
  confirms that only a `backfill-elixir-bot` receipt confirmed it.
- **9.12.6: the same rule for `cards`.** The read-back found 134 cards
  against the official 123. All 11 extra rows are battle stubs with no
  rarity or cost: Super Witch, Super Lava Hound, Super Magic Archer,
  Super Ice Golem, Super Archers, Terry, Super Mini P.E.K.K.A, Super
  Knight, Barbarian Launcher, Party Hut and Party Rocket. These are
  event-only cards that `/cards` never lists. The issue's acceptance is
  123 and 4, so `readCatalog` now serves listed rows only for both
  lists (and `as_of`). The site's card pages already skipped cards with
  no cost or icon, so no page changes, and `/api/public/cards/<id>`
  still answers any card by id. The earlier line saying `cards` keeps
  its behaviour is superseded. A sixth test covers an event-only card.
  Contract 9.12.6, `--acceptance=cards`.
- **Deployed 9.12.6** (PR #104, `2b7f1761`) with `--acceptance=cards`.
  No migration was pending, smoke passed, and acceptance ran 118 cases
  with 0 failed. Read back at 04:33Z on 09-28 (11:33 PM CT on 09-27):
  - `elixir_changelog` since 9.12.4 lists 9.12.5 and 9.12.6;
  - `/tools.json` shows contract 9.12.6;
  - `/api/public/cards` (a CloudFront miss after the invalidation) has
    123 cards;
  - `cards_catalog` lists four tower troops, and a "super" query finds
    no card;
  - `/updates/2026-09-28-contract-9-12-6/` returns 200;
  - `health.ok` is true.
- Pending, for a natural event: the next daily `/cards` admission,
  about 15:37Z (10:37 AM CT), is the first live run of the membership
  update. It should move no row while the catalog is unchanged.

## 2026-09-28 - #43: console journeys cover the timeline's read case

- Re-verified against `c246a839`. The failure the issue names (the rail's
  unread dot read from `signals.events_unseen`, no `GET /api/me/timeline`
  fixture, an Activity heading of "Notifications") was repaired on
  2026-09-14 in `b508eaf0`, and later journeys moved with the timeline
  (`3980bb31`, its own rail item). `validate` has been green on main
  since. The issue's `App.jsx:1035` is now `App.jsx:1388`.
- What was still missing was the issue's second case: the journeys had
  only the unread one. A new journey serves `timeline_pending: 0` and a
  `read_to` at the item's time. It checks that the rail has no dot and
  that the row says `read`, not `unread`. It then reloads onto an empty
  week and checks the empty line and still no dot. Reverting the fixture
  to `timeline_pending: 1` makes it fail on the dot. The fixture comment
  now says the dot is on Timeline. Ten journeys pass locally.
- Tests only: nothing the site, console or a tool serves changed. So
  there is no contract bump and no deploy, because the built tree is the
  same. The issue asked for no live read.

## 2026-09-28 — Run Elixir MCP: acceptance distinguishes an active war from a missed finish

At 09:48Z the public status was healthy: 967 battles in the prior hour,
37-second fetch and admission freshness, zero dead jobs and dead letters, and
five fresh signed v3.0.6 collectors. `{stats: true}` recorded 740
battle-log polls with zero current-hour gaps; the scheduled efficiency,
activity, meta-rollup and archetype jobs all completed on schedule. No Elixir
alarm was in ALARM; RDS held about 671 MiB freeable memory, 16 MiB swap and
99.5% EBS byte balance.

The day's one read-only `npm run acceptance` pass found two related identity
failures on the current regular war week: the server correctly served
`in_progress: true` with `finished_early: null`, while the acceptance checks
treated its live fame and recorded finish-day detail as a closed-week result.
The checks now exclude an active row from the line-reached implication and
require `finished_early === false` before asserting no finish day. A local
regression test covers the active, finished, and closed-without-finish rows.
This is harness-only: no product contract, deployment, or second live
acceptance run is owed.

Preview check: all three Discord containers were up for 33 hours, but the POAP
KINGS editor routine retried every five minutes after its Claude workspace API
limit was reached (reset stated as 2026-10-01T00:00Z). The service remained up
and its event cursor was not replayed, but the retry cadence is an operational
gap in the Discord preview; it needs a failure-specific cooldown there, not a
restart or an early routine run.

## 2026-09-28 - Lane B of the 2026-09-27 review, decided

The lane A queue closed: #62-#73, #44 and #43 are deployed and read
back. Jamie has some non-blocking follow-ups, recorded in those issues'
closing comments. Before the revisit, each lane B feature was checked
against current `main` (7de2000): one agent per feature built a decision
card, and a skeptic challenged it. All six cards held. Jamie's answers:

- **Yes:**
  - **#46** (historical clan roles on `clans_participation`, for Elixir
    Clan's replay). The build plan is in the issue's 2026-09-28 comment.
  - **#110** (a `card_form_unlocked` moment, going forward only).
  - **#111** (stable timeline item ids). Jamie: "meaningful to the
    discord bots as well as Claude using the MCP … how you tell stories
    as an agent using the MCP is weak now." The id names the story, and
    a revision marks its growth.
- **Fixes, joining the queue as lane A:**
  - **#108:** `battles_compare` never attached the completeness note.
  - **#109:** event classification.
- **Parked in lane D, each with its trigger:** gaps as a precise
  control; the event as a population (`group_by: "event"`, an
  `event_tag` filter); card history `changes[]`; the supported-clients
  matrix.

**Mode ruling (Jamie, 2026-09-28).** DECISIONS 18 said `clanMate` and
`unknown` battles are casual everywhere, while 75, and `modeGroupOf`,
made every tagged battle event content. Two measurements forced the
question:

- 62% of clanmate friendlies carry an event tag;
- a player's 56 Royale Shuffle battles are type `unknown` with a tag.

Jamie, with a screenshot of the game's Game Modes list showing Royale
Shuffle and the Royale Shuffle Challenge as timed events: "those shuffle
battles are clearly events … Clan mate battles would typically be
casual." DECISIONS 18 and 75 now say it:

- a clanmate battle (`clanMate`, `clanMate2v2`) is casual even when
  tagged;
- an `unknown` battle is event content when tagged, and casual when not.

#109 carries the code, including any re-derivation of stored mode
groups.

**Also raised: agent storytelling.** Jamie finds how agents tell stories
through Elixir weak. #111 is one piece. A focused look, for example a
Gym journey that asks an agent to tell a player's or a clan's week and
judges the result, is a candidate after lane C.

## 2026-09-28 - #108 (A13): `battles_compare` carries the completeness note

`battles_compare` built its meta with bare `responseMeta`, so the capture
control `battles_performance` and `battles_query` attach through
`buildMeta` never reached a comparison ("Every aggregate ships its
control"). The gate (window ends inside seven days, player tag, newest
profile interval under 0.9 or unknown with a tail over 48 hours) moved
out of `buildMeta` into `completenessNotes(db, tags, windowTo)` in
`tools/shared.mjs`; `buildMeta` calls it with one tag and
`battles_compare` with its compared tags. One sentence per incomplete
side, each naming its tag, in the order asked, a repeated tag read once;
no incomplete side, no note. `meta.completeness_note` stays a string, so
no output-schema change: contract 9.12.7, a patch. `battles_compare` has
no `/api/v1` mirror. Test: `services/mcp/test/coverage.test.mjs`
(gapped + complete, unknown + gapped, complete twice, an old window).
Out of scope, parked in lane D: gap intervals as a precise control.

**9.12.7 shipped** (293490bc, PR #114), `--acceptance=battles` as the
issue asked (the `buildMeta` edit only moved its gate into
`completenessNotes`, no new query for a single subject); smoke green,
migrations ran 0. Acceptance: 197 cases, 3 failed, every
`battles_compare` case passed. Verdicts, each re-run alone:

- `catalogue/battles_meta_cards#1` (15.4 s): 3.8 s alone, a cold read.
- `budgets/meta-cards-corpus-week` (16.0 s, 16.0 s alone) and
  `catalogue/battles_trends#1` (10.2 s, 4.3 s alone): the open
  first-call slow-seed item (9.11.1, 9.12.0, 9.12.2); neither tool
  changed.

Read-back 13:28Z (8:28 AM CT), reads only: `/api/public/status` `ok:
true`; `elixir_changelog({since: "9.12.6"})` answers 9.12.7 and
`meta.contract_version` is 9.12.7. `battles_compare` over two sets of
four recorded players (King Thing, thingles, King Levy, raquaza; Ditaka,
pokemon, Vijay, OllieTurtle), last seven days, carries no
`completeness_note`, and `battles_performance` shows none for any of
them or for six more watched players: no side is incomplete today, so
the note showing when one is rests on the scratch test until a natural
gap.

## 2026-09-28 - #109 (A14): event classification

Jamie's mode ruling (the lane B entry above) reaches the code.
`modeGroupOf` and `modeGroupSql` checked the tag before the type, so a
tagged `clanMate`/`clanMate2v2` battle was `event`. Now
`isEventContent` / `eventContentSql` in `packages/contracts/src/modes.ts`
say "tagged, and not a clanmate's", and both folds, the battle tools'
`modeClause`, `participantModeClause` and `battles_opponents` use it. A
tagged `unknown` was already `event` and stays so. Tests:
`services/mcp/test/mode-groups.test.mjs` pins JS = SQL for every type
tagged and untagged, every `mode` filter = the fold, the daily rollup,
and the per-event rows; `record-to-wire.test.mjs` now expects the
fixture's tagged clanMate2v2 under `casual`.

- **`group_by: game_mode`** keys rows by `(game_mode, type, event_tag)`
  with `event_tag` only on event content, and `event_title` from
  `game_event` (null when never sighted). `EVENT_POOL_NOTE` names that
  view and is not attached to it. Out of scope, parked in lane D:
  `group_by: "event"` and an `event_tag` filter.
- **Stored groups.** Only `player_daily_battle_rollup` stores a group per
  battle. The meta tables never held a tagged battle: `META_POPULATION`
  and `metaPopulationClause` test `event_tag is null`, not the group, so
  a tagged clanmate friendly (casual now) stays out of the meta, as it
  was. That keeps DECISIONS 76's reason (a deck under an event's rules
  describes the event); it is noted in the code and in battles.md. If
  Jamie wants tagged friendlies in the casual meta, it is one clause
  plus a season re-derive. The rollup rows are re-derived by a new op,
  `{rollup_regroup}` (census, then batches to `done`), after the deploy.
- **Docs:** battles.md's `mode_group` row, the mode-group table, the
  event section (the note never named the pooled tags; it now points at
  the per-event view) and the meta section; the tool-change checklist's
  event-pool pointer named `invoker.mjs`, and the note lives in
  `tools.mjs`.
- Contract 9.12.8, a patch (behaviour correction; `by_mode` items
  declared). `battles_query` is the JSON API mirror: its rows'
  `mode_group` values change, its shape does not.

### Deployed and read back

- **Deploy.** PR #116 (`80db167e`, `cd40e3ac`), stack updated
  13:58Z (8:58 AM CT), full acceptance (`modes.ts` is shared);
  migrations applied 191, ran 0.
- **`{rollup_regroup}`.** Census: 3,094 tagged clanmate battles, 2,374
  event pairs misfiled. Two runs to `done` (282 + 93 batches), 2,374
  pairs recomputed, 6,844 participant-battles refiled from `event` to
  `casual`; census after: 0. `{vacuum}` refused the table (not on its
  allowlist); at this size autovacuum absorbs it, and ops.md and the op's
  comment now say so. The op is ready to retire with the next migrate
  change.
- **Acceptance, 1188 cases, 17 failed**, each triaged:
  - gym/157.3 (standings casual 11 vs `battles_query` 15 for #VGC22YGP):
    the rollup had not been regrouped yet; passes after the op.
  - gym/187.4 (event 283 vs 287): amended for the ruling, the week's
    four tagged clanMate2v2 friendlies are casual now.
  - gym/188.1, 188.2 (`/[Ee]vent battles/`): amended to `/[Ee]vent tag/`;
    the outside-meta disclosure names the tag, because the meta leaves
    out every tagged battle and that is no longer "event battles". The
    bites carry no such note, so both still fail on them.
  - gym/285.2, 304.1: live cases; pass alone.
  - gym/289.3, 337.1, 343.2: live cases whose world moved, as at 9.12.2
    and 9.12.7; not this change's tools.
  - budgets/meta-cards-corpus-week, catalogue/battles_meta_cards#1,
    catalogue/battles_trends#1, catalogue/badges_rarity#1: the open
    timing items (badges_rarity 4.6 s alone, trends 9.6 s alone, as at
    9.12.7).
  - catalogue/cards_archetype#docs, elixir_collectors#docs,
    elixir_timeline#docs, war_history#notes: rare fields absent from this
    run.
- **Read-back.** `elixir_changelog` since 9.12.7 lists 9.12.8 and
  `contract_version` is 9.12.8. #VGC22YGP, 2026-09-07 to 09-21, `group_by:
  game_mode`: 2v2 League and Seasonal Trophy Road are separate titled
  rows, and the clanMate2v2 rows carry no event tag. #C920YGLC2, from
  09-21, `mode: event`: Royale Shuffle (`unknown`, #2C9J8QUU) rows under
  event, one per mode, each holding one event tag. `/tools.json` carries
  `event_title`, and `/updates` lists the entry.
- **Pending natural check:** the next day's ingest writes new tagged
  clanmate friendlies to `casual` (census stays 0).

## 2026-09-28 - #46: participation replays a past war finish (9.13.0)

`clans_participation` now carries each member's `in_clan_at_war_finish`
and `role_at_war_finish` aligned to `war_weeks`, `role_changes` at full
verbosity, the clan's `role_history_since`, and `former_members`. The
rebuild (`services/mcp/src/role-history.mjs`) reads the membership
intervals and `role_changed` events at the clan's roster reads on either
side of each finish and serves a value only when the two agree; imported
tenure carries no roles, so role history starts at the first live roster
read. JSON API 2.7.0 mirrors it. PR #118.

### Deployed and read back

- **Census** (`{role_history_census}`, new): 0 inverted event windows, 0
  `role_changed` rows out of admission order, 0 memberships whose leave
  does not follow the join; 183 per-player chain breaks and 14 flip-flops
  inside an hour across all clans (the rebuild checks the chain per
  membership interval and serves null where it breaks); 637 clan receipts
  in 30 days admitted after a newer read, all in one clan.
- **Size and time.** The recorded clan at weeks 8: compact 47,032 bytes,
  373 ms warm (17 former members); full 52,113 characters, over the
  48,000 cap, so it answers `result_too_large` naming `weeks` and
  `verbosity`. Filed as known for the two catalogue sets until 2026-10-26.
  Compact has about 1,000 characters of headroom: a few more departures in
  the window push it over too. The JSON API operation has no cap.
- **Acceptance (`--acceptance=clans`), 132 cases, 3 failed:** the two
  catalogue sets above, and gym/337.1 (a live case on a clan that is no
  longer recorded; not this change).
- **Read-back** (weeks 3 compact): contract 9.13.0; the two members
  promoted on 2026-09-15 read `member` at the 136/0 finish and `elder` at
  136/1; a member who left on 09-19 and rejoined on 09-23 reads not in the
  clan at the 136/1 finish; five departures are under `former_members`.
- **Pending natural check:** the next finish (136/2's is still unobserved)
  fills its column once a roster read follows it.

## 2026-09-28 - #110: Evolution and Hero unlocks are moments (9.14.0)

Lane B, approved in the revisit: only the form-unlock moment; card history
`changes[]` stays parked (lane D). The collection projector's prior CTE now
reads `evolution_level`, and each form bit newly set (new & ~prior; 1
Evolution, 2 Hero) emits `card_form_unlocked` `{card_id, form}`, behind the
`moments` flag and silent on a player's first observation. The form rides
as its bit in `player_event.step` (no new column); 0192 replaces
`player_event_type_check` NOT VALID and 0193 validates it. Going forward
only, no backfill (Jamie, 2026-09-11). Surfaces: a `collection` item on
`elixir_timeline` ("unlocked Hero Valkyrie") and in `kinds`, a player
entry's `collection.forms_unlocked` (a form unlock alone makes an entry,
not a `quiet` line), the milestone mail (key `form:<card_id>:<form>`, rank
2) and the tracking mail. Timing: `at` is the read that saw it, "no later
than"; no earlier bound is served, because collectors skip an unchanged
profile and the record's previous read is only a loose lower bound (the
issue's `observed_after` names no served field; the docs say it of `at`).
The console renders the server's text, so it needed an e2e case only.

### Deployed and read back

- **Deploy:** 419734fa (PR #120), stack updated 15:32Z (10:32 AM CT);
  migrations 0192 and 0193 ran (191 already applied).
- **Acceptance (`--acceptance=players,elixir`, the issue's scope), 342
  cases: 316 ok, 18 skipped, 7 known, 1 failed.** gym/289.3 (players_profile
  on #20JJJ2CCRU asserting the "no YearsPlayed badge" note): not this
  change; the account turned one year old (YearsPlayed level 1,
  `account_age_days` 366, profile read 13:27Z), so the note's condition no
  longer holds. Verdict: amended with a `when` on
  `attributes.years_played` null, and 289.5 checks the held-badge branch
  (note absent); both re-run alone: 289.3 skipped, 289.5 ok. Also allowed
  `card_form_unlocked` for the docs catalogue rule, a kind a run's window
  may not hold.
- **Read-back:** `/api/public/status` ok; `/tools.json` 9.14.0;
  `elixir_changelog(since 9.13.0)` serves the 9.14.0 entry;
  `elixir_timeline` accepts `kinds: ["card_form_unlocked"]` (none yet in
  the last day) and carries the ledger-start note; `/docs/timeline/`
  documents the kind; `/updates/2026-09-28-contract-9-14-0/` answers 200.
- **Pending natural check:** the next form unlock on a recorded player
  appears as a `card_form_unlocked` item (and a milestone mail when it is
  Jamie's own or an alt's).

## 2026-09-28 - #111: every timeline item is a story, with an id and a revision (9.15.0)

Lane B, approved in the revisit for storytelling, not only dedupe (Jamie:
"how you tell stories as an agent using the MCP is weak now"). Every
`elixir_timeline` item (and `/api/me/timeline`, which spreads the same
build) carries `id`, the story, and `revision`, how far it has grown,
assigned in `buildTimeline` after the dedupe. The id is `tl_` plus 20 hex
of a sha256 over a namespace and the parts that name the happening; it
names the happening, not the reader, so a member's moment has one id on
the clan's timeline and on the player's own.

- **Ledger moments and attested facts:** the ledger's name plus the row
  id (`player_event`, `clan_event`, `account_event`, `attested_fact`), so
  sequences never collide and none is served raw. A duplicated row (the
  09-14 re-emits, feedback #48) takes the lowest identical row's id:
  `firstEventIds` looks back one day on the window index for a row with
  every typed column equal (a roster move also at the same instant), and
  the in-read collapse keeps the lower of the two. `accountItems` selects
  `event_id` now. Revision 1.
- **Sittings** (`battle_session`, `session_standout` are one story): the
  player's tag and the sitting's first battle, found by a bounded
  recursive walk back (200 steps) while the gap stays under 30 minutes,
  over the player's own battles as the timeline counts them (no boat
  defense, no late capture). Revision: the sitting's battles counted from
  that first battle through the item's last battle; a standout's, through
  the last rung the window learned, so a new rung raises it and a wider
  read of the same rungs does not. Both are in battles, so the two kinds
  of one id compare.
- **Derived items:** `returned` (player, instant), `quiet_crossed`
  (player, rung, instant), `clan_joined`/`clan_left` (player, clan,
  instant); anything unnamed falls back to a hash of its dedupe key (none
  today).
- The member-read note says update on a higher revision, where it said
  keep the newest per kind and `started_at`; the general note states the
  rule; `timeline.md` has the item field table (with `observed_at`, which
  was missing) and "Telling the story". Output schema: `id`, `revision`
  required on items. The tool description is at 599 of 600 characters,
  so the rule rides the notes and the schema.
- **Limits, stated:** an id hashes public parts without a secret, so a
  reader who knows a subject could test guesses at a ledger row id; it
  hides volume and order from a casual reader, which is what the issue
  asked. A genuine repeat of an identical ledger moment within a day (an
  arena bounce with no crossing battle on record) shares the first's id,
  as the read-time dedupe already serves it once. Seen while here, not
  changed: the clan path's member battle fetch does not exclude boat
  defenses, which the player path does (0171).

Tests (scratch database, `timeline-tool.test.mjs`): one sitting through
two overlapping windows has one id (revision 3, then 6); a standout
crossing 20 then 40 battles keeps its id at revision 20 then 40, and the
member's session shares it; a duplicated promotion keeps the lowest row's
id in a window holding either row; one sequence number in three ledgers
gives three ids, none showing the number. MCP 9.15.0, additive; the JSON
API has no timeline operation.

### Deployed and read back

- **Deploy:** 70f11c61 (PR #122), stack updated by 16:08Z (11:08 AM CT);
  migrations 193 applied, 0 ran.
- **Acceptance (`--acceptance=elixir`, the issue's scope), 188 cases: 3
  failed, 12 skipped, 7 known (the pre-existing presence cases, until
  10-02).** gym/302.1, 302.2 and 321.2 asserted the member-read note's old
  wording ("same started_at"); this change is what made them wrong, since
  the note now says a sitting returns under the same id with a higher
  revision. Verdict: amended to match "same id", with a reason; 302.3 (the
  control) amended the same way. All four re-run alone against live: ok.
- **Read-back:** `/api/public/status` ok; `/tools.json` 9.15.0;
  `elixir_changelog(since 9.14.0)` serves the 9.15.0 entry;
  `/docs/timeline/` carries "Telling the story";
  `/updates/2026-09-28-contract-9-15-0/` answers 200. Two overlapping dry
  reads (`days: 1` and `days: 2`, 16:10Z) served every item of the shorter
  window under the same id and revision in the longer one. Tyler's sitting,
  cut at the one-day window's edge (8 battles from 15:56Z), came back whole
  in the two-day read (11 battles from 15:49Z) under one id at revision 11.
  A standout and its session shared an id (Vijay's 43-battle sitting:
  standout revision 40, session 43).
- **Pending natural check:** a live sitting that grows between two reads
  keeps its id and raises its revision.

## 2026-09-28: the agent's participation read fits the cap (#124, 9.16.0)

Jamie decided the size question #46 left open: slim the agent (MCP) read
of `clans_participation` rather than accept the priced refusal. Before,
measured with `{profile_tool}` on the recorded clan (44 members, 17 who
left, 8 weeks, 9 war weeks): full **51,875** characters (refused), compact
**47,044** (956 under the cap).

**Where the characters went (compact):** member rows 30.7k, of which the
repeated keys were 13.2k and `in_clan_at_war_finish` + `role_at_war_finish`
6.7k; former-member rows 9.0k (keys 3.5k, place 2.5k); header, notes and
meta 7.3k. Full adds `war_points` (about 2.9k), `role_changes` (1.3k) and
two notes.

**What changed (MCP only; lossless):** the rows of `members` and
`former_members` are arrays named once by `columns.members` and
`columns.former_members`; an instant on a whole second drops `.000`; and
the two place columns are one, `place_at_war_finish` (the role where
known, else `true`/`false` presence, else `null`), which reads back
exactly because a role is only ever known for a member in the clan
(`role-history.mjs`). The invoker now passes the door (`surface`) to a
tool's context; the handler lays out the table when it is `mcp`.
`participation-table.mjs` holds the codec both ways. `/api/v1` and the
console keep object rows; the shared output schema admits both (rows
`anyOf` an array or the object), which moved the JSON API pin: 2.7.1, no
response change. The acceptance door and the replay door decode the table
to the objects, so every Gym case reads rows by name as before, and the
contract check reads the raw table (notes may name column names).

**Budget test** (`participation-size.test.mjs`): a 50-member clan with 20
departures, eight weeks of battles, donations and war, roles known at
every finish, a third of the members promoted inside the window and nine
joiners mid-window. Its object rows are 62,791 (full) and 54,910
(compact) characters; the agent's table 38,760 and 32,783, under the
40,000 budget the test pins, and the table decodes to exactly the
`/api/v1` rows.

Contract 9.16.0 (a minor: `columns` and `place_at_war_finish` are new;
the reshaping is wire cleanup, stated in `breaking`); JSON API 2.7.1.

**Fix forward, 9.16.1.** The first deploy of 9.16.0 (6b2392f0, PR #125)
laid out the table only when the door was `mcp`; a service token's MCP
calls audit as `svc:<name>` (`handler.mjs`), so the acceptance agent (a
service token) still read object rows: `contracts/clans_participation`
failed (`columns.members missing`) and the eight-week full catalogue cases
still refused at 52,121. The handler now treats `svc:*` as the MCP door
too, and the budget test reads through a `svc:` invoker as well.

Triage, the 9.16.1 deploy (`--acceptance=clans`): `contracts/clans_participation`
and the eight-week full catalogue cases (#0, #1) now pass, so their
known.json entries are removed. `catalogue/clans_participation#notes` and
`#docs` failed because the catalogue compares the notes with the values
it saw, and it saw the decoded objects, which have no
`place_at_war_finish`; both now walk the raw table the door returned too
(acceptance-only, no deploy). `gym/337.1` fails as before: clan
#GRJ20LQP is no longer recorded, unrelated to #124 and already noted on
#46.

## 2026-09-28 - #71's queued secret steps: unsubscribe key and session rotation

Jamie added `unsubscribe_secret` and rotated the session secret
(`session_secret_previous` holds the old value) in the console, then
approved the deploy. Both switches went in ONE deploy, because the new
`session_secret` was already in the secret: a deploy with only the
unsubscribe switch would have re-read it without the previous value and
signed everyone out.

- Deployed from main fc66965d at 18:17Z (1:17 PM CT) with
  `--skip-web --param=UnsubscribeKeyInSecret=true
  --param=SessionSecretPreviousInSecret=true --param=SecretEpoch=2026-09-28`.
  Exit 0, migrations ran 0 of 193, stack UPDATE_COMPLETE, smoke green.
- Read-back (names only, no values): the stack holds the three
  parameters; web-api carries `SESSION_SECRET`, `SESSION_SECRET_PREVIOUS`,
  `UNSUBSCRIBE_SECRET` and `SECRET_EPOCH`; mcp carries the two session
  keys; jobs carries `SESSION_SECRET` and `UNSUBSCRIBE_SECRET`. No errors
  on web-api, mcp or jobs since the flip; `/api/public/status` `ok: true`.
- Pending: Jamie's browser signed in before the rotation stays signed in;
  the first mail after the flip carries an unsubscribe link starting
  `t=u1.`.
- **Due on or after 2026-12-27** (90 days, the token cap): deploy with
  `--param=SessionSecretPreviousInSecret=false`, and only after that
  succeeds remove `session_secret_previous` in the console
  (`docs/SECRETS.md`, "Session secret" step 4).

## 2026-09-28 - Lane C of the 2026-09-27 review: the policy pages restate the service

The privacy and terms pages were agent-written early, with little input,
and had grown far broader than a hobby service needs: an inventory found
about four in ten of their promises were never ratified, and several
were stale. Jamie's direction: what the service does is right; the pages
change, not the code. They are now short and plain, framed as a free
service built as a hobby for folks who like the game, name no person
(contact admin@poapkings.com), and stay general enough that they need
not be revisited with every change. DECISIONS carries the line; they
change only with Jamie's word.

- Fonts are self-hosted: Inter's seven per-script variable subsets (OFL,
  licence beside them) ship from `/assets/fonts/` with the Clash face,
  declared in `packages/design/src/tokens.css`. The Google Fonts links
  are gone from both halves; the CSP's `font-src` and `style-src` are
  `'self'` only; the site test no longer admits a Google origin; and
  `build-site.mjs` fails a build whose stylesheet names a file that did
  not ship.
- Filed: #129 (a withdrawn owner's agents still authenticate; no
  `{account_remove}` op; the sign-in token rides the query string), #130
  (verify challenge reads uncapped per tag; milestone mail's fixed 26 h
  lookback; "Issue a new key" after a revoke is refused), and #131 (the
  copy pass bringing the other pages in line, with /consistency).
- Deploy note: the CSP is in `infra/template.yaml` and the fonts are in
  the site, so this wants a normal deploy (stack and site together, no
  `--skip-web`). A page an edge still holds from before may draw in the
  system font until it expires; nothing breaks. No tool changes, so no
  acceptance family.

## 2026-09-28 - #129: a withdrawn person's agents, removal requests, the sign-in link

Found while restating the policy pages: they promise access "can be
withdrawn" and an account removed on request, and three things stood
between those promises and the code.

- **A withdrawn owner's agents are refused.** Both doors
  (`validateAccessToken`, and the service-token select shared by
  `validateServiceToken` and `serviceTokenAccountByName`) read the
  token's own account and joined the owner only for its quota. Now an
  owned principal validates only while its owner is `approved` too, so a
  withdrawal reads as the ordinary not-found, as a suspended agent does,
  and resuming the owner restores the same keys. `describeRefusedCredential`
  names the refusal `principal_suspended`, not `wrong_door`. Test:
  `services/auth/test/oauth.test.mjs`, failing before the change.
  Integrations have owners too and follow the same rule.
- **Collectors are NOT tied to the owner's status** (unchanged). Whether
  a withdrawal should also drain the person's collectors, or leave them
  to the existing collector revoke, is Jamie's call; asked on #129.
- **`{account_remove}`** (`services/migrate/src/ops-account-remove.mjs`,
  catalogued in the ops skill): dry run by default; by address or
  account id; for the person and every agent they own. Deletes the
  personal rows (listed in the op's comment and ops.md row), stops the
  recordings nobody else wants through `reconcileRecording`, keeps the
  game record and the clan facts the person attested (the op never names
  `attested_fact`: `attested-readers.test.mjs` keeps that table to its
  one reader and one writer), and leaves the account row as an anonymous
  tombstone (`removed:<account_id>`, disabled): a recording's
  `requested_by`, an attested fact's attester and a revoked collector's
  history must point somewhere. Refuses the owner, a non-person, an
  integration's owner, a live collector (revoke first), and a collection
  an integration is granted. Returns `manual`: the Buttondown address,
  and the sent-mail bodies under `mail/sent/` (keys returned; the
  migrate role holds no DeleteObject, so the bodies are deleted by
  hand); call captures expire on their 90-day rule. Running it for real
  is Jamie's, on a person's request (DECISIONS: account-touching write
  ops). Test: `services/migrate/test/ops-account-remove.test.mjs`, a dry
  run and a run against a scratch database.
- **The sign-in link moves to the fragment**, in two steps so no link in
  flight breaks: the console reads `#login_token=` as well as
  `?login_token=` (this PR), the relay then mints the fragment, and one
  link lifetime (15 minutes) later the query form is dropped.
- **Step 1 deployed** 2026-09-28 ~22:02Z (5:02 PM CT) from `00158ef0`
  (PR #133): migrations 193, none new; smoke green; `--acceptance=game`
  87 cases, 0 failed (the acceptance agent's service token, owned by
  the owner, passes the new owner check). The live console bundle reads
  the fragment. The same PR fixed a `participation-size.test.mjs` flake
  (`days_since_battle` stepping between two reads seconds apart).
- **Step 2:** the relay mints `/signin#login_token=` (PR #134).
  Deployed ~22:10Z (5:10 PM CT) from `0af44144`: smoke green, no
  acceptance (no tool changed); the relay function went live 22:09:15Z.
- **Step 3:** the console redeems only `#login_token=`; a stale
  `?login_token=` is scrubbed from the address bar and never redeemed
  (`apps/web/test/url-hygiene.test.js`). Deployed after 22:24:15Z, one
  link lifetime past step 2, so no query-form link was still valid.

## 2026-09-28 - #130: verify read ceiling, milestone lookback, a key after a revoke

Three independent correctness fixes from the review follow-up. No MCP
contract or JSON API change; one migration (0194, a new table).

- **Verify reads have a per-tag daily ceiling.** An open challenge being
  watched asked the live lane every 45 s with no quota hook (about 80
  reads in its hour), and nothing bounded how many challenges one tag
  could collect in a day. `LIVE_READS_PER_TAG_PER_DAY` = 120 in
  `services/web-api/src/routes/verify.mjs`: the sum of `live_reads` over
  every challenge for the tag created in the last 24 hours, whoever
  opened it. Past it, the start and the poll ask nothing, the challenge
  stays open, and the response carries `live_capped: true`, which the
  wizard turns into a note (the check waits for the regular recording).
  The collecting-path profile read is still bounded only by the
  per-hour start limit (5 per tag). Test: `verify.test.mjs`, across a
  re-opened challenge and a second account's challenge, and the reset a
  day later. `/docs/verify` states the number.
- **The milestone window runs from the last clean look.** It read a
  fixed 26 hours ending now, so a failed or skipped stretch longer than
  that lost its moments. 0194 adds `email_milestone_look` (account,
  `looked_at`), stamped when an account's look finishes cleanly
  (nothing new, sent, or already sent; never on a failure, a stop or a
  forced send). The window is 26 hours back from that instant, capped
  at seven days; no row reads the old 26 hours, so the first run after
  the deploy behaves as before. `email_milestone` still decides what is
  news, so the wider window never mails twice. `{account_remove}` deletes
  the new rows. Test: `email-run.test.mjs`, a failed send then two quiet
  days, 52 hours after the moment.
- **Issue a new key after a revoke.** `rotateToken` read the name and
  scope from a live key only and answered `no_active_token`, which the
  console swallowed. It now takes the most recent key, live or revoked,
  and locks the agent's account row so two issues cannot race. The one
  refusal left is `409 name_taken` (a revoked key's name does not hold
  its place, 0056, so another agent may hold it now), with a message the
  console shows beside the button through `useWrite`. Tests:
  `principals.test.mjs` (revoke then issue; the name taken since; a
  stranger's 404), and the e2e journey on an agent's Settings for the
  refused and issued paths.

Ship: stack, jobs, web-api and the site; no acceptance family (no tool
changed).

Shipped in PR #136 (fe391b0f..303a6e0f), deployed with no acceptance
(no tool changed): migrate ran 1 of 194 (0194), stack UPDATE_COMPLETE,
smoke green, site published. Code live 22:42:18Z (5:42 PM CT).
Read-back, reads only: `/api/public/status` `health.ok: true`;
`/docs/verify` states the 120-a-day ceiling, `/docs/agents` the
`409 name_taken`, `/updates` the entry; the rotate route still answers
401 without a session. The first milestone pass on the new code,
23:20Z (6:20 PM CT), logged `recipients` 21, `skipped` 21, `failed` 0,
`ms` 3124 (the look table read and stamped for every account).

Pending (natural events): the first milestone mail sent after a gap
longer than 26 hours; a verification that reaches the ceiling (the
wizard's note), which may never happen in normal use.
