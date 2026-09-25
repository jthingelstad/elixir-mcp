# What the timeline is missing for a record-triggered clan bot — 2026-09-16

**Outcome (2026-09-25):** Jamie said yes to every request and all but one
shipped the same day as contract 3.9.0 (`session_standout`,
`clans_standings` trophy net and current streak, `bracket_observed`,
`kinds`, the member-name defect); `war_day_resolved` (section 4) was not
built by decision. Record: `docs/notes/2026-W38.md`, 2026-09-16.

**Status:** capability requests, not built. Written from the consumer side:
`elixir-mcp-discord` is redesigning its proactive posting so that a
scheduled slot is the exception and every post fires from `elixir_timeline`
through one editor turn per batch
(`../../elixir-mcp-discord/docs/PROACTIVE-2026-09-16.md`). Each request
below names the moment or tool that is missing and is sized from what that
bot does today in tool loops to compensate — the ledger of three live
instances, 2026-09-09 → 09-16.

**The rule these were checked against** (ratified 2026-09-13, not
re-litigated): a timeline row must be something the reader could not have
computed; the clock is the agent's, never the feed's; facts, never
judgments; thresholds are disclosed rungs; a beginner clan must not flood.

Priority order is the order below.

---

## 0. Defect: member moment items lose the member's name

**Observed** on POAP KINGS' clan timeline, 2026-09-16:

> `Tue 22:52 MasteryMinionHorde took MasteryMinionHorde to level 4.`
> `Wed 02:07 Lava Hound unlocked Lava Hound.`

`facts` is `{ player_tag, name: "MasteryMinionHorde", level, prior_level }` —
the badge's name has replaced the member's. In
`services/mcp/src/activity/entries.mjs` the clan entry's member items are
built as `{ player_tag: m.player_tag, name: m.name, ...decorate(kind,
payload) }`, and the badge/card payloads carry their own `name`, which the
spread wins. `itemText` in `summary.mjs` then reads `f.name` for the
member. The same collision shows on a person's own timeline (`member ||
subj` picks the badge name).

**Why it matters for the trigger design:** an editor handed
`badge_earned`, `legendary_badge_earned` or `card_unlocked` cannot say who
without a `clans_roster` drill per item, which is the loop the redesign
exists to remove. `ranked_promotion` and `arena_changed` are unaffected
(their payloads have no `name`).

**Ask:** the payload's name under its own key (`badge`, `card`) for these
kinds, member `name` kept; `itemText` reads the right one. One-line fix
plus the sentence; a contract note since `facts.name` changes meaning for
three kinds.

---

## 1. Session standouts on the clan entry (the movers routine's whole job)

**What the consumer does today.** `notable-movers` (daily 12:30): "name at
most three players whose last 24 hours stood out — a win streak, a notable
trophy swing, a standout record, or a return after being quiet." Of those
four, the timeline carries `returned`. For the other three the bot calls
`clans_roster`, `clans_standings(days: 1)`, then `battles_performance` per
candidate member: **9.9 calls a turn on POAP KINGS, 24 in one run
(2026-09-14), three `battles_performance` failures in another (09-15),
$0.175–0.20 a post**, and `many_calls` friction already filed against
it. `clans_standings`' own description states the gap: *"Trophy swing and
streaks still need a selected member's battles_performance."*

What it produced, every time, was one of three numbers per member: the
session's W-L, its ladder trophy net, and the run of wins inside it.

**What the hub already has.** `buildClanEntry` fetches every member
battle learned in the window (`clan.member_battles`), groups it per player
and runs `sessionsOf` on each — to count `sessions`. The sessions
themselves (`battles, won, lost, drawn, by_mode, trophy_net, open`) are
computed and discarded. A player's own timeline emits them as
`battle_session` items; the clan's does not.

**Ask.**

- `sessionsOf` gains `won_in_a_row` (best run of consecutive wins in the
  session; a counter in the loop that already runs).
- The clan entry gains `standouts.sessions`: closed sessions in the window
  that cross a disclosed rung, capped at `STANDOUT_CAP` (5), ranked by the
  strongest crossing. Rungs, disclosed in the entry like `rungs_days`:
  `won_in_a_row` 5 / 10 / 20; `trophy_net` ±150 / ±300 / ±500; `battles` 20
  / 40 in one session. (Trophy bands are absolute on purpose: a win is
  worth about the same at every ladder floor, so the rungs are invariant
  to arena.)
- Each standout is also an item: kind `session_standout`, section
  `standouts`, `at` = `started_at`, facts = the session shape plus
  `player_tag`, `name`, `won_in_a_row`, and `crossed: ["won_in_a_row>=10",
  "trophy_net>=300"]` so the editor knows why it is there. Text: *"A member
  played 58 battles (34W-24L; 46 ranked), +690 trophies, 8 wins in a row."*
- A session that is still `open` at the window end is not a standout yet;
  it is judged in the window in which it closes. Once-only follows from
  that — a closed session cannot be learned twice.

**Ratified-rule check.** An observation (the record's own battle rows),
not a clock; not judgment (rungs disclosed, "standout" names a crossing,
not a verdict); beginner-safe (the cap and the rungs; a 47-member clan's
last 24 h produced 105 sessions and would have produced perhaps three).
The 09-13 review said streaks were "probably tool territory"; this is the
narrower thing — the session the hub already builds, surfaced when it
crosses a rung — and it is what the bot spends ten calls a day rebuilding.

**Size.** No schema, no ingest change, no new query: the rows are in hand
in `buildClanEntry`; `sessionsOf` and `capList` do the rest. Docs:
timeline.md items table and the clan entry paragraph.

---

## 2. `clans_standings`: trophy net and current streak per member

The drill that goes with request 1. When the editor wants a second look at
a mover, today that is `battles_performance` on each name. The grouped
query in `clans_standings` already joins every member's battles in the
window; it returns W/L/D and win rate.

**Ask:** two columns per member over the same window: `trophy_net` (sum of
`trophy_change` on ladder battles) and `current_streak` (`{kind: "win" |
"loss", length}` from the last battles in order — a window function on the
subquery that is already there). Then the description's own caveat can be
deleted. One query, one call for the whole roster, the drill goes from
N calls to 1.

---

## 3. `bracket_observed`: the five clans of a new war week

**What the consumer does today.** `rival-scout` (Monday 12:00): "scout
this week's war bracket; if the bracket is not known yet, post nothing."
One turn on POAP KINGS: 8 calls (`war_current`, `war_rivals`,
`clans_roster` ×4, `clans_standings`), $0.15. Two turns on the one-member
clans: SKIP, $0.18, because they are never in a race and the calendar
cannot know that.

**The rule, honestly.** The 09-13 review lists "week started" as a clock
fact — never a row. The *time* a week starts is. *Which five clans* the
recorder found when it first saw the new week's `war_week_clan` rows is
not: the reader cannot compute it, it is clan-specific, and it is the same
class of observation as `race_finished`. The proposal is the observation,
named as one.

**Ask:** on the first insert of a (season, section) set for a clan in
`services/ingest/src/war.mjs` — the same edge `week_resolved` uses at the
other end, recency-guarded the same way — a `clan_event` of kind
`bracket_observed` with `{ season_id, section_index, is_colosseum, rivals:
[{tag, name, recorded: bool}] }` (four rivals; `recorded` says whether the
hub has a record to scout). Section `war`. Text: *"Mon 05:03 POAP KINGS'
week 3 bracket: A, B, C, D."* A clan with no race emits nothing, and the
consumer's Monday turn never fires for it.

**If declined:** the consumer arms a timer from `game_clock.week_ends_at`
and needs nothing from the hub. The request stands because the row also
tells a bot on a raceless clan to stay quiet, which the clock cannot.

---

## 4. `war_day_resolved` (optional; already listed as an observation)

The 09-13 review's happenings table has *"war: day result (period points,
standing among five)"* as an observation (O) for a clan; it was not built.
When the next `war_period_anchor` is observed, the previous day's
`period_points` in `war_week_clan` are final and `war_attendance_day` for
that day is complete.

**Ask:** kind `war_day_resolved`, section `war`, `{ war_day, period_points,
place_of_five, decks: { finished, partial, untouched, participants } }`,
on the anchor edge, recency-guarded. Text: *"Thu 05:02 war day 2: 1,410
points, 2nd of five; 31 of 47 played all four decks, 6 untouched."*

**Not** a `war_day_closed` — the close is 10:00Z and stays the clock's.
The consumer's pre-close nudge (`war-deck-check`) stays clock-armed from
`war_day_closes_at`; this row is the morning-after fact it has no way to
post today. Low priority: nothing in the consumer compensates for it yet.

---

## 5. Two volume controls the editor needs on the read

**`kinds` on `elixir_timeline`.** `sections` filters items and entry
sections together; there is no item-kind filter. A consumer that wakes on
twelve kinds and carries four downloads all 26 of a busy day's items to
keep a few, and a 7-day read on a personal account already answers
`result_too_large`. Ask: `kinds: string[]` beside `sections`, items only,
entries untouched.

**Thresholds at the top of the ladder.** The 09-13 review tuned rungs for
beginners; the same 24 h shows the other end. On POAP KINGS: 14
`badge_earned` (mastery level-ups) and 5 `collection_level_step` — one
member stepped 1056 → 1065 in a day, two items, because the step is every
5 at any level. Ask: `collection_level_step` at 5 below 100, 50 to 1,000,
100 above; `badge_earned` only at a mastery's final level or at levels 5
and 10, the rest counted in the entry's `badges` as the review's Tier 2.6
intended. Neither is a contract change beyond the docs' rung sentence.

---

## Already there — no request

The editor's wake list uses these as they are: `member_joined`,
`member_left`, `member_role_changed`, `race_finished`, `week_resolved`
(Colosseum's is the season's war close), `returned`, `quiet_crossed`
(rungs 10 and 20; rung 5 is the consumer's to ignore), `ranked_promotion`
(with `promoted_by`), `arena_changed`, `best_trophies_band`,
`career_wins_step`, `legendary_badge_earned`. War-day open and close, the
ladder season reset and the week's start *time* stay clock facts;
`game_clock` carries them and the consumer arms timers from it.

## Sizing summary

| request | consumer compensation today | after |
|---|---|---|
| 0 name defect | a roster drill per badge/card item, or an unattributed line | none |
| 1 session standouts | 9.9 calls/turn, up to 24, $0.175–0.20/post, daily | 0 calls; a `session_standout` item |
| 2 standings columns | `battles_performance` × N for the second look | 1 call |
| 3 bracket_observed | a Monday turn on every clan, 8 calls or a $0.09 SKIP | a row on clans in a race; silence on the rest |
| 4 war_day_resolved | nothing (the fact is not posted today) | one row per war day |
| 5 kinds + thresholds | 26 items/day downloaded to keep ~5 | ~7 items/day, filtered on the server |
