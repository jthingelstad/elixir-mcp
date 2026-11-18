---
slug: battles
title: "The battle model"
description: "What one recorded battle holds and from whose side, the seven mode groups and the API battle types each folds, how duels and boat battles are shaped, which battles count as decided and in which denominators, how a deck's identity is computed with card forms, and how war weeks, points and fame relate."
section: record
order: 3
navTitle: "Battle model"
icon: swords
lede: "One row per battle, both sides of it, and the words the numbers are built from."
guide: battles
---

# The battle model

Every battle tool reads the same recorded history and the same row shape. This page is
the vocabulary those tools share: what a row holds, how modes are grouped,
what "decided" means, how a deck gets its identity, and how a war week is
counted. The tools themselves are on [Tools](/docs/tools/battles); how
level gaps and coverage limits are read is on [How the numbers are made](/docs/methodology).

## What a battle record holds

A battle is **one row, seen from both sides**. The game's battle log shows a
battle from the player whose log it is; Elixir records both logs when it
has them and folds them into one `battle_id` (a SHA-256 of the canonical
battle time, the sorted participant tags and the battle class), so the same
battle read from two logs is one record with two perspectives. `battles_query`
answers from the perspective of the tag you asked about:

| Field | Meaning |
|---|---|
| `battle_id` | the record's identity; `battles_query({ battle_id })` returns it from every side, and takes the short id or the `url` as well |
| `url` | the battle's member page, `https://elixir.poapkings.com/battle/<short id>`: both decks, the towers and how it ended, readable after signing in (see [A battle's page](#a-battles-page)). The short id is the first 12 characters of `battle_id`, longer only where another recorded battle shares them. It is the link to hand a person for one battle |
| `battle_time` | when it was played, ISO 8601 UTC. Never when it was recorded |
| `battle_time_local` | the same instant as ISO 8601 with a UTC offset (`2026-09-09T23:31:47-05:00`), present when a timezone applies (the account's, or the call's `timezone`) |
| `type` | the API's battle type, exactly as the game names it (`PvP`, `riverRacePvP`, `boatBattle`, ...) |
| `game_mode` | `{ id, name }` of the game mode, in the game's own naming, event modes included |
| `arena` | `{ id, name }`, the higher side's arena stamped at battle time (the same shape as `trophy_floor.arena`); `id` is `null` on a row the id never reached |
| `league_number` | the API's own `leagueNumber` on the battle, passed through unchanged (`null` only when the payload omitted it). The API sends it on battles that are not ranked too (a Trophy Road battle can carry `1`), so it names a Ranked league only on a `pathOfLegend` battle, where it is the league the battle started in; elsewhere the record assigns it no meaning |
| `mode_group` | the contract's fold of `type` and the event tag (`ladder`, `ranked`, `war`, `casual`, `challenge`, `event` or `tournament`): a battle carrying an event tag is `event`, except a clanmate battle (`clanMate`, `clanMate2v2`), which is `casual` even when tagged; otherwise friendlies, clanmate battles, an untagged `unknown` battle and any type the fold does not know yet are `casual`, and there is no `other`. It is the same word `mode` takes as an argument, so no consumer keeps its own copy of the table |
| `context` | full verbosity: the battle's own facts as the log carried them. `event_tag` names the event a challenge or event battle belongs to (joins `game_events` by tag; a battle can name an event the daily events read never sighted); `tournament_tag` the tournament; `ladder_tournament` and `hosted` the API's own flags; `deck_selection` how the deck was chosen. Compact carries `deck_selection` alone, at the top level |
| `deck_selection` | `collection` for the player's own deck, `warDeckPick` for a river-race duel deck picked from the player's own war decks (both chosen by the player and kept as stable deck identities); `draft`, `draftCompetitive`, `pick`, `predefined`, `eventDeck` and the like for a deck handed out or drafted on the spot, which has no identity a player will play again. Read it before treating a `deck_hash` as a deck the player owns |
| `boat` | `boatBattle` rows only: `role`, this row's player's own part (`attacker` or `defender`), and `side`, the API's `boatBattleSide` as the log that recorded the battle said it for that log's own player, who may be the other side. Compact keeps those two; full adds `towers_before` and `towers_after` (the clan's towers destroyed on this boat before and after the attack) and `remaining` (the boat's towers still standing). Read `role` to know whether the player attacked or defended |
| `me` | the asked-about participant: `outcome` (`win`, `loss`, `draw` or `unresolved`), `crowns`, `trophy_change`, `starting_trophies`, `clan_tag`, `clan_name`, `deck_hash`, `deck`, `elixir`, `tower_hp` |
| `teammates`, `opponents` | the other participants, each with `player_tag`, `name`, `name_known`, `crowns`, their own `trophy_change` and `starting_trophies`, `deck_hash`, `clan_tag`, `clan_name`, `deck`, `elixir`, `tower_hp` |
| `clan_tag`, `clan_name` | the clan the player was in at battle time, by tag, and that clan's name as last recorded beside it (`null` for a clan the record does not keep) |
| `name_known` | `false` when no reading ever carried a name for that tag; `players_names` resolves the ones the record knows |
| `rounds_played` | present on duel rows only: how many games the row collapses |
| `rounds[]` | duel rows only: each game's own `crowns`, `tower_hp` and `elixir` (with its own differential) |
| `global_rank` | the global leaderboard position the API reported for that player ON that battle; `null` unless they were ranked then |

`deck` holds the cards as played, with levels on the in-game 1 to 16 scale
and each card's `form` (`base`, `evolution` or `hero`) beside the API's raw
`evolutionLevel` it was decoded from (see
[Deck identity and forms](/docs/decks-and-war#deck-identity-and-forms)).

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

`trophy_change` is the trophies the battle moved, on Trophy Road (`PvP`),
Ranked (`pathOfLegend`) and the seasonal Trophy Road past 14,000
(`trail`, game mode Ladder); other modes carry `null`. On a
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

Every recorded battle has a member page at `/battle/<short id>`, the `url`
above. Sign in to open it. The player whose battle log Elixir read first
is on the left, the opponent on the right. Both decks keep the game's two
rows of four cards; a small phone stacks the two panels. Towers, the score,
mode, time and how it ended come from the record. A duel reads game by game.
Missing numbers stay missing. When three crowns prove a missing King Tower
fell, the page marks it `king: 0` with `king_inferred: true`.

The member page also shows recorded meetings and the surrounding session
when available. **Follow from here** lists the players you can follow,
with any slot cost shown before you agree. The member data read is
`/api/me/battles/<short id>`; it requires an account.

**Share this battle** shares this battle directly. It does not ask you to
create a post. The new random `/share/<id>` link opens one battle without
an account: both decks, game names and the recorded game facts, followed by
**Create an account** and **Sign in**. It carries no links into another
battle, session, player or clan's history. Anyone holding it can pass it on.

The link's `.png` picture is 1200 by 630, with the same game facts and
unaltered card art. **Share image** is available after sharing. The member
battle's `.png` picture requires sign-in too. Previous anonymous battle,
session and post links return 404. [Sharing a Timeline item](/docs/timeline#share-a-timeline-item)
explains the audience and lifetime.

### Deck display

Eight-card decks use the game's Evo, Hero and Wild positions: an active Evo
first, a Hero or Champion second, and another Evo, Hero or Champion third.
Other cards fill unused positions in their original order. A Champion keeps
its own name and art. Each duel round is its own deck.

This display order does not show which slots a player has unlocked or
reconstruct an older deck screen. Decks from other formats, including
boat defenses and decks with more special cards than this layout allows,
keep their recorded order. Copy deck keeps the deck's original card order.
The same display rule applies in the Timeline, posts, emails and shared pictures.

### Cheers

A member battle page has **In your feed** when your Timeline contains an
item about it: a post, or a moment the battle proved. These items take
cheers and show counts as on your Timeline. A battle with no such item for
you shows none. Shared pages show no cheers or comments.

<a id="highlight-a-battle"></a>

### Post about a battle

If one of your **verified** players played a battle, you can post about it
from its page. Write up to 500 characters or leave the words empty, choose
the player when more than one of yours played, then tap **Post**. The post
joins that player's Timeline with the battle attached. One post per player
per battle; a post about a battle carries no separate deck or cards.

The same [post check](/docs/limits) applies. **Edit words** changes your
post; **Delete** removes it and its words. Only the author can edit or
delete it. Any member who can see it can **Share** its link. The shared
page shows the words, game names and the attached battle's facts and decks.
An edit updates the shared item; a deletion or moderation hide stops it
opening. It never includes comments or private nicknames.

Once shared, its author may choose **Post in your clan's Discord** when
the clan's leaders have enabled **Shared posts about battles**. It posts
once through the clan's existing webhook, with game name, result, words and
link. No mentions or preview. Later edits or deletion do not change the
message already sent to Discord.

### Share with your context

Share one of your players' recorded battles, then **Share with your
context** offers an optional message draft. Write why it mattered, or leave
the field blank, and preview before copying or opening your device's Share
sheet. Back keeps your words; Cancel clears the draft. Your words travel in
the message beside the opaque battle link. They are not saved in Elixir,
added to its public page or encoded in the URL.

## Opponents

`battles_opponents` groups a player's recorded head-to-head battles by
the player on the other side. It answers "have I met this player before,
and how did it go" in one call; `battles_query`'s `opponent_tag` then
lists those battles one by one.

Each row in `opponents` is one opponent:

- `player_tag`, and `name` when the record has ever held one for that
  tag. `name_known` is false when no recorded battle carried a name;
  `players_names` resolves the ones the record knows.
- `battles`, `wins`, `losses` and `draws`: your record against them in
  the window.
- `first_seen` and `last_seen`: the first and latest battle with them.
- `modes`: the game modes you met them in.
- `clan_tag_last_seen`: their clan at the latest battle, or null.
- `mean_level_gap`: your deck's average card level minus theirs, over the
  battles with both recorded; null when none were, as in a duel (see
  [Reading the numbers](/docs/reading-the-numbers)).

Only head-to-head battles count: a 2v2 teammate is never an opponent, and
a duel counts once however many rounds it held. `distinct_opponents` is
how many players you met in the window and `matching_opponents` how many
passed `min_battles`; `min_battles: 2` keeps only the players you met
more than once. `sort` orders the rows by battles, latest meeting, wins
or losses, and `limit` caps them.

## Mode groups

The `mode` argument on every battle tool takes one of seven groups. Each folds
one or more of the API's battle types; omitting `mode` pools every group.
This table is generated from the contract, so it is what the tools accept.

| Group | In the game | API battle types folded |
|---|---|---|
{%- for m in tools.modes %}
| `{{ m.group }}` | {% if m.group == "ladder" %}Trophy Road{% elif m.group == "ranked" %}Ranked{% elif m.group == "war" %}river race battles, duels and boat battles{% elif m.group == "casual" %}2v2, friendly and clanmate battles (a clanmate battle even when it carries an event tag), and the API's rare `unknown` type when it carries none{% elif m.group == "challenge" %}challenges{% elif m.group == "event" %}event content: every battle the API marks with an event tag, except a clanmate battle{% elif m.group == "tournament" %}tournaments{% else %}{{ m.group }}{% endif %} | {% if m.group == "event" %}any type with an `eventTag` but `clanMate` and `clanMate2v2`; in practice `trail`, and `unknown` for events such as Royale Shuffle{% else %}{% for t in m.types | reject("equalto", "trail") %}`{{ t }}`{% if not loop.last %}, {% endif %}{% endfor %}{% endif %} |
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
only somewhat predicts Trophy Road and says little about Ranked, and
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
many rounds the row holds. A `battles_query` answer carries a note saying
so only when its page holds a duel.

**`rounds[]` answers for each game.** The API reports every round of a duel
separately. A duel row carries `rounds[]` beside `deck.rounds[]`, on the same
round numbers, each entry with that game's own `crowns`, `tower_hp` and
`elixir` - including a per-round `differential`, which the summed top-level
counter cannot have. So "how did round two go" is answerable: read `rounds[]`
rather than the top-level values whenever the question is about one game. Some
older duels have no `rounds[]`, and neither does any non-duel row.

**Other duels.** The API also sends some battles that are not river race
duels as games on round decks: an event's multi-deck mode, the 1v1 Duel
friendly. `battles_query` knows a duel by its round decks as well as by its
type, so these rows read like a river race duel: `deck.rounds[]` and
`rounds[]`, the leak summed with no differential, and no `vs`. Their
`outcome` is decided by games won only on the two river race types; on any
other it is the trophy change, else the summed crowns. `battles_decks`,
`battles_performance` and `battles_cards` know them the same way: such a
battle counts as a duel, out of the head-to-head and three-crown counts,
and its round decks are games in its own mode group (`event` for an
event's multi-deck mode), never pooled with a river race duel's.

**Each round is a game with its own deck.** A round's eight cards
carry their own `deck_hash`, with no tower troop (the identity every Clan Wars
battle has), and its own result by that round's crowns against the
opponent's. `battles_cards` counts each round as one game.
`battles_decks` keeps its rows to battles with
one deck: it itemizes duels under `excluded {duels, no_deck}` and lists their
round decks apart (`duel_decks`, one row per deck per mode group, its `mode`
beside it), so `total_battles_in_window +
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
  [War weeks, points and fame](/docs/decks-and-war#war-weeks-points-and-fame)).
- A boat **defense** is not the defending member's battle: a rival attacked
  their boat and the defense deck answered while they were elsewhere. It is
  left out of that member's battles, wins, losses and streaks everywhere
  (`battles_performance`, `battles_compare`,
  `clans_participation` battles, `clans_standings` and a timeline's
  `war.battles`). `battles_query` still returns the row, and its `boat`
  block's `role` says `defender`. `side` is not the player's part: it is
  what the recording log said for its own player, so a defense read from
  the attacker's log says `attacker`.
