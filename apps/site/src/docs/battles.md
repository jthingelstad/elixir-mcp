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
battle from the player whose log it is; Elixir MCP records both logs when it
has them and folds them into one `battle_id` (a SHA-256 of the canonical
battle time, the sorted participant tags and the battle class), so the same
battle read from two logs is one record with two perspectives. `battles_query`
answers from the perspective of the tag you asked about:

| Field | Meaning |
|---|---|
| `battle_id` | the record's identity; `battles_query({ battle_id })` returns it from every side, and takes the short id or the `url` as well |
| `url` | the battle's public page, `https://elixir.poapkings.com/battle/<short id>`: both decks, the towers and how it ended, readable without signing in (see [A battle's page](#a-battles-page)). The short id is the first 12 characters of `battle_id`, longer only where another recorded battle shares them. It is the link to hand a person for one battle |
| `battle_time` | when it was played, ISO 8601 UTC. Never when it was recorded |
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
Path of Legends (`pathOfLegend`) and the seasonal Trophy Road past 14,000
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

Every battle has a page anyone can open, no account needed: the `url` above,
`/battle/<short id>`. The player whose battle log the record read first is on
the left and the opponent on the right; then both decks as the game lays them
out (each with the game's own copy-deck link, which opens Clash Royale with
the deck ready to save), the towers each side kept, how it ended, the two
sides' numbers next to each other, the left player's session around it when
it holds other battles, and, for a one-on-one battle, the two players' other
recorded meetings when there are any. A duel reads game by game. The page shows
game names only, never a nickname or anything of an account, and its link
unfurls in a chat as the battle itself. The same projection is JSON at
`/api/public/battles/<short id>`.

On the smallest phones, the players' deck panels stack in their existing
order, each keeping two rows of four cards. Larger phones and desktop show
the panels side by side.

Signed out, a battle's page and a shared highlight carry one way in:
**Join Elixir** opens the signup form and **Sign in** the sign-in form,
and either brings you back to the page you were reading. The link names
only the battle or the post, never who sent it to you.

Signed in, **Follow from here** lists the page's players: a shared
highlight's player first, then the rest of its battle; on a battle's page
the left side first, then the right. Each says before the tap whether a
Follow is free or uses one of your player slots ([What a player slot
costs](/docs/recording#what-a-player-slot-costs)), and **Follow** adds
the player as a friend, as Find's Follow does. Your own players are left
out. An account with no player of its own is asked to add it first, as
Find asks.

### Cheers

Signed in, a battle's page has **In your feed** when an item in your own
feed is about this battle: a highlight of it, or a moment it proved, such
as the win that reached a new league. Each takes your cheer and shows its
counts as it does on Home ([Cheers](/docs/timeline#cheers)). A battle with
no such item for you shows no cheers at all, and signed out the page shows
neither cheers nor how many there are. A shared highlight's page (`/h/<id>`)
carries no cheers.

Add `.png` to the link for the battle's picture: the page drawn as one 1200 by
630 image, with the names left and right, both decks two by four with their
levels, the elixir numbers, the towers' hitpoints and how it ended, and the
link under it. It is what the link shows when it unfurls, and it can be posted
on its own with the link beside it. Its time is in UTC, since a picture has no
reader's clock.

### Highlight a battle

On a battle's page, a signed-in person whose own **verified** player played
it can highlight it: write up to 500 characters about it, or nothing, and
choose **Post to your timeline**. The highlight goes on that player's
timeline as this battle with your words, where the people who follow the
player read it ([The timeline](/docs/timeline)). An unverified claim never
lets anyone post as a player ([Verify](/docs/verify)). One highlight per
player per battle; when two of your verified players played it, you choose
which one posts.

Your highlight stays on the battle's page for you: **Edit words** changes
them, **Delete** takes the highlight off the timeline and deletes the words.
Only the account that posted it can change, share or delete it.

**Share** gives the highlight its own link, `/h/<id>`. The id is random and
names only the post, never you or whoever opens it. Anyone with the link can
open it without an account: the player's game name, your words, and the
battle as its own page shows it, both decks, the score and how it ended. It
never shows a nickname, an email or anything of your account. The link
unfurls in a chat with your words, and adding `.png` to it gives the battle's
picture with the player's name, your words and the link. The same post is
JSON at `/api/public/highlights/<id>`. Sharing again gives the same link.
Deleting the highlight makes the link answer "No post at this link" within
about a minute.

### Share with your context

In Stats › Battles, choose a recorded battle. Inspect
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
many rounds the row holds. A `battles_query` answer carries a note saying
so only when its page holds a duel.

**`rounds[]` answers for each game.** The API reports every round of a duel
separately. A duel row carries `rounds[]` beside `deck.rounds[]`, on the same
round numbers, each entry with that game's own `crowns`, `tower_hp` and
`elixir` - including a per-round `differential`, which the summed top-level
counter cannot have. So "how did round two go" is answerable: read `rounds[]`
rather than the top-level values whenever the question is about one game. Some
older duels have no `rounds[]`, and neither does any non-duel row.

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
  [War weeks, points and fame](/docs/decks-and-war#war-weeks-points-and-fame)).
- A boat **defense** is not the defending member's battle: a rival attacked
  their boat and the defense deck answered while they were elsewhere. It is
  left out of that member's battles, wins, losses and streaks everywhere
  (`battles_performance`, `battles_compare`, `battles_trends`,
  `clans_participation` battles, `clans_standings` and a timeline's
  `war.battles`). `battles_query` still returns the row, and its `boat`
  block's `role` says `defender`. `side` is not the player's part: it is
  what the recording log said for its own player, so a defense read from
  the attacker's log says `attacker`.
