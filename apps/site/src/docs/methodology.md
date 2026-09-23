---
slug: methodology
title: "How the numbers are made"
description: "The populations, denominators, shrinkage formula and limits behind the meta tools and war participation. Descriptive evidence, not proof of skill or improvement."
section: record
order: 21
navTitle: "Methodology"
icon: flask-conical
lede: "How derived numbers are computed — meta segments, shrinkage, war participation."
---

# How the numbers are made

These tools describe **the recorded sample**. Counts, rates, sorted results and
scores can help an agent investigate a question; they do not establish which
deck is best or whether a player improved. A sample threshold is a display
rule, not a guarantee of reliability.

## What the corpus actually is

It is the matchmaking neighbourhood of the clans and players we record, not a
random sample of the global ladder. Recorded members can have deep histories;
their opponents may appear only once or twice. Players, trophy bands and modes
are unevenly represented. Choose comparable segments and modes explicitly.
Omitting a mode filter pools modes. The meta tools report distinct players but
not a trophy-band composition breakdown or an effective independent sample size.

## Deck and card meta: exactly what is counted

`battles_meta_decks` and `battles_meta_cards` count **player-battle observations**,
not unique matches. If both participants belong to the segment, both contribute.
These observations are dependent: two sides of a match are not two independent
trials, and repeated battles by one player are not independent players.

Only decided **head-to-head** outcomes qualify. Duels (one row for up to three
games, with no single deck identity), boat battles (an attack on a static
defense), draws and unresolved outcomes are excluded from `decided_battles`,
row counts, usage shares, rates and the shrinkage baseline. Each response
itemizes what the window held and left out in `excluded` (`duels`, `boat`,
`draws`, `unresolved`, `no_deck`), so a gap between this tool's denominator and
`battles_performance`'s is self-describing. Deck meta requires a deck hash; card
meta requires a nonempty cards array.

- **Raw win rate:** `wins / (wins + losses)`.
- **Segment win rate:** all eligible wins divided by all eligible wins plus
  losses, before `min_battles`, sorting and the result limit. An empty segment
  returns `null`, not an observed 50%.
- **Prior win rate:** the same quantity over the **whole recorded corpus** for
  the same window and mode, regardless of segment. A segment scoped to one
  player or clan is never shrunk toward its own mean — a one-deck player would
  then be regularized by exactly nothing, and a 4–0 account would read as a
  shrunk 1.000. When the corpus window itself holds fewer than
  {{ statistics.meta.segment_min_decided }} decided observations, a neutral
  0.5 stands in; `prior_basis` says which applied.
- **Shrunk win rate:** `(wins + m × prior_win_rate) / (wins + losses + m)`,
  where `m = {{ statistics.meta.prior_strength }}`; the strength is fixed.
- **Sample floor:** below {{ statistics.meta.segment_min_decided }} decided
  observations the segment carries `insufficient_sample: true` and no
  `shrunk_win_rate` is served on any row. Raw counts and rates remain.
- **Usage share:** the row's eligible observations divided by the segment's
  eligible observations. A battle contains several cards, so card usage shares
  are not parts of a total that sums to 100%.
- **Players:** distinct observed players in that row. One prolific player can
  still dominate a pooled rate. Evolution forms remain separate card rows.

Calculations use unrounded aggregates. Rates and scores are then independently
rounded to three decimals. Recalculating a shrunk rate or score from displayed
rates can differ in the final decimal place.

**Where a season read comes from.** A corpus-wide read whose window is
exactly one season (the default, or `season`) is answered from the season's
rollup rather than a scan of every battle: the same population, counted
by a nightly job that rebuilds the running season from the raw rows and
files an ended season once as final, with an hourly pass adding the
counters (battles, wins, losses) for battles recorded since. Two things
follow, and the response says both in `players_as_of` and a note:
distinct-player counts are as of the last nightly rebuild, so a deck or
card first seen since then carries `players: null` until tonight; and the
counters can trail the record by up to an hour. A corpus read whose
window is not a whole season (`days: 7`, a `from`/`to` pair, "this
week against last") is answered from the season population table: the
same rows the nightly rebuild aggregates, one per participant with its
mode, band and level gap already on it, kept for the running season
and the one before it (so a window may span the roll), filled through
the nightly's cursor. The response names that cursor in a note;
battles recorded since are not in such a read, and a window that
starts past the cursor or reaches a season whose population is gone
scans the raw rows instead. (Until 6.12.0 every sub-season corpus
window scanned the raw rows with a per-row level-gap lookup and timed
out at the query budget.) A segment read (a clan, a
player, a collection) scans the raw rows, exact to the instant, and takes
only the corpus prior from the rollup. The paths answer the same numbers
over the same window; tests hold them equal.

**`verbosity: 'compact'` on the meta tools (6.12.0).** A routine that
compares the field to one clan makes four of these calls, and four full
payloads can cross a turn's ceiling before the report is written. Compact
keeps what a comparison reads - on a deck row `deck_hash`,
`archetype_label`, `card_names` (one string), the counts, `usage_share`,
`win_rate`, `shrunk_win_rate`, `players`, `dominant_mode` and, with
`fit_for`, `fit` without its upgrade path; on a card row the same counts
and rates with `held` - and drops `modes`, the instants, the level gap,
the card objects, the archetype object, the `methodology` block and
`modes_in_window`. The scalars (`decided_battles`, `excluded`,
`comparable`, the sample flags) are the same on both sizes.

**The control next to each meta row (3.16.0).** Every deck and card row
carries `modes` (its decided observations by mode group) and
`mean_level_gap` (the deck's average card level minus the opposing side's,
over the observations where both were known; `level_gap_battles` on deck
rows says how many), and the response carries `comparable`, `false` when
two returned rows were played predominantly in different modes or at gaps
half a level apart, with the first note naming them. With `mode` omitted
the response also carries `modes_in_window` (the window's decided
observations and mean gap per mode group) and a note when the pooled
groups' gaps differ: a card met mostly in war inherits war's matchmaking.
A segment read whose returned rows were all played by one player says so
in a note; those numbers are a few players' habits, not a meta. On the
rollup path the level gap is a nightly sum (a row first seen since the
last rebuild carries `mean_level_gap: null` until tonight); on the raw
path it is computed in the same scan.

**The trophy band (3.16.0).** `trophy_band` on `battles_meta_decks`,
`battles_meta_cards` and `cards_synergy` keeps only the observations whose
own player entered the battle with starting trophies in the band
(`under_5000`, `5000_8000`, `8000_11000`, `11000_13000`, `13000_plus`, the
bands the meta tools speak): the meta at a level, since a deck that
dominates at 13,000 may not exist at 6,000. Bands are Trophy Road
trophies, so a ranked (Path of Legends) observation, which carries a
rating of about 2,300-3,000 and not trophies, sits in no band (6.22.0:
before it, the top-1,000 board filled `under_5000`). A corpus season read answers
from the banded rollup, which the nightly rebuild keeps beside the
unbanded one, once it has been filled for the season; before that (the
first night after the band arrived, or a season the job has not reached)
the read falls back to the raw rows under the query budget and says so in
a note. On a banded read `excluded` still counts the whole season and
mode (a duel or a boat battle has no band of its own); `decided_battles`
and every row are the band's. Observations without starting trophies
(war, casual) are in the unbanded rows only.

This shrinkage moderates extremes; it does **not** guarantee rank order. With a
prior of 80%, a 3–0 record shrinks to about 82.6%, while 60–40 shrinks to
about 63.3%. Neither estimate adjusts for player skill, opposition or deck loyalty.
These tools do not return confidence intervals or within-player causal effects.
Deck meta defaults to a five-observation minimum; card meta defaults to ten.
Callers can change those filters. Returned `methodology` describes the observation
unit, eligible outcomes and prior.

The default meta window is the current season to date ([Seasons](/docs/clocks#seasons)),
which can be expensive under simultaneous load late in a season.
The MCP door cancels over-budget work with `query_timeout` rather than
returning a partial aggregation. Narrow `from`/`to` to reduce the population;
`min_battles` and `limit` filter the result after aggregation and do not make
the scanned population smaller. See [Protocol → Errors](/docs/protocol#errors).
Deck names, forms and tower troops are rendered from the deck's recorded
identity (its card rows and the catalog) after ranking and limiting the
aggregate; no battle payload is re-read.

Within-player, leave-deck-out and leave-card-out lift remain unimplemented design
ideas. They should not be inferred from these pooled fields.

## Card levels: described, not adjusted for

Every battle side's deck is recorded with each card's level, so the record
can say how far a player's cards were above or below the opponent's: the
`mean_level_gap` and `level_gap_battles` fields on `battles_meta_decks`,
`battles_meta_cards`, `players_summary` decks and `clans_standings`
members, with `comparable` and a note when two rows were played at gaps
half a level apart. That is the whole of it. Elixir does **not** serve a
level-expected win rate or a score of a player against one: a year of the
record showed that in matchmade modes a win rate carries almost no
information about the player once the matchmaker has paired them (the
2026-09-19 reviews under `docs/reviews/` in the repository hold the
evidence), and the readers that did so were removed in 5.0.0. Read the gap
as a fact about the battles in a row, never as a judgment of who played
them.

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
