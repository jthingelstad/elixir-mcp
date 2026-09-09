---
slug: methodology
title: "How the numbers are made"
navTitle: "Methodology"
description: "The populations, denominators, shrinkage formula and limits behind the meta tools and Pilot Score. Descriptive evidence, not proof of skill or improvement."
order: 41
section: data
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
  `shrunk_win_rate` is served on any row — the same rule `battles_levels`
  applies before it serves a Pilot Score. Raw counts and rates remain.
- **Usage share:** the row's eligible observations divided by the segment's
  eligible observations. A battle contains several cards, so card usage shares
  are not parts of a total that sums to 100%.
- **Players:** distinct observed players in that row. One prolific player can
  still dominate a pooled rate. Evolution forms remain separate card rows.

Calculations use unrounded aggregates. Rates and scores are then independently
rounded to three decimals. Recalculating a shrunk rate or score from displayed
rates can differ in the final decimal place.

This shrinkage moderates extremes; it does **not** guarantee rank order. With a
prior of 80%, a 3–0 record shrinks to about 82.6%, while 60–40 shrinks to
about 63.3%. Neither estimate adjusts for player skill, opposition or deck loyalty.
These tools do not return confidence intervals or within-player causal effects.
Deck meta defaults to a five-observation minimum; card meta defaults to ten.
Callers can change those filters. Returned `methodology` describes the observation
unit, eligible outcomes and prior.

Within-player, leave-deck-out and leave-card-out lift remain unimplemented design
ideas. They should not be inferred from these pooled fields.

## The Level Curve and Pilot Score

`battles_levels` and `clans_pilot_scores` use the same level inputs and population
query. A qualifying recorded PvP battle has exactly two participants on opposing
sides, both with known deck-average levels and opposite decided outcomes.
Partial multiplayer records do not qualify. Each match contributes two
player-battle observations, one from each perspective.

Deck-average levels are stamped at ingest to two decimal places. The curve bins
the difference between those averages and computes each bin's observed win rate.
The personal tool can filter by mode and starting-trophy band; **both participants
must pass the filters**. The clan tool uses the unfiltered corpus. Scores from
different populations are not directly comparable. Returned gap ranges show
the minimum and maximum observed gaps within each bin, not confidence limits.

For a player's qualifying battles in bins that meet the curve floor:

`pilot_score = actual_win_rate − mean(level-bin win rate)`

A score of `0.05` means five percentage points above this fitted baseline. It is
a **descriptive in-sample residual**, not a measurement of skill or the causal
benefit of upgrading cards. The scored player's own observations contribute to
the baseline. Mode, opposition, experience, deck choice and recording coverage
can all influence the result.

| Display rule | Minimum |
| --- | --- |
| Curve bin | {{ statistics.pilot.curve_min_observations }} player-battle observations |
| Player or clan-member score | {{ statistics.pilot.player_min_battles }} battles in supported bins |
| Monthly trend point | {{ statistics.pilot.monthly_min_battles }} battles in supported bins |

Monthly points are returned only for a player who qualifies for an overall
score. They reuse the whole requested window's fitted curve; they are not
independently fitted monthly models. A missing point means insufficient scored
observations, not zero performance. The public table's floors are generated
from the same method declarations used by the readers.

### What `standard_error` means

For compatibility, this field remains `0.5 / sqrt(n)`. It is the maximum
binomial standard error of a win proportion **under independent-trial
assumptions**. This follows from the binomial variance formula with `p = 0.5`;
see the [NIST binomial distribution reference](https://itl.nist.gov/div898/handbook/eda/section3/eda366i.htm).

It is **not a calibrated error estimate or confidence interval for Pilot Score**.
It excludes uncertainty in the fitted curve and dependence between observations.
Do not present score ± this number as a confidence interval or use it to claim
statistical significance. Both score tools return a `methodology` block that
states the formula, floors and limitations.

### Reading changes and cohort comparisons

The curve is refit over a rolling window on each call, so a score can move
without another battle from the player. Clan `basis` counts describe volume and
window boundaries; **unchanged counts do not identify an unchanged curve**.
Different observations and win rates can produce the same counts. Neither
changed nor unchanged counts alone attribute a score change to the player.

The optional experience cohort groups players by known YearsPlayed tenure and
requires at least five qualifying players. Its percentile is the fraction whose
rounded score is strictly below the focused player's score, including that
player in the cohort denominator; ties are not counted as below. The median
averages the two middle rounded scores for an even-sized cohort. Tenure matching
does not control for opposition, mode, deck or spending. Missing tenure remains
unknown. A rising score or percentile is a reason to investigate, not proof of
improvement or spending independence.

## Rival intelligence and coverage

`war_rivals` aggregates recorded river-race observations: races seen, fame,
zero-fame races and seasons spanned. This is observed history, not a forecast.

Every response carries [an envelope](/docs/responses) with its computation time.
Subject tools expose history and source freshness where applicable. Check
`elixir_coverage` for measured observation intervals. Missing coverage is unknown,
not evidence of completeness; no recorded battles is not proof of no play. How
often a player is fetched, and why a burst can still roll off the ~30-entry
battle log, is on [Recording and coverage](/docs/recording).
