---
slug: reading-the-numbers
title: "Reading the numbers"
description: "How to read a rate from the record: comparisons, the control next to a number, decided battles and denominators."
section: record
order: 4
navTitle: "Reading the numbers"
icon: scale
lede: "What a comparison can say, the control beside each number, and which battles count in a rate."
guide: battles
---

# Reading the numbers

## Comparisons, and what a battle proves about its own length

A battle row holds both sides, and most of its numbers only mean something
as a difference. `me.vs` makes them, each as **me minus the one
opponent**:

| field | what it says |
| --- | --- |
| `crowns` | the crown margin |
| `deck_level` | the level edge in THIS battle, from the cards as played - not a career average |
| `starting_trophies` | on ladder, what matchmaking paired you with; on river race rows each side's Trophy Road count, which war matchmaking does not pair on; in an event run other than the seasonal Trophy Road (a Classic or 20-Win Challenge), the run's win counter, and `trophy_change` there is +1 a win |
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

`basis` is the rule that fired: `king_tower_fell`, `regulation_ran` or `overtime_expired`. `duration` is `null` on duels (crowns sum over
up to three games) and boat battles (no overtime), and set only on
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
  [mode group](/docs/battles#mode-groups)), `dominant_mode` with its share, and
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
  return the record split per [mode group](/docs/battles#mode-groups) under `modes`
  beside the pooled one, and a note fires whenever the battles span more
  than one group, because the pooled win rate mixes different games. Quote
  a group's line, not the pooled one.
- `battles_performance` carries `trophy_floor` when the window holds ladder
  battles and the arena's floor is known (see
  [`trophy_change`](/docs/battles#what-a-battle-record-holds);
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
  different modes or at gaps half a level apart, a note says when their
  ladder trophy ranges do not overlap, and the floor note fires when a
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
- `battles_performance` `weeks` (with a `segment`) carry `modes` and, when the window clips
  a week, `partial: true` with `covers {from, to}`, the same marks
  it puts on its `group_by: "week"` buckets.

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
  whatever its kind, boat defenses excepted
  ([Duels and boat battles](/docs/battles#duels-and-boat-battles)), so `battles` minus
  `decided_battles` is draws plus unresolved plus boat attacks.
- Duel crowns are summed over rounds, so `crowns_for` and `crowns_against`
  mix units when a window holds duels; `duel_battles` says how many did.
- On a weekly row (`battles_performance` `group_by: "week"`, or its `segment` weeks),
  `trophy_mode_battles` counts the Trophy Road and Path of Legends battles
  played, plus any other battle that reported a trophy delta, and `trophy_battles` the ones for which the game reported a
  trophy delta: a loss standing on an arena floor reports none (see
  [`trophy_change`](/docs/battles#what-a-battle-record-holds)), so `trophy_battles` can be lower than the
  trophy-mode battles played, and only losses drop out. `net_trophies` sums
  `trophy_battles`. Divide by `trophy_mode_battles` for a ladder record; a
  note names the weeks where the two differ.

`battles_performance` with a `segment` counts the selected player or clan members' own battles week by week, every kind except boat defense. Its win rate is `wins / (wins + losses)`; a mode filter keeps different games separate. Clan membership is current at the time of the call, so a historical window describes today's members.
