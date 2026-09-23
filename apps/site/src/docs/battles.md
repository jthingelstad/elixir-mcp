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
| `arena` | `{ id, name }`, the higher side's arena stamped at battle time (4.0.0: the one arena shape, as `trophy_floor.arena` and `modal_arena`); `id` is `null` on a row the id never reached |
| `league_number` | the Path of Legends league when the battle was ranked; `null` otherwise |
| `mode_group` | the contract's fold of `type` (`ladder`, `ranked`, `war`, `casual`, `challenge`, `tournament`, or `other` for a type the fold does not know), the same word `mode` takes as an argument, so no consumer keeps its own copy of the table |
| `context` | full verbosity: the battle's own facts as the log carried them. `event_tag` names the event a challenge or event battle belongs to (joins `game_events` by tag; a battle can name an event the daily events read never sighted); `tournament_tag` the tournament; `ladder_tournament` and `hosted` the API's own flags; `deck_selection` how the deck was chosen. Compact carries `deck_selection` alone, at the top level |
| `deck_selection` | `collection` for the player's own deck; `draft`, `draftCompetitive`, `pick`, `predefined`, `warDeckPick` and the like for a deck chosen on the spot, which has no identity a player will play again. Read it before treating a `deck_hash` as a deck the player owns |
| `boat` | full verbosity, `boatBattle` rows only: `side` (`attacker` or `defender`), `towers_before` and `towers_after` (the clan's towers destroyed on this boat before and after the attack) and `remaining` (the boat's towers still standing) |
| `me` | the asked-about participant: `outcome` (`win`, `loss`, `draw` or `unresolved`), `crowns`, `trophy_change`, `starting_trophies`, `deck_hash`, `deck`, `elixir`, `tower_hp` |
| `teammates`, `opponents` | the other participants, each with `player_tag`, `name`, `name_known`, `crowns`, `deck_hash`, `clan_tag`, `deck`, `elixir`, `tower_hp` |
| `name_known` | `false` when no observation ever carried a name for that tag; `players_names` resolves the ones the corpus knows |
| `rounds_played` | present on duel rows only: how many games the row collapses |
| `rounds[]` | duel rows only: each game's own `crowns`, `tower_hp` and `elixir` (with its own differential) |
| `global_rank` | the global leaderboard position the API reported for that player ON that battle; `null` unless they were ranked then |

`deck` holds the cards as played, with levels on the in-game 1 to 16 scale
and each card's form (see [Deck identity and forms](#deck-identity-and-forms)).

`elixir` is the game's own leaked-elixir counter for **each side**, served
as one object so its caveat travels on the value (6.0.0): `{ leaked,
opponent_leaked, differential, rounds, caveat }`, or `null` when the game
did not report it. `leaked` is the side's own counter; `opponent_leaked`
is the one opponent's on `me` of a head-to-head row (`null` on 2v2, and
always `null` on teammates and opponents, which carry only their own);
`differential` is `leaked` minus `opponent_leaked` on a **single-game**
head-to-head row and `null` on duels; `rounds` is how many games the
counters sum over (a duel's sides each sum two or three games played on
different decks, which is why a duel has no differential and why its
`leaked` is not comparable with a single game's). Read the differential,
never the absolute: at high trophies both players routinely hold elixir
waiting for the other to commit, and both leak, so a player leaking 18 in
a mutual standoff and a player leaking 18 because they misplayed look
identical on their own number. The differential is the better read and
still cannot separate waste from a deliberate hold to react to the
opponent's placement, which would need placement timestamps the API does
not expose. **Neither number is a skill measure**; `caveat` says so on
every object, and the response repeats it in a note whenever the field is
served. Do not describe a player's leak as good or poor play.

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
`elixir` and `tower_hp` and keeps `deck_hash`.

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
`battles_performance({ group_by: "game_mode" })` lists.

## Events are their own group, and they do not inform the meta

Game modes are played as different games. A card that carries a river race
only somewhat predicts Trophy Road and says little about Path of Legends, and
in several modes the player does not choose the deck at all. So Elixir keeps
populations apart rather than pooling them, and the sharpest line is between a
permanent format and a time-bound event.

**The API draws that line itself.** A battle played inside an event carries an
`eventTag`, and a battle in a permanent format never does - `type: trail`
carries one on 100% of 123,562 recorded battles, while `pathOfLegend`, `PvP`,
`riverRacePvP`, `boatBattle`, `friendly` and the duels carry one on 0%. So
`trail` is not a game mode: it is the marker for event content, and the
`gameMode` underneath it says which format the event was running. `tournament`
is the same shape with `tournamentTag`.

Event content is the `event` mode group (6.17.0). `mode: "event"` selects it and
every other `mode` excludes it. Before this it folded into `casual`, which filed
the reworked Seasonal Trophy Road as casual play and pooled a fortnight's 2v2
tournament with ordinary friendlies.

**`event` is a filter, not a population.** One event is not another: `trail`
with `gameMode: TeamVsTeam` alone has carried ten distinct event tags, because
Supercell slots an event into a mode for a date window and reuses the slot
later. Recurring formats are re-tagged every season - one tag ran exactly
2026-08-03 to 2026-09-07, which is season 135 to the day. A rate over event
content must key on `context.event_tag` itself, never on the mode's name.

**What the meta counts.** `battles_meta_decks`, `battles_meta_cards` and the
deck and card statistics are built from a population that excludes:

- **event content** (`event_tag` present). Seasonal Arena II bans the player's
  eight most-won-with cards and floors the rest at Level 15 - its recorded decks
  average 15.87 against 13.67 on Trophy Road - and every event bends the rules
  its own way, so a win rate over them measures the event.
- **a deck the player did not choose** - `deck_selection` outside `collection`
  and `warDeckPick`, which is `eventDeck`, `draft`, `draftCompetitive`, `pick`,
  `quadDeckPick` and `predefined`. A drafted deck is not anyone's choice, so it
  cannot say what people play or how their choices do.

Both remain fully recorded and fully readable through `battles_query` and a
player's own record; they simply do not speak for the game. A `null`
`deck_selection` is kept, because a population is not narrowed on an absence.
The rule holds on every window, a season read from the rollup or a custom
window or segment read raw (6.31.0: the raw reads had kept both), and
`mode: "event"` on the meta tools answers empty with a note saying why.
Everywhere else `event` is the event tag, not a battle type, so
`battles_trends`, `battles_cards`, `cards_synergy`, the card profile and
`battles_opponents` filter and label event battles as `event`, never
`casual` (6.31.0).

## Duels and boat battles

Two `war` battle types are shaped differently from a head-to-head battle.

A **duel** (`riverRaceDuel`, `riverRaceDuelColosseum`) is **one row for up to
three games**. `outcome` is the games won, first to two, not the summed
crowns: a duel won 0-3, 1-0, 1-0 is a win at 2 crowns to 3 (6.21.0; duels
recorded before were recomputed from their rounds). `crowns` is summed across
the rounds, `elixir.leaked` is summed across them, `tower_hp` describes the
final round only, `deck_hash` is `null` because there is no single deck, the
decks sit under `deck.rounds[]` one per round, and `rounds_played` says how
many rounds the row holds.

**`rounds[]` answers for each game** (6.16.0). The API reports every round of a
duel separately, and until 2026-09-22 Elixir recorded the round DECKS and threw
the round RESULTS away - which is why this page used to say a duel's tower
hitpoints "describe the final round only" and that it "has no differential", as
though those were facts about duels rather than limits of the record. A duel row
now carries `rounds[]` beside `deck.rounds[]`, on the same round numbers, each
entry with that game's own `crowns`, `tower_hp` and `elixir` - including a
per-round `differential`, which the summed top-level counter cannot have. So
"how did round two go" is answerable: read `rounds[]` rather than the top-level
values whenever the question is about one game. The history was filled back from
the payload archive (20,218 rounds across 4,362 duels); a duel older than that
sweep has an empty `rounds[]`, and every non-duel row has none at all. `battles_decks`, `battles_cards` and the meta
tools exclude duels for exactly this reason: `battles_decks` itemizes them
under `excluded {duels, no_deck}` and its `total_battles_in_window` is the
head-to-head battles with a deck, the denominator of `share_of_battles`, so
`total_battles_in_window + excluded.duels + excluded.no_deck` is
`battles_performance.battles` over the same window (4.1.0); a note says so
whenever the window held a duel. `battles_opponents` counts a duel once
however many rounds it held.

A **boat battle** (`boatBattle`) is an attack on a static defense, not a
head-to-head match. The record classes every battle as `type_class` `pvp`
(head-to-head) or `boat`, and the tools branch on it. Boat battles are
outside every decided-battle denominator (win rates, crown differentials);
a boat win still counts in `wins`. They are **inside** the war deck counts:
a boat battle spends one of the member's four war decks, so
`war_current.participants[].decks_used`, `war_history.member_weeks[].decks_used`
and `scoring_decks` include them, and `boat_attacks` on the same row says
how many (see [War weeks, points and fame](#war-weeks-points-and-fame)).

## Comparisons, and what a battle proves about its own length

A battle row holds both sides, and most of its numbers only mean something
as a difference. `me.vs` makes them (6.18.0), each as **me minus the one
opponent**:

| field | what it says |
| --- | --- |
| `crowns` | the crown margin |
| `deck_level` | the level edge in THIS battle, from the cards as played - not a career average |
| `starting_trophies` | on ladder, what matchmaking paired you with; on river race rows each side's Trophy Road count, which war matchmaking does not pair on |
| `tower_hp` | hitpoints REMAINING on both sides: a margin of victory only between equal towers |
| `tower_level` | the tower troop's level edge (6.21.0); a tower one level higher starts with more hitpoints (1,564 more across the three towers at 16 against 15), so when this is not `0`, `tower_hp` carries that starting gap too |

`vs` is `null` on 2v2, on duels (whose sides played different decks per
round) and on boat battles (a defense against an attack), and a field is
`null` where the record lacks one side's value. Read
these before the absolute numbers - a leak, a level or a tower total says
little except against the other side's.

**`inferred.duration`** is what the signature PROVES about how long the
battle ran. The log carries no duration; the game's clock supplies the
bound. A King Tower is the only way to end before regulation, and overtime
ends on the next tower, so:

| crown pair | duration | why |
| --- | --- | --- |
| either side has 3 | `at_most_s` 300, no floor | a King Tower fell, so it ended then |
| unequal, neither 3 | `at_least_s` 180, `at_most_s` 300 | no King Tower, so regulation ran; 3:00 or overtime is not recorded |
| level | `exact_s` **300** | overtime expired without a tower falling, and the tower-hitpoints tiebreaker resolved it |

`basis` is the rule that fired: `king_tower_fell`, `regulation_ran` or `overtime_expired`. It is absent on duels (crowns sum over
up to three games) and boat battles (no overtime), and present only on
head-to-head 1v1 types. It is a bound, never a measurement: nothing here
times a battle.

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
  within one mode (pass `mode`) and at similar gaps; the record describes
  the gap and does not adjust for it ([Methodology](/docs/methodology#card-levels-described-not-adjusted-for)).
- `battles_cards` rows carry `modes` (a count per mode group) and
  `mean_level_gap` over the battles the card appeared in; the response
  carries `modes_in_window` (battles and mean gap per mode group over the
  whole window) and `comparable`. A card met mostly in war games inherits
  war's matchmaking, so a "nemesis" table pooled across modes is a mode
  table first; pass `mode` before reading a row as a weakness.
- `battles_performance` carries `trophy_floor` when the window holds ladder
  battles and the arena's floor is known (see `trophy_change` above;
  `floors[]` lists every floor the window stood on, since a climbing player
  stands on several and `floor` is the most recent, with its own counts), and
  with `group_by: "week"` marks every bucket the window clips with
  `partial: true` and `covers {from, to}`: a `days: 30` series usually opens
  on two thirds of a week shaped exactly like the whole ones, and that row
  anchors the trend. Compare partial buckets by `win_rate`, never by
  `battles`, or snap `from`/`to` to Mondays.
- `players_summary` (3.16.0) carries `last_30_days.modes` (the window's
  split), `top_deck.modes` and `dominant_mode` on both decks, and
  `trophy_floor` when the window holds ladder battles; the deck
  comparability note fires when the top and best decks were played in
  different modes or at gaps half a level apart, and the floor note when a
  loss touched the floor.
- `clans_standings` (3.16.0) members carry `modes`, `ladder_battles`,
  `mean_level_gap` (over `level_gap_battles`), `log_recorded` and
  `recorded_since`; the response carries `comparable` (`false` when two
  ranked members' records come predominantly from different modes or from
  gaps half a level apart, the first note naming them) and `basis`
  (`recorded`, or `roster_and_war_only` for an activity-scope clan whose
  members' logs are not recorded, where every count is zero by
  construction for a member whose `log_recorded` is false). `net_trophies`
  (4.0.0; `trophy_net` before) is `null` when `ladder_battles` is 0.
- `battles_trends` (3.16.0) weeks carry `modes` and, when the window clips
  a week, `partial: true` with `covers {from, to}`, the same marks
  `battles_performance` puts on its weekly buckets.

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
- On a weekly row (`battles_performance group_by: "week"`, `battles_trends`),
  `trophy_mode_battles` counts the Trophy Road and Path of Legends battles
  played, and `trophy_battles` the ones for which the game reported a
  trophy delta: a loss standing on an arena floor reports none (see
  `trophy_change` above), so `trophy_battles` can be lower than the
  trophy-mode battles played, and only losses drop out. `net_trophies` sums
  `trophy_battles`. Divide by `trophy_mode_battles` for a ladder record; a
  note names the weeks where the two differ (4.1.0).

The meta tools (`battles_meta_decks`, `battles_meta_cards`, `battles_trends`,
`cards_synergy`) count decided head-to-head **player-battle observations**,
both participants of a match when both are in the segment, and itemize what
the window held and left out in `excluded`. The formulas, priors and floors
are on [How the numbers are made](/docs/methodology#deck-and-card-meta-exactly-what-is-counted).

### The meta against one player's collection

A population's deck sorted by win rate reads as advice, and the population's
holdings are not the caller's: the same eight cards at one player's levels
can be two mean levels below what they have been fielding, or contain a
card they do not own. So the meta tools take **`fit_for`**, a player tag
with a recorded collection, and a recommendation to a person should not omit
it. On `battles_meta_decks` every returned row's cards then carry
`held_level`, and every row carries `fit`:

- `fieldable`, and `missing` — each card not owned or form not unlocked,
  with its reason. **A row the player cannot field is not in `decks[]`**: it
  sits in `unfieldable[]`, the same shape, after sort and limit, so the
  population's ranking is unchanged (raise `limit` for more fieldable rows)
  and an agent cannot recommend what is not in the array.
- `own_mean_level` — the deck at the player's held levels; `vs_fielded` —
  that against `fit_for.fielded_mean_level`, the mean card level of the decks
  the player actually played in the window and mode (the benchmark; null
  with no such battles, and then the gap and the path are null too).
- `upgrades` — what could be: each held card below the fielded level,
  largest deficit first, with `held_level`, `to_level` and `levels`; and
  `mean_level_after_upgrades`, the deck once those are done. A form not
  unlocked is in `missing`, not `upgrades`.

With `fit_for` the reader also says which archetype families, win
conditions and shapes the player already fields (`fit_for.plays`, and
`fit.plays_family` / `fit.plays_win_condition` / `fit.plays_archetype`
on every row; see [Deck archetypes](/docs/archetypes)): the exact shape
costs the least to adopt, then the same win condition in another family.
`battles_meta_cards` with `fit_for` carries `held` on each row (level,
forms unlocked, whether the row's form is unlocked) or null when the card is
not owned. `players_collection` carries the same benchmark as `fielded`
(thirty days). Two things the notes repeat: `mean_level_gap` on a meta row
is the population's players' edge over their opponents, never the caller's
(on `battles_decks` the same name is the caller's); and without `fit_for`
nothing in a meta response checks what any one player holds. Levels are the
1-16 display scale on both sides.

## Deck identity and forms

A deck's identity is `deck_hash`: the SHA-256 hex of
`sort(cards.map(c => id + ":" + (evolutionLevel ?? 0))).join(",") + "|" + (towerTroopId ?? 0)`.
It is built from **card ids, each card's form and the tower troop, never
levels**. Two decks with the same eight names but a different form on one
card, or a different tower troop, are two decks; the same deck at two
different card levels is one. Some event modes field more or fewer than
eight cards; the identity is the exact set played.

A card's **form** is what the API encodes as the bit field `evolutionLevel`
(`1` Evolution, `2` Hero, `3` both, absent or `0` the base card). Every card
object the tools serve spells it as one word, **`form: "base" | "evolution"
| "hero"`** (5.0.0; the integer `evolution` key is retired): on a played
deck's cards in `battles_query`, `battles_decks`, `battles_meta_decks` and
`players_summary`, on `battles_cards` and `battles_meta_cards` rows, and
on `cards_synergy` partners. It is a form discriminator, never a level or a
progress counter, and forms are never merged: the card readers carry one
row per form. On a collection, `maxEvolutionLevel` says which forms exist
for the card and `evolutionLevel` which the player holds; `players_collection`
and `cards_catalog` decode those sets into `forms_available` and
`forms_unlocked`. A card's **type** (troop, building, spell, tower troop) is
not in the API; `cards_catalog` derives it from the id range and serves it
as `type`.

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
policy day's. A war day gives each member four decks; a 1v1 consumes one,
a duel consumes one per round played (two or three) and a boat battle
consumes one, so four decks is anywhere from two to four battles, and a
member at `decks_used: 4` on war day 1 with one duel and one 1v1 in their
log has finished the day.

`boat_attacks` is counted **inside** `decks_used` and `scoring_decks`, and a
boat battle scores on a different scale from a 1v1 or a duel: in one
recorded week the member who spent all four decks on the boat earned 350
points to the 700-800 of the members who spent four on 1v1s. So
`points / scoring_decks` is not comparable between a row with boat attacks
and a row without, and whenever any row in a response carries
`boat_attacks > 0`, a note says so and names who (6.15.0). The record
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
  otherwise (on every row since 6.13.0); on older weeks a `null` `our_rank`
  or `our_fame` means the week was observed without a standings capture, a
  capture gap rather than a zero.
- `finished_early`, true on a regular week whose boat reached the
  10,000-fame line, false when it did not, and `null` on a Colosseum week
  (which has no finish line) or a week observed without a standings
  capture. Decks used after the finish earn zero points, so `decks_used`
  is not the denominator of a points-per-deck rate on a finished week.
- `finish_war_day`, the war day whose close carried the boat over the line,
  from the race's own day-by-day; `null` when the boat did not finish or
  the log does not hold the week. The game banks a boat's progress at each
  war day's close, so a finish is a day close: POAP KINGS closed war day 3
  of 136/0 over the line, its `finish_time` is that close
  (2026-09-13T09:38:04Z), and war day 4 earned 0. `our_fame` on such a
  week can read past 10,000 (10,134): the race log caps a finished boat's
  fame at the line, the live race reports its progress past it, and the
  record keeps the larger.
- `history_starts_at`, the recording horizon, the oldest week the record
  holds for the clan: fewer seasons than requested is coverage, not
  absence. It rides both paths (6.15.0; the exact-week path used to drop
  it), and an exact week the record does not hold answers with empty
  `weeks` and one note saying which side of the horizon it is on: before
  recording began (unrecorded, not a week the clan sat out), after the
  latest recorded week (not yet played or observed), a section no season
  has (sections run 0-4), or a gap inside the recorded span.
- `member_weeks` (with `player_tag`) for one member week by week:
  `war_days_battled` counts the days they fought and `war_days` lists the day
  indices; `null` `war_days_battled` means per-day attendance is unknown for
  that week, not zero. `scoring_decks` is `decks_used` less the decks
  played on the war days after the finish, the denominator for a
  points-per-deck rate: equal to `decks_used` on an unfinished week, `null`
  when the record cannot separate the two (no day-by-day log for the week,
  or no poll saw the days past the finish). It can overstate by a deck where
  a poll missed a day's last battle.

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
  `finish_time` is the war-day close at which the clan's banked fame
  reached the line and `null` for a clan that did not finish: the API marks
  those with an epoch-zero sentinel (`19691231T235959.000Z`), which the
  record stores as observed and never serves as a time. The same rule holds
  on `war_current.standings[]` and `race_finished_at`.
- `days[]`, the race's own day-by-day: the API's `periodLogs`, one entry per
  closed war day (`war_day`, `period_index`) with `standings[]` per clan:
  `points_earned` (that day's score), `progress_start` and `progress_end`
  (boat progress at the day's open and close), `progress_earned`, `rank`
  (the placement at day end, 1-based like every other rank here; `null`
  while unranked), `end_of_day_rank` (the API's own value, 0-based, `-1`
  for not yet ranked), `defenses_remaining` and `progress_from_defenses`.
  `progress_end` is the API's value verbatim, and the API caps it at the
  line on the day a boat finishes: POAP KINGS' war day 3 of 136/0 reads
  `progress_end: 10000` where 6811 + 3000 + 323 = 10134 was banked, and
  war day 4's `progress_start` is 10134. `progress_end_banked` beside it
  (6.15.0) is the banked value on every row - the sum of the row's own
  parts on a capped finishing row, `progress_end` itself everywhere else -
  so an iterator walks one field and never sees fame arrive on a day that
  earned nothing; a note names the clamped rows when the week has any.
  The record has kept the log since 2026-09-17 and the archive backfill
  filled earlier weeks where a race poll carried it; a week with no log
  has `days: []`. A section's fourth day closes as the section rolls, so
  its entry is first seen in the next section's polls and lands a day
  later than the others.

`war_current` carries the same day-by-day for the running week as
`days_closed[]` (full verbosity; the day being fought joins it when it
closes; the same `progress_end_banked` and note), `clan_score` and `repair_points` on every `standings[]` row,
`repair_points` per participant, and `period.api_period_type`, the API's
own word for the day (`training`, `warDay`, `colosseum`) beside the policy
grid's `period.kind`; the two differ only when the clan's reset has drifted
across the boundary. `war_rivals` rows carry each rival's latest observed
`clan_score`.

Once the clan's boat has finished, `war_current` says so: `race_finished_at`
is the finish (a war-day close, as above), `finish_war_day` the day it
closed, and a note names both with the count of decks played on the days
since, which earned nothing. `participants[].scoring_decks` sits beside
`decks_used` with the same meaning as on `war_history.member_weeks[]`: the
denominator for a points-per-deck rate, `null` when the record cannot
separate the decks that scored from the decks that did not.

**War trophies and repair points.** `clan_war_trophies` is the clan's WAR
trophies, and the record keeps the latest observation per race. The race
payload spells it `clanScore`, which is the API overloading that key: a
clan's profile carries BOTH `clanScore` (a five- or six-figure strength
number, ~129,000 for a mid clan) and `clanWarTrophies` (a four-figure war
ladder), and the race reports the second under the first's name. The same
overload is already known on the war leaderboard. So this is NOT the figure
a clan's profile shows as its score, and joining it to `clans_timeline`'s
`clan_score` metric is out by about two orders of magnitude - that timeline
serves `clan_score` and `clan_war_trophies` as separate metrics, and this is
the latter.

`clan_score` on the war surfaces is the same number under the old, wrong
name. It is **deprecated** (6.19.0) and is removed in 7.0.0. `repair_points`
is what repairing the boat cost: per clan on the standings, per member on
participation, MAX-merged like every war counter.

Which day it is, and why a member can appear with more decks than a day
holds, is on [Time and clocks](/docs/clocks#the-policy-day).
