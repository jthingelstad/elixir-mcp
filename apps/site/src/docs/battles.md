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
| `arena` | the arena id the battle was fought in |
| `league_number` | the Path of Legends league when the battle was ranked; `null` otherwise |
| `me` | the asked-about participant: `outcome` (`win`, `loss`, `draw` or `unresolved`), `crowns`, `trophy_change`, `starting_trophies`, `deck_hash`, `deck`, `elixir_leaked`, `tower_hp` |
| `teammates`, `opponents` | the other participants, each with `player_tag`, `name`, `name_known`, `crowns`, `deck_hash`, `clan_tag`, `deck`, `tower_hp` |
| `name_known` | `false` when no observation ever carried a name for that tag; `players_names` resolves the ones the corpus knows |
| `rounds_played` | present on duel rows only: how many games the row collapses |

`deck` holds the cards as played, with levels on the in-game 1 to 16 scale
and each card's form (see [Deck identity and forms](#deck-identity-and-forms)).
`elixir_leaked` is the game's own leaked-elixir counter for the asked-about
side; `null` when the game did not report it.

`tower_hp` is **hitpoints remaining at the end of the battle**, not tower
level: `{ king, princess: [a, b] }` per side. A destroyed princess tower reads
`0`, and the array is always padded to length 2 (the API omits a destroyed
tower on head-to-head rows and writes `0` on duel rows, so array length was
never a tower count; position carries no meaning). `null` means the game did
not report tower state for that side. `verbosity: "compact"` drops `deck`,
`elixir_leaked` and `tower_hp` and keeps `deck_hash`.

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

Supply `season_id` and `section_index` together to select one exact week.
Without `player_tag`, `member_weeks` then contains every recorded participant
for that week, including their tag, name, points, decks, boat attacks and the
same per-day attendance fields. This is the one-call closed-week roster path.

Which day it is, and why a member can appear with more decks than a day
holds, is on [Time and clocks](/docs/clocks#the-policy-day).
