---
slug: decks-and-war
title: "Decks and war"
description: "Deck identity and card forms in the record; war weeks, points and fame."
section: record
order: 5
navTitle: "Decks and war"
icon: swords
lede: "How the record names a deck and its forms, and how war weeks, points and fame are kept."
guide: battles
---

# Decks and war

## Deck identity and forms

A deck's identity is `deck_hash`: the SHA-256 hex of
`sort(cards.map(c => id + ":" + (evolutionLevel ?? 0))).join(",") + "|" + (towerTroopId ?? 0)`.
It is built from **card ids, each card's form and the tower troop, never
levels**. Two decks with the same eight names but a different form on one
card, or a different tower troop, are two decks; the same deck at two
different card levels is one. The API reports no tower troop on a river
race battle, so a war deck hashes with `0` in that place: the same eight
cards played in war and on Trophy Road are two `deck_hash` values. Some
event modes field more or fewer than eight cards; the identity is the exact
set played.

A card's **form** is what the API encodes as the bit field `evolutionLevel`
(`1` Evolution, `2` Hero, `3` both, absent or `0` the base card). Every card
object the tools serve spells it as one word, **`form: "base" | "evolution"
| "hero"`**: on a played
deck's cards in `battles_query`, `battles_decks` (one deck by `deck_hash`),
`players_summary`, and on `battles_cards` rows. It is a form discriminator, never a level or a
progress counter, and forms are never merged: the card readers carry one
row per form. On a collection, `maxEvolutionLevel` says which forms exist
for the card and `evolutionLevel` which the player holds; `players_collection`
decodes those sets into `forms_available` and `forms_unlocked`, and
`cards_catalog` serves `forms_available`. A card's **type** (troop, building, spell, tower troop) is
not in the API; `cards_catalog` derives it from the id range and serves it
as `type`.

Cards are recorded **as rows, not only as the deck's JSON**: every card a
participant played is a fact of its own, so card questions are indexed
lookups rather than scans of every deck. `battles_query` takes `with_card`
(one id in your deck), `with_cards` (several ids, all present) and
`against_card` (one id in an opponent's deck); `battles_cards`,
`cards_card` read those rows, and a
deck's cards in `battles_decks` are the identity's
own (ordered by card id, named from the catalog), not one player's copy.
Card filters match the deck's cards, not the tower troop; a duel matches on
any one round's deck. An empty `cards` list - some event formats
disclose no deck - has no `deck_hash`.

Levels are served on the **in-game 1 to 16 scale** everywhere in the recorded
tools: a level-16 card is maxed whatever its rarity. The API itself counts
levels relative to rarity (a maxed legendary reads 8 of 8), and
`cards_catalog` carries both maxima as `maxLevel` and `maxLevelRarityScale`;
`live_fetch` returns the raw payload, so levels there are rarity-relative.

## War weeks, points and fame

A river race is scored twice, and the two numbers are not interchangeable.
**Points** are what each member contributes: `war_current` and `war_history`
list them per member as `points`, with `decks_used`. **Fame** belongs to the
boat, the clan as a whole: the standings show each clan's fame and the
week's finish line is a fame total. Dividing a clan's fame among its members
is not a computation the record supports, and it is never done here.

`decks_used` counts **decks, not battles, over the race week**:
`war_current.participants[].decks_used` and `war_history.member_weeks[].decks_used`
are the week's cumulative count, while `war_current.decks_today` is this
policy day's. A war day gives each member four decks; a 1v1 consumes one,
a duel consumes one per round played (two or three) and a boat battle
consumes one, so four decks is anywhere from two to four battles, and a
member at `decks_used: 4` on war day 1 with one duel and one 1v1 in their
log has finished the day.

**War facts are weekly.** Every per-member war figure
is the game's own counter for the race week: `decks_used`, `points`,
`boat_attacks` and `repair_points`. The API does not say which day a war
deck was played, and each race rolls its day at its own moment in the half
hour before 10:00 UTC, so putting a deck on a day means guessing where the
rollover fell. One clan's rollover can be calibrated; across every clan
Elixir records it cannot be placed reliably. So no tool splits a week by
war day: there is no per-day attendance, no training-day total, and no
count of the decks played after the finish. `war_current.decks_today` is
the one day-sized figure, for the day still being played: the game's own
`decksUsedToday` counter for the current day, as the last race poll
recorded it ([Time and clocks](/docs/clocks#the-policy-day)).

**Training days are recorded too.** A member battles
with the same four war decks all week. On a war day each deck can be played
once and it scores; the three training days before are where members get
reps in with those decks, up to four a day, for no points. Elixir keeps
every day of the race week the same way. On a training day
`war_current.decks_today` (with `day_kind: "training"`) lists who has played
and how many decks so far today, the same untouched, partial and finished
lists a war day has. Training decks earn no points and are not in
`decks_used`, and a nudge toward decks that score belongs to
`day_kind: "war"`. No weekly training total is served: it would split the
week at the rollover from the last training day to war day 1 (above).
`decks_today` carries `day_in_section` and `training_day` on a training day.

`boat_attacks` is counted **inside** `decks_used`, and a
boat battle scores on a different scale from a 1v1 or a duel: in one
recorded week the member who spent all four decks on the boat earned 350
points to the 700-800 of the members who spent four on 1v1s. So a
points-per-deck figure is not comparable between a row with boat attacks
and a row without, and whenever any row in a response carries
`boat_attacks > 0`, a note says so and names who. The record
holds `boat_attacks` as the game's weekly counter, not per day, so no
"PvP-only" denominator is served; `decks_used - boat_attacks` is the
caller's one subtraction for a comparable rate on an unfinished week.

During a war day, `war_current.standings` also carries `period_points`: the
clan's score in the day currently being fought. `fame` is the cumulative boat
score banked when a day closes. They deliberately do not move together, so on
war day 1 a clan can have non-zero member points and `period_points` while its
banked `fame` is still zero.
Rows restored only from finished race history have `period_points: null`
because that endpoint does not report the former current-day value.

`war_history` returns one row per recorded week with:

- `in_progress`, true while the week is still being fought and false
  otherwise; a `null` `our_rank`
  or `our_fame` means the week was seen without a standings reading, a
  recording gap rather than a zero.
- `finished_early`, true on a regular week whose boat reached the
  10,000-fame line, false when it did not, and `null` on a Colosseum week
  (which has no finish line), a week still being fought, or a week seen
  without a standings recording. Decks used after the finish earn zero points, so `decks_used`
  is not the denominator of a points-per-deck rate on a finished week.
- `finish_war_day`, the war day whose close carried the boat over the line,
  from the race's own day-by-day; `null` when the boat did not finish or
  the log does not hold the week. The game banks a boat's progress at each
  war day's close, so a finish is a day close: a clan closed war day 3
  of Season 136, week 1 over the line, its `finish_time` is that close
  (2026-09-13T09:38:04Z), and war day 4 earned 0. `our_fame` on such a
  week can read past 10,000 (10,134): the race log caps a finished boat's
  fame at the line, the live race reports its progress past it, and the
  record keeps the larger.
- `history_starts_at`, the recording horizon, the oldest week the record
  holds for the clan: fewer seasons than requested is coverage, not
  absence. It rides both paths, and an exact week the record does not hold answers with empty
  `weeks` and one note saying which side of the horizon it is on: before
  recording began (unrecorded, not a week the clan sat out), after the
  latest recorded week (not yet played or seen), a section no season
  has (sections run 0-4), or a gap inside the recorded span.
- `member_weeks` (with `player_tag`) for one member week by week: the
  game's weekly counters `points`, `decks_used`, `boat_attacks` and
  `repair_points`, never split by war day (above). On a finished week
  `decks_used` includes the decks played after the finish, which earned
  nothing, so it is not the denominator of a points-per-deck rate there.

- `closed_at`, the API's own close instant for the week (its
  `createdDate` on the race log), beside `finished`, the close instant the
  record serves: the API's own stamp wherever the record holds one (equal to
  `closed_at`), otherwise when the recorder saw the week closed. `closed_at`
  is `null` on weeks the record holds without the API's stamp.
- `our_clan_war_trophies` (the clan's war trophies going into the race) and
  `our_repair_points`, the boat's repair cost that week (see below).

Supply `season_id` and `section_index` together to select one exact week.
Without `player_tag`, `member_weeks` then contains every recorded participant
for that week, including their tag, name, points, decks, boat attacks and
`repair_points`. This is the one-call
closed-week roster path. The exact week also carries:

- `standings[]`, every clan in the week's bracket with `fame`, `rank`,
  `trophy_change`, `finish_time`, `clan_war_trophies` and `repair_points`.
  `finish_time` is the war-day close at which the clan's banked fame
  reached the line and `null` for a clan that did not finish: the API marks
  those with an epoch-zero sentinel (`19691231T235959.000Z`), which the
  record stores as seen and never serves as a time. The same rule holds
  on `war_current.standings[]` and `race_finished_at`.
- `days[]`, the race's own day-by-day: the API's `periodLogs`, one entry per
  closed war day (`war_day`, `period_index`) with `standings[]` per clan:
  `points_earned` (that day's score), `progress_start` and `progress_end`
  (boat progress at the day's open and close), `progress_earned`, `rank`
  (the placement at day end, 1-based like every other rank here; `null`
  while unranked), `end_of_day_rank` (the API's own value, 0-based, `-1`
  for not yet ranked), `defenses_remaining` and `progress_from_defenses`.
  `progress_end` is the API's value verbatim, and the API caps it at the
  line on the day a boat finishes: a clan's war day 3 of Season 136, week 1 reads
  `progress_end: 10000` where 6811 + 3000 + 323 = 10134 was banked, and
  war day 4's `progress_start` is 10134. `progress_end_banked` beside it
  is the banked value on every row - the sum of the row's own
  parts on a capped finishing row, `progress_end` itself everywhere else -
  so an iterator walks one field and never sees fame arrive on a day that
  earned nothing; a note names the clamped rows when the week has any.
  A week the record holds no day log for has `days: []`. A section's fourth day closes as the section rolls, so
  its entry is first seen in the next section's polls and lands a day
  later than the others.

`war_current` carries the same day-by-day for the running week as
`days_closed[]` (full verbosity; the day being fought joins it when it
closes; the same `progress_end_banked` and note), `clan_war_trophies` and `repair_points` on every `standings[]` row,
`repair_points` per participant, and `period.api_period_type`, the API's
own word for the day (`training`, `warDay`, `colosseum`) beside the policy
grid's `period.kind`; the two differ only when the race's reset has drifted
across the boundary. `war_rivals` rows carry each rival's war trophies going
into the latest race the record holds with them (`clan_war_trophies`), and
their effort from the day logs: `mean_points` is the rival's points
per finished week, `points_weeks` how many weeks that averages, and
`points_vs_ours` the rival's points over ours across the weeks the record
holds both. A rival with `points_weeks` 0 has no day log recorded, not zero
effort.

Once the clan's boat has finished, `war_current` says so: `race_finished_at`
is the finish (a war-day close, as above), `finish_war_day` the day it
closed, and a note names both: decks played after the finish earned
nothing, so `participants[].decks_used` is not the denominator of a
points-per-deck rate that week.

**War trophies and repair points.** `clan_war_trophies` is the clan's WAR
trophies as the race payload carries them during the week, going into that
race: the week's own `trophy_change` is not included, so after a closed week
the clan stood at `clan_war_trophies + trophy_change`, the next week's figure.
The race payload spells it `clanScore`, which is the API overloading that key: a
clan's profile carries BOTH `clanScore` (a five- or six-figure strength
number, ~129,000 for a mid clan) and `clanWarTrophies` (a four-figure war
ladder), and the race reports the second under the first's name. So this is NOT the figure
a clan's profile shows as its score, and joining it to `clans_timeline`'s
`clan_score` metric is out by about two orders of magnitude - that timeline
serves `clan_score` and `clan_war_trophies` as separate metrics, and this is
the latter. `war_history`'s weeks carry it as `our_clan_war_trophies`.
`repair_points` is what repairing the boat cost: per clan on the standings,
per member on participation, MAX-merged like every war counter.

**Fame is paid for placement.** A war day's fame (`progress_earned`) is paid
by the clan's placement that day on points, not by the points: seen 3,000
for first, 1,800 for second and 1,000 for third. Fame measures where a clan
placed each day; points measure how much it played.

Which day it is, and why a member can appear with more decks than a day
holds, is on [Time and clocks](/docs/clocks#the-policy-day).
