---
slug: battles
title: "The battle model"
description: "What one recorded battle holds and from whose side, the seven mode groups and the API battle types each folds, how duels and boat battles are shaped, which battles count as decided and in which denominators, how a deck's identity is computed with card forms, and how war weeks, points and fame relate."
section: record
order: 1
navTitle: "Battle model"
icon: swords
lede: "One row per battle, both sides of it, and the words the numbers are built from."
---

# The battle model

Every battle tool reads the same recorded history and the same row shape. This page is
the vocabulary those tools share: what a row holds, how modes are grouped,
what "decided" means, how a deck gets its identity, and how a war week is
counted. The tools themselves are on [Tools](/docs/tools/battles); how
level gaps and coverage limits are read is on [How the numbers are made](/docs/methodology).

## What a battle record holds

A battle is **one row, seen from both sides**. The game's battle log shows a
battle from the player whose log it is; Elixir MCP records both logs when it
has them and folds them into one `battle_id` (a SHA-256 of the canonical
battle time, the sorted participant tags and the battle class), so the same
battle read from two logs is one record with two perspectives. `battles_query`
answers from the perspective of the tag you asked about:

| Field | Meaning |
|---|---|
| `battle_id` | the record's identity; `battles_query({ battle_id })` returns it from every side, and takes the short id or the `url` as well |
| `url` | the battle's public page, `https://elixir.poapkings.com/battle/<short id>`: both decks, the towers and how it ended, readable without signing in (see [A battle's page](#a-battles-page)). The short id is the first 12 characters of `battle_id`, longer only where another recorded battle shares them. It is the link to hand a person for one battle |
| `battle_time` | when it was played, ISO 8601 UTC. Never when it was captured |
| `battle_time_local` | the same instant as ISO 8601 with a UTC offset (`2026-09-09T23:31:47-05:00`), present when a timezone applies (the account's, or the call's `timezone`) |
| `type` | the API's battle type, exactly as the game names it (`PvP`, `riverRacePvP`, `boatBattle`, ...) |
| `game_mode` | `{ id, name }` of the game mode, in the game's own naming, event modes included |
| `arena` | `{ id, name }`, the higher side's arena stamped at battle time (the same shape as `trophy_floor.arena`); `id` is `null` on a row the id never reached |
| `league_number` | the API's own `leagueNumber` on the battle, passed through unchanged (`null` only when the payload omitted it). The API sends it on battles that are not ranked too (a Trophy Road battle can carry `1`), so it names a Path of Legends league only on a `pathOfLegend` battle, where it is the league the battle started in; elsewhere the record assigns it no meaning |
| `mode_group` | the contract's fold of `type` and the event tag (`ladder`, `ranked`, `war`, `casual`, `challenge`, `event` or `tournament`): a battle carrying an event tag is `event`, except a clanmate battle (`clanMate`, `clanMate2v2`), which is `casual` even when tagged; otherwise friendlies, clanmate battles, an untagged `unknown` battle and any type the fold does not know yet are `casual`, and there is no `other`. It is the same word `mode` takes as an argument, so no consumer keeps its own copy of the table |
| `context` | full verbosity: the battle's own facts as the log carried them. `event_tag` names the event a challenge or event battle belongs to (joins `game_events` by tag; a battle can name an event the daily events read never sighted); `tournament_tag` the tournament; `ladder_tournament` and `hosted` the API's own flags; `deck_selection` how the deck was chosen. Compact carries `deck_selection` alone, at the top level |
| `deck_selection` | `collection` for the player's own deck, `warDeckPick` for a river-race duel deck picked from the player's own war decks (both chosen by the player and kept as stable deck identities); `draft`, `draftCompetitive`, `pick`, `predefined`, `eventDeck` and the like for a deck handed out or drafted on the spot, which has no identity a player will play again. Read it before treating a `deck_hash` as a deck the player owns |
| `boat` | `boatBattle` rows only: `role`, this row's player's own part (`attacker` or `defender`), and `side`, the API's `boatBattleSide` as the log that recorded the battle said it for that log's own player, who may be the other side. Compact keeps those two; full adds `towers_before` and `towers_after` (the clan's towers destroyed on this boat before and after the attack) and `remaining` (the boat's towers still standing). Read `role` to know whether the player attacked or defended |
| `me` | the asked-about participant: `outcome` (`win`, `loss`, `draw` or `unresolved`), `crowns`, `trophy_change`, `starting_trophies`, `clan_tag`, `clan_name`, `deck_hash`, `deck`, `elixir`, `tower_hp` |
| `teammates`, `opponents` | the other participants, each with `player_tag`, `name`, `name_known`, `crowns`, their own `trophy_change` and `starting_trophies`, `deck_hash`, `clan_tag`, `clan_name`, `deck`, `elixir`, `tower_hp` |
| `clan_tag`, `clan_name` | the clan the player was in at battle time, by tag, and that clan's name as last recorded beside it (`null` for a clan the record does not keep) |
| `name_known` | `false` when no observation ever carried a name for that tag; `players_names` resolves the ones the record knows |
| `rounds_played` | present on duel rows only: how many games the row collapses |
| `rounds[]` | duel rows only: each game's own `crowns`, `tower_hp` and `elixir` (with its own differential) |
| `global_rank` | the global leaderboard position the API reported for that player ON that battle; `null` unless they were ranked then |

`deck` holds the cards as played, with levels on the in-game 1 to 16 scale
and each card's `form` (`base`, `evolution` or `hero`) beside the API's raw
`evolutionLevel` it was decoded from (see
[Deck identity and forms](#deck-identity-and-forms)).

`elixir` is the game's own leaked-elixir counter for **each side**, served
as one object so its caveat travels on the value: `{ leaked,
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

### A battle's page

Every battle has a page anyone can open, no account needed: the `url` above,
`/battle/<short id>`. The player whose battle log the record read first is on
the left and the opponent on the right; then both decks as the game lays them
out (each with the game's own copy-deck link, which opens Clash Royale with
the deck ready to save), the towers each side kept, how it ended, the two
sides' numbers next to each other, the left player's session around it and
every recorded meeting of the two. A duel reads game by game. The page shows
game names only, never a nickname or anything of an account, and its link
unfurls in a chat as the battle itself. The same projection is JSON at
`/api/public/battles/<short id>`.

On the smallest phones, the players' deck panels stack in their existing
order, each keeping two rows of four cards. Larger phones and desktop show
the panels side by side.

If you choose **Create your account** from a battle, sign-in returns to that
battle so you can continue reading it with your account.

Add `.png` to the link for the battle's picture: the page drawn as one 1200 by
630 image, with the names left and right, both decks two by four with their
levels, the elixir numbers, the towers' hitpoints and how it ended, and the
link under it. It is what the link shows when it unfurls, and it can be posted
on its own with the link beside it. Its time is in UTC, since a picture has no
reader's clock.

In Ladder ▸ Days played, open a night and choose a captured battle. Inspect
its facts, then choose **Share with your context** for a primary or alt on
your account. Write up to 500 characters about why it mattered, or leave it
blank, and preview the message before copying it or opening your device's
Share sheet. Back keeps your words for editing; Cancel clears the draft.
Clipboard or sharing interruptions keep the preview available for a manual
retry or selection/copy.

Your context travels in the shared message alongside the canonical battle
link. It is not saved on the public page or encoded in its URL; opening the
link alone shows the recorded game facts. Only words you deliberately type
join the message, with no private notes or account details added.

## Mode groups

The `mode` argument on every battle tool takes one of seven groups. Each folds
one or more of the API's battle types; omitting `mode` pools every group.
This table is generated from the contract, so it is what the tools accept.

| Group | In the game | API battle types folded |
|---|---|---|
{%- for m in tools.modes %}
| `{{ m.group }}` | {% if m.group == "ladder" %}Trophy Road{% elif m.group == "ranked" %}Path of Legends{% elif m.group == "war" %}river race battles, duels and boat battles{% elif m.group == "casual" %}2v2, friendly and clanmate battles (a clanmate battle even when it carries an event tag), and the API's rare `unknown` type when it carries none{% elif m.group == "challenge" %}challenges{% elif m.group == "event" %}event content: every battle the API marks with an event tag, except a clanmate battle{% elif m.group == "tournament" %}tournaments{% else %}{{ m.group }}{% endif %} | {% if m.group == "event" %}any type with an `eventTag` but `clanMate` and `clanMate2v2`; in practice `trail`, and `unknown` for events such as Royale Shuffle{% else %}{% for t in m.types | reject("equalto", "trail") %}`{{ t }}`{% if not loop.last %}, {% endif %}{% endfor %}{% endif %} |
{%- endfor %}

`game_mode.name` is finer than the group: an event mode such as a Chaos or
Crazy Mode battle carries an event tag, so it is an `event`-group battle
with its own mode name, which `battles_query({ game_mode })` can
filter by substring and `battles_performance({ group_by: "game_mode" })`
lists. That view is keyed by `(game_mode, type, event_tag)`, so
each event is its own row, with its `event_tag` and `event_title` (the
title the events read listed; `null` when that read never sighted the
event). `event_tag` is `null` on a row that is not event content,
clanmate battles included.

## Events are their own group

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
is the same shape with `tournamentTag`. Some events come as the API's own
`unknown` type with a tag: Royale Shuffle does, and the game lists it under
Game Modes as a timed event.

Event content is the `event` mode group. `mode: "event"` selects it and
every other `mode` excludes it.

**A clanmate battle is casual, even when it carries an event tag.**
About 62% of recorded clanmate friendlies (`clanMate`, `clanMate2v2`) carry
one, because friends play a friendly under an event's rules; it is still a
friendly, so its mode group is `casual`. An `unknown` battle is `event` when it
carries a tag and `casual` when it does not.

**`event` is a filter, not a population.** One event is not another: `trail`
with `gameMode: TeamVsTeam` alone has carried ten distinct event tags, because
Supercell slots an event into a mode for a date window and reuses the slot
later. Recurring formats are re-tagged every season - one tag ran exactly
2026-08-03 to 2026-09-07, which is season 135 to the day. A rate over event
content must key on `context.event_tag` itself, never on the mode's name.
`mode: "event"` still pools every event in the window, so an aggregate read
with it carries a note saying so: split by event before quoting one rate, with
`battles_performance({ group_by: "game_mode" })`, which gives one row per event,
or by reading `context.event_tag` on `battles_query` rows. One event
spread over several game modes is one row per mode there; no row sums one
event across its modes.

## Duels and boat battles

Two `war` battle types are shaped differently from a head-to-head battle.

A **duel** (`riverRaceDuel`, `riverRaceDuelColosseum`) is **one row for up to
three games**. `outcome` is the games won, first to two, not the summed
crowns: a duel won 0-3, 1-0, 1-0 is a win at 2 crowns to 3. `crowns` is summed across
the rounds, `elixir.leaked` is summed across them, `tower_hp` describes the
final round only, `deck_hash` is `null` because there is no single deck, the
decks sit under `deck.rounds[]` one per round, and `rounds_played` says how
many rounds the row holds.

**`rounds[]` answers for each game.** The API reports every round of a duel
separately. A duel row carries `rounds[]` beside `deck.rounds[]`, on the same
round numbers, each entry with that game's own `crowns`, `tower_hp` and
`elixir` - including a per-round `differential`, which the summed top-level
counter cannot have. So "how did round two go" is answerable: read `rounds[]`
rather than the top-level values whenever the question is about one game. Some
older duels have an empty `rounds[]`, and every non-duel row has none at all.

**Each round is a game with its own deck.** A round's eight cards
carry their own `deck_hash`, with no tower troop (the identity every Clan Wars
battle has), and its own result by that round's crowns against the
opponent's. `battles_cards` and `cards_card` count each round as one game.
`battles_decks` keeps its rows to battles with
one deck: it itemizes duels under `excluded {duels, no_deck}` and lists their
round decks apart (`duel_decks`), so `total_battles_in_window +
excluded.duels + excluded.no_deck` is `battles_performance.battles` over the
same window. `battles_opponents` counts a duel once however many
rounds it held.

A **boat battle** (`boatBattle`) is an attack on a static defense, not a
head-to-head match. The record classes every battle as `type_class` `pvp`
(head-to-head) or `boat`, and the tools branch on it. The row has two
sides, and they are not alike:

- A boat **attack** is the attacking member's battle. It is outside every
  decided-battle denominator (win rates, crown differentials); a boat win
  still counts in `wins`. It is **inside** the war deck counts: an attack
  spends one of the member's four war decks, so
  `war_current.participants[].decks_used` and
  `war_history.member_weeks[].decks_used` include it, and `boat_attacks` on
  the same row says how many (see
  [War weeks, points and fame](#war-weeks-points-and-fame)).
- A boat **defense** is not the defending member's battle: a rival attacked
  their boat and the defense deck answered while they were elsewhere. It is
  left out of that member's battles, wins, losses and streaks everywhere
  (`battles_performance`, `battles_compare`, `battles_trends`,
  `clans_participation` battles, `clans_standings` and a timeline's
  `war.battles`). `battles_query` still returns the row, and its `boat`
  block's `role` says `defender`. `side` is not the player's part: it is
  what the recording log said for its own player, so a defense read from
  the attacker's log says `attacker`.

## Comparisons, and what a battle proves about its own length

A battle row holds both sides, and most of its numbers only mean something
as a difference. `me.vs` makes them, each as **me minus the one
opponent**:

| field | what it says |
| --- | --- |
| `crowns` | the crown margin |
| `deck_level` | the level edge in THIS battle, from the cards as played - not a career average |
| `starting_trophies` | on ladder, what matchmaking paired you with; on river race rows each side's Trophy Road count, which war matchmaking does not pair on |
| `tower_hp` | hitpoints REMAINING on both sides: a margin of victory only between equal towers |
| `tower_level` | the tower troop's level edge; a tower one level higher starts with more hitpoints (1,564 more across the three towers at 16 against 15), so when this is not `0`, `tower_hp` carries that starting gap too |

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

- `battles_decks` answers a page at a time: each row names its
  cards in one line (`card_names`, forms prefixed, `tower_troop_name`
  beside it) with its `archetype_label`, `total_decks` counts the whole
  list and `next_offset` starts the next page (null on the last). A row's
  `deck_hash` passed back returns that one deck with its cards, tower troop
  and archetype in full, its share still over the window's battles.
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
  war's matchmaking, so a card table pooled across modes is a mode table
  first; pass `mode` before comparing one row's record with another's.
  A row needs three battles (`applied.min_battles`). Rows come most
  battles first; `sort: "losses"` puts the most battles lost first, ties
  to the most battles, so a single loss never leads the list. Either way
  the rows and their counts are the same; only the order moves.
- `battles_opponents` rows carry `mean_level_gap` too: your deck's
  average card level minus the opposing side's over the battles with
  both recorded, null when none were (a duel has no single deck). Its
  `sort` takes `battles` (the default), `last_seen`, `wins` or `losses`,
  and `min_battles` sets the fewest meetings a row needs.
- `battles_performance` and `battles_compare` take `mode`; with none they
  return the record split per [mode group](#mode-groups) under `modes`
  beside the pooled one, and a note fires whenever the battles span more
  than one group, because the pooled win rate mixes different games. Quote
  a group's line, not the pooled one.
- `battles_performance` carries `trophy_floor` when the window holds ladder
  battles and the arena's floor is known (see `trophy_change` above;
  `floors[]` lists every floor the window stood on, since a climbing player
  stands on several and `floor` is the most recent, with its own counts), and
  with `group_by: "week"` marks every bucket the window clips with
  `partial: true` and `covers {from, to}`: a `days: 30` series usually opens
  on two thirds of a week shaped exactly like the whole ones, and that row
  anchors the trend. Compare partial buckets by `win_rate`, never by
  `battles`, or snap `from`/`to` to Mondays.
- `players_summary` carries `last_30_days.modes` (the window's
  split), `top_deck.modes` and `dominant_mode` on both decks, and
  `trophy_floor` when the window holds ladder battles; the deck
  comparability note fires when the top and best decks were played in
  different modes or at gaps half a level apart, and the floor note when a
  loss touched the floor.
- `clans_standings` members carry `modes`, `ladder_battles`,
  `mean_level_gap` (over `level_gap_battles`), `log_recorded` and
  `recorded_since`; the response carries `comparable` (`false` when two
  ranked members' records come predominantly from different modes or from
  gaps half a level apart, the first note naming them) and `basis`
  (`recorded`, or `roster_and_war_only` for an activity-scope clan whose
  members' logs are not recorded, where every count is zero by
  construction for a member whose `log_recorded` is false). `net_trophies`
  is `null` when `ladder_battles` is 0.
- `battles_trends` weeks carry `modes` and, when the window clips
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
  counts and **do** include boat attack wins, so `wins` can exceed
  `decided_wins`.
- `three_crown_rate = three-crown wins / head_to_head_battles`. Duels and boat
  battles are excluded from both sides.
- `battles` is every recorded battle of the player's own in the window,
  whatever its kind, boat defenses excepted (above), so `battles` minus
  `decided_battles` is draws plus unresolved plus boat attacks.
- Duel crowns are summed over rounds, so `crowns_for` and `crowns_against`
  mix units when a window holds duels; `duel_battles` says how many did.
- On a weekly row (`battles_performance group_by: "week"`, `battles_trends`),
  `trophy_mode_battles` counts the Trophy Road and Path of Legends battles
  played, and `trophy_battles` the ones for which the game reported a
  trophy delta: a loss standing on an arena floor reports none (see
  `trophy_change` above), so `trophy_battles` can be lower than the
  trophy-mode battles played, and only losses drop out. `net_trophies` sums
  `trophy_battles`. Divide by `trophy_mode_battles` for a ladder record; a
  note names the weeks where the two differ.

`battles_trends` counts the selected player or clan members' own battles week by week, every kind except boat defense. Its win rate is `wins / (wins + losses)`; a mode filter keeps different games separate. Clan membership is current at the time of the call, so a historical window describes today's members.

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
and `cards_catalog` decode those sets into `forms_available` and
`forms_unlocked`. A card's **type** (troop, building, spell, tower troop) is
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
  absence. It rides both paths, and an exact week the record does not hold answers with empty
  `weeks` and one note saying which side of the horizon it is on: before
  recording began (unrecorded, not a week the clan sat out), after the
  latest recorded week (not yet played or observed), a section no season
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
by the clan's placement that day on points, not by the points: observed 3,000
for first, 1,800 for second and 1,000 for third. Fame measures where a clan
placed each day; points measure how much it played.

Which day it is, and why a member can appear with more decks than a day
holds, is on [Time and clocks](/docs/clocks#the-policy-day).
