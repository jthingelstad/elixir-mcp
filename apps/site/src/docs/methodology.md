---
slug: methodology
title: "How the numbers are made"
description: "The denominators, level differences and coverage limits in your recorded history."
section: record
order: 9
navTitle: "Methodology"
icon: flask-conical
lede: "How personal history counts games and explains gaps in the record."
---

# How the numbers are made

Elixir describes the histories people ask it to record. A win rate describes those games and their opponents; it is not a prediction or a judgment of player skill. The denominators behind every rate are on [The battle model](/docs/battles#decided-battles-and-denominators).

## Card levels: described, not adjusted for

Every battle side's deck is recorded with each card's level, so the record
can say how far a player's cards were above or below the opponent's: the
`mean_level_gap` field on `battles_decks` and `battles_cards` rows,
`players_summary` decks and `clans_standings` members (`level_gap_battles`
beside it on deck rows and members counts the battles it averages), with
`comparable` and a note when two rows were played at gaps half a level
apart. That is the whole of it. Elixir does **not** serve a
level-expected win rate or a score of a player against one: in matchmade
modes a win rate carries almost no information about the player once the
matchmaker has paired them. Read the gap as a fact about the battles in a
row, never as a judgment of who played them.

## Rival intelligence and coverage

`war_rivals` aggregates recorded river-race observations: races seen, fame,
zero-fame races and seasons spanned. This is observed history, not a forecast.
`races_observed` counts every sighting, the week in progress included;
the fame statistics (`mean_fame`, `median_fame`, `max_fame`,
`zero_fame_races`) pool the finished races only, and `finished_races` is
their count, the denominator to read them over. A rival with no finished
shared race has `null` fame statistics, not zero.

Every response carries [an envelope](/docs/responses) with its computation time.
Subject tools expose history and source freshness where applicable. Check
`elixir_coverage` for measured observation intervals. Missing coverage is unknown,
not evidence of completeness; no recorded battles is not proof of no play. How
often a player is fetched, and why a sitting can still, rarely, roll past
the ~30-entry battle log, is on [Recording and coverage](/docs/recording).
