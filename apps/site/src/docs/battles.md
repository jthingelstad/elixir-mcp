---
slug: battles
title: "The battle model"
description: "What one recorded battle holds and from whose side, the six mode groups and the API battle types each folds, how duels and boat battles are shaped, which battles count as decided and in which denominators, how a deck's identity is computed with card forms, and how war weeks, points and fame relate."
section: record
order: 18
navTitle: "Battle model"
icon: swords
lede: "One row per battle, both sides of it, and the words the numbers are built from."
---

# The battle model

Every battle tool reads the same corpus and the same row shape. This page is
the vocabulary those tools share: what a row holds, how modes are grouped,
what "decided" means, how a deck gets its identity, and how a war week is
counted. The tools themselves are on [Tools](/docs/tools/battles); the
statistics on top of them are on [How the numbers are made](/docs/methodology).

## What a battle record holds

A battle is **one row, seen from both sides**. The game's battle log shows a
battle from the player whose log it is; Elixir MCP records both logs when it
has them and folds them into one `battle_id` (a SHA-256 of the canonical
battle time, the sorted participant tags and the battle class), so the same
battle read from two logs is one record with two perspectives. `battles_query`
answers from the perspective of the tag you asked about:

| Field | Meaning |
|---|---|
| `battle_id` | the record's identity; `battles_query({ battle_id })` returns it from every side |
| `battle_time` | when it was played, ISO 8601 UTC. Never when it was captured |
| `battle_time_local` | the same instant as ISO 8601 with a UTC offset (`2026-09-09T23:31:47-05:00`), present when a timezone applies (the account's, or the call's `timezone`) |
| `type` | the API's battle type, exactly as the game names it (`PvP`, `riverRacePvP`, `boatBattle`, ...) |
| `game_mode` | `{ id, name }` of the game mode, in the game's own naming, event modes included |
| `arena`, `arena_id` | `arena` the arena's name and `arena_id` its id (the higher side's arena, stamped at battle time); `arena_id` is `null` on a row the id never reached |
| `league_number` | the Path of Legends league when the battle was ranked; `null` otherwise |
| `mode_group` | the contract's fold of `type` (`ladder`, `ranked`, `war`, `casual`, `challenge`, `tournament`, or `other` for a type the fold does not know), the same word `mode` takes as an argument, so no consumer keeps its own copy of the table |
| `context` | full verbosity: the battle's own facts as the log carried them. `event_tag` names the event a challenge or event battle belongs to (joins `game_events` by tag; a battle can name an event the daily events read never sighted); `tournament_tag` the tournament; `ladder_tournament` and `hosted` the API's own flags; `deck_selection` how the deck was chosen. Compact carries `deck_selection` alone, at the top level |
| `deck_selection` | `collection` for the player's own deck; `draft`, `draftCompetitive`, `pick`, `predefined`, `warDeckPick` and the like for a deck chosen on the spot, which has no identity a player will play again. Read it before treating a `deck_hash` as a deck the player owns |
| `boat` | full verbosity, `boatBattle` rows only: `side` (`attacker` or `defender`), `towers_before` and `towers_after` (the clan's towers destroyed on this boat before and after the attack) and `remaining` (the boat's towers still standing) |
| `me` | the asked-about participant: `outcome` (`win`, `loss`, `draw` or `unresolved`), `crowns`, `trophy_change`, `starting_trophies`, `deck_hash`, `deck`, `elixir_leaked`, `elixir_leaked_differential`, `tower_hp` |
| `teammates`, `opponents` | the other participants, each with `player_tag`, `name`, `name_known`, `crowns`, `deck_hash`, `clan_tag`, `deck`, `elixir_leaked`, `tower_hp` |
| `name_known` | `false` when no observation ever carried a name for that tag; `players_names` resolves the ones the corpus knows |
| `rounds_played` | present on duel rows only: how many games the row collapses |

`deck` holds the cards as played, with levels on the in-game 1 to 16 scale
and each card's form (see [Deck identity and forms](#deck-identity-and-forms)).

`elixir_leaked` is the game's own leaked-elixir counter for **each side**:
the log row carries both, and every participant object serves its own;
`null` when the game did not report it. `me.elixir_leaked_differential` is
`me` minus the one opponent on a head-to-head row (`null` on duels, 2v2 and
wherever a side did not report). Read the pair, never the absolute: at high
trophies both players routinely hold elixir waiting for the other to
commit, and both leak, so a player leaking 18 in a mutual standoff and a
player leaking 18 because they misplayed look identical on their own
number. The differential is the better read and still cannot separate
waste from a deliberate hold to react to the opponent's placement, which
would need placement timestamps the API does not expose. **Neither number
is a skill measure**, and the response says so in a note whenever the
field is served.

`trophy_change` is the trophies the battle moved, on Trophy Road (`PvP`)
and Path of Legends (`pathOfLegend`) only; other modes carry `null`. On a
Trophy Road **loss** it has a second meaning: every arena has a trophy
floor its players cannot fall below, a loss standing exactly on the floor
comes back from the game with **no `trophyChange` at all** and is served as
`null`, and a loss just above the floor is clamped to it (a `-3` or `-4`
that would have been `-29`). `battles_performance.trophy_floor` names the
floor a player stood on in a window and how many losses touched it, and
`battles_query` says in a note when a page holds such losses. For a player
parked on a floor, wins pay in full and losses cost nothing, so any trophy
sum tracks how recently they played more than how well.

`tower_hp` is **hitpoints remaining at the end of the battle**, not tower
level: `{ king, princess: [a, b] }` per side. A destroyed princess tower reads
`0`, and the array is always padded to length 2 (the API omits a destroyed
tower on head-to-head rows and writes `0` on duel rows, so array length was
never a tower count; position carries no meaning). `null` means the game did
not report tower state for that side. `verbosity: "compact"` drops `deck`,
`elixir_leaked`, `elixir_leaked_differential` and `tower_hp` and keeps
`deck_hash`.

## Mode groups

The `mode` argument on every battle tool takes one of six groups. Each folds
one or more of the API's battle types; omitting `mode` pools every group.
This table is generated from the contract, so it is what the tools accept.

| Group | In the game | API battle types folded |
|---|---|---|
{%- for m in tools.modes %}
| `{{ m.group }}` | {% if m.group == "ladder" %}Trophy Road{% elif m.group == "ranked" %}Path of Legends{% elif m.group == "war" %}river race battles, duels and boat battles{% elif m.group == "casual" %}2v2, friendly and trail battles{% elif m.group == "challenge" %}challenges and events{% elif m.group == "tournament" %}tournaments{% else %}{{ m.group }}{% endif %} | {% for t in m.types %}`{{ t }}`{% if not loop.last %}, {% endif %}{% endfor %} |
{%- endfor %}

`game_mode.name` is finer than the group: an event mode such as a Chaos or
Crazy Mode battle is a `challenge`-group battle with its own mode name, which
`battles_query({ mode_name })` can filter by substring and
`battles_performance({ group_by: "mode" })` lists.

## Duels and boat battles

Two `war` battle types are shaped differently from a head-to-head battle.

A **duel** (`riverRaceDuel`, `riverRaceDuelColosseum`) is **one row for up to
three games**. `crowns` is summed across the rounds, `tower_hp` describes the
final round only, `deck_hash` is `null` because there is no single deck, the
decks sit under `deck.rounds[]` one per round, and `rounds_played` says how
many rounds the row holds. `battles_cards` and the meta tools exclude duels
for exactly this reason; `battles_opponents` counts a duel once however many
rounds it held.

A **boat battle** (`boatBattle`) is an attack on a static defense, not a
head-to-head match. The record classes every battle as `type_class` `pvp`
(head-to-head) or `boat`, and the tools branch on it. Boat battles are
outside every decided-battle denominator; a boat win still counts in `wins`.

## The control next to the number

A win rate is not interpretable without knowing who it was earned against,
and the record knows. **Matchmaking differs by mode**: river race battles
are drawn from the five racing clans, not from players at your trophies,
and a strong player in an ordinary clan routinely meets opponents a level
or more below them there (the record has seen gaps past +4), while Trophy
Road pairs by trophies and rarely hands anyone a full level. So a deck played only
in war looks like a star and a deck played only on ladder looks weak,
whatever their quality; that is the default shape of the data for anyone
who plays both, not an edge case. Every aggregate that serves a win rate
therefore serves the controls beside it:

- `battles_decks` rows carry `modes` (battles, wins and losses per
  [mode group](#mode-groups)), `dominant_mode` with its share, and
  `mean_level_gap`: the deck's average card level minus the opposing
  side's, averaged over `level_gap_battles` (positive means you outlevelled
  them), with `own_mean_level` and `opponent_mean_level` beside it. The
  response carries `comparable`, `false` when two returned decks were
  played predominantly in different modes or at mean gaps half a level
  apart, and the first note then names the rows that clash. Rank decks only
  within one mode (pass `mode`) and at similar gaps; `battles_levels` gives
  the level-expected win rate a gap implies.
- `battles_cards` rows carry `modes` (a count per mode group) and
  `mean_level_gap` over the battles the card appeared in; the response
  carries `modes_in_window` (battles and mean gap per mode group over the
  whole window) and `comparable`. A card met mostly in war games inherits
  war's matchmaking, so a "nemesis" table pooled across modes is a mode
  table first; pass `mode` before reading a row as a weakness.
- `battles_performance` carries `trophy_floor` when the window holds ladder
  battles and the arena's floor is known (see `trophy_change` above), and
  with `group_by: "week"` marks every bucket the window clips with
  `partial: true` and `covers {from, to}`: a `days: 30` series usually opens
  on two thirds of a week shaped exactly like the whole ones, and that row
  anchors the trend. Compare partial buckets by `win_rate`, never by
  `battles`, or snap `from`/`to` to Mondays.
- `battles_levels` monthly points carry the population they were scored in;
  see [How the numbers are made](/docs/methodology#the-level-curve-and-pilot-score).

The notes fire on a detected confound, not as a standing caveat: a
`battles_decks` read within one mode whose decks met similar levels carries
no warning and `comparable: true`.

## Decided battles and denominators

A **decided** battle is a head-to-head battle whose outcome is a win or a
loss. Draws, `unresolved` outcomes (the game reported no winner) and boat
battles are not decided. Every rate a battle tool serves names its
denominator:

- `win_rate = decided_wins / decided_battles`, where
  `decided_battles = decided_wins + decided_losses`. Boat battles and draws
  are outside both sides of that fraction. `wins` and `losses` are the plain
  counts and **do** include boat wins, so `wins` can exceed `decided_wins`.
- `three_crown_rate = three-crown wins / head_to_head_battles`. Duels and boat
  battles are excluded from both sides.
- `battles` is every recorded battle in the window, whatever its kind, so
  `battles` minus `decided_battles` is draws plus unresolved plus boat.
- Duel crowns are summed over rounds, so `crowns_for` and `crowns_against`
  mix units when a window holds duels; `duel_battles` says how many did.

The meta tools (`battles_meta_decks`, `battles_meta_cards`, `battles_trends`,
`cards_synergy`) count decided head-to-head **player-battle observations**,
both participants of a match when both are in the segment, and itemize what
the window held and left out in `excluded`. The formulas, priors and floors
are on [How the numbers are made](/docs/methodology#deck-and-card-meta-exactly-what-is-counted).

## Deck identity and forms

A deck's identity is `deck_hash`: the SHA-256 hex of
`sort(cards.map(c => id + ":" + (evolutionLevel ?? 0))).join(",") + "|" + (towerTroopId ?? 0)`.
It is built from **card ids, each card's form and the tower troop, never
levels**. Two decks with the same eight names but a different form on one
card, or a different tower troop, are two decks; the same deck at two
different card levels is one. Some event modes field more or fewer than
eight cards; the identity is the exact set played.

A card's **form** is a bit field the API calls `evolutionLevel`: `1` is the
Evolution form, `2` the Hero form, `3` both, absent or `0` the base card. It
is a form discriminator, never a level or a progress counter, and forms are
never merged: `battles_cards` and `battles_meta_cards` carry one row per form.
On a collection, `maxEvolutionLevel` says which forms exist for the card and
`evolutionLevel` which the player holds; `players_collection` and
`cards_catalog` decode them into `forms_available` and `forms_unlocked`.

Cards are recorded **as rows, not only as the deck's JSON**: every card a
participant played is a fact of its own, so card questions are indexed
lookups rather than scans of every deck. `battles_query` takes `with_card`
(one id in your deck), `with_cards` (several ids, all present) and
`against_card` (one id in an opponent's deck); `battles_cards`,
`battles_meta_cards` and `cards_synergy` count from the same rows, and a
deck's cards in `battles_decks` and `battles_meta_decks` are the identity's
own (ordered by card id, named from the catalog), not one player's copy.
Card filters match the deck's cards, not the tower troop, and not the
separate rounds of a duel. An empty `cards` list - some event formats
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
policy day's. A war day gives each member four decks; a 1v1 consumes one and
a duel consumes one per round played (two or three), so four decks is
anywhere from two to four battles, and a member at `decks_used: 4` on war
day 1 with one duel and one 1v1 in their log has finished the day.

During a war day, `war_current.standings` also carries `period_points`: the
clan's score in the day currently being fought. `fame` is the cumulative boat
score banked when a day closes. They deliberately do not move together, so on
war day 1 a clan can have non-zero member points and `period_points` while its
banked `fame` is still zero.
Rows restored only from finished race history have `period_points: null`
because that endpoint does not report the former current-day value.

`war_history` returns one row per recorded week with:

- `in_progress`, true while the week is still being fought; on older weeks a
  `null` `our_rank` or `our_fame` means the week was observed without a
  standings capture, a capture gap rather than a zero.
- `finished_early`, true when the boat reached the 10,000-fame line before
  the week ended. Decks used after the finish earn zero points, so per-deck
  arithmetic over such a week is invalid.
- `history_starts_at`, the recording horizon: fewer seasons than requested is
  coverage, not absence.
- `member_weeks` (with `player_tag`) for one member week by week:
  `war_days_battled` counts the days they fought and `war_days` lists the day
  indices; `null` `war_days_battled` means per-day attendance is unknown for
  that week, not zero.

- `closed_at`, the API's own close instant for the week (its
  `createdDate` on the race log), beside `finished`, which is when the
  recorder saw the week closed and so carries polling latency. `closed_at`
  is `null` on weeks older than the log the API still served when the
  column arrived (2026-09-17).
- `our_clan_score` and `our_repair_points`, the clan's own score and repair
  cost that week (see below).

Supply `season_id` and `section_index` together to select one exact week.
Without `player_tag`, `member_weeks` then contains every recorded participant
for that week, including their tag, name, points, decks, boat attacks,
`repair_points` and the same per-day attendance fields. This is the one-call
closed-week roster path. The exact week also carries:

- `standings[]`, every clan in the week's bracket with `fame`, `rank`,
  `trophy_change`, `finish_time`, `clan_score` and `repair_points`.
  `finish_time` is when the clan's boat crossed the line and `null` for a
  clan that did not: the API marks those with an epoch-zero sentinel
  (`19691231T235959.000Z`), which the record stores as observed and never
  serves as a time. The same rule holds on `war_current.standings[]` and
  `race_finished_at`.
- `days[]`, the race's own day-by-day: the API's `periodLogs`, one entry per
  closed war day (`war_day`, `period_index`) with `standings[]` per clan:
  `points_earned` (that day's score), `progress_start` and `progress_end`
  (boat progress at the day's open and close), `progress_earned`, `rank`
  (the placement at day end, 1-based like every other rank here; `null`
  while unranked), `end_of_day_rank` (the API's own value, 0-based, `-1`
  for not yet ranked), `defenses_remaining` and `progress_from_defenses`.
  The record has kept the log since 2026-09-17 and the archive backfill
  filled earlier weeks where a race poll carried it; a week with no log
  has `days: []`. A section's fourth day closes as the section rolls, so
  its entry is first seen in the next section's polls and lands a day
  later than the others.

`war_current` carries the same day-by-day for the running week as
`days_closed[]` (full verbosity; the day being fought joins it when it
closes), `clan_score` and `repair_points` on every `standings[]` row,
`repair_points` per participant, and `period.api_period_type`, the API's
own word for the day (`training`, `warDay`, `colosseum`) beside the policy
grid's `period.kind`; the two differ only when the clan's reset has drifted
across the boundary. `war_rivals` rows carry each rival's latest observed
`clan_score`.

**Clan score and repair points.** `clan_score` is the game's own strength
number for a clan (the `clanScore` the race poll reports per bracket clan,
the same figure a clan's profile shows); it is the number a scout wants
first and the record keeps the latest observation per race. `repair_points`
is what repairing the boat cost: per clan on the standings, per member on
participation, MAX-merged like every war counter.

Which day it is, and why a member can appear with more decks than a day
holds, is on [Time and clocks](/docs/clocks#the-policy-day).
