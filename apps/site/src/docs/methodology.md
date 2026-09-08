---
slug: methodology
title: "How the numbers are made"
navTitle: "Methodology"
description: "What the corpus actually is, the biases we disclose rather than hide, and how Pilot Score and the level curve are calculated. Counts, rates and uncertainty — never verdicts."
order: 41
section: data
---

# How the numbers are made

The statistical tools here report **counts, rates and uncertainty — never
verdicts**. No tiers, no "best deck", no curated lists, no model deciding what
is good. Every number carries its sample size and the population it describes,
and the tools describe their filters and sample thresholds. A threshold is not a guarantee of statistical reliability.

If you want an opinion, your agent can form one. The tool will not form it for
you, because a tool that editorialises is a tool you cannot check.

## What the corpus actually is

It is **the matchmaking neighbourhood of the clans we record** — dense around
their trophy bands, thin everywhere else. It is not a global ladder sample and
it does not pretend to be.

Three biases we disclose rather than hide:

**It is an ecosystem, not the ladder.** Choose the segment and mode explicitly when comparing results. The meta tools report the chosen segment and distinct-player counts; they do not currently return a trophy-band composition breakdown.

**There are two classes of player in it.** Members of recorded clans have deep
histories; most of their opponents appear once or twice. The current deck/card meta estimators pool their battle observations. Distinct-player counts help reveal concentration, but the rates do not adjust for each player's skill or history depth.

**War decks and ladder decks are different metas.** Mode is an optional filter. Omitting it pools modes; use the same explicit mode for comparisons.

## Skill is confounded with everything

The trap in naive deck statistics: a deck's raw win rate is mostly a fact about
*who plays it*. Popular decks among strong players look strong. That is not a
finding, it is an artefact — and it is the single most common way clan-level
deck stats mislead.

The current `battles_meta_decks` and `battles_meta_cards` tools return:

- **Raw win rate:** wins divided by wins plus losses.
- **Shrunk win rate:** the raw record pulled toward the segment mean using a
  prior strength of 20. This moderates small samples; it does not adjust for
  player skill, opposition, or deck loyalty.
- **Sample context:** battle counts, wins, losses, distinct players, and usage.

These are descriptive pooled statistics. A deck played by one strong player
can still look strong after shrinkage. Within-player, leave-deck-out and
leave-card-out lift estimators are a future design, not fields currently
served by these tools.

## Pilot Score

Card levels win games. That is not controversial, and it makes raw win rate a
poor measure of how well someone actually plays.

`battles_levels` measures the **level curve** empirically — win rate by
deck-average level gap, across the corpus, binned where the data actually lives
and never extrapolated beyond it. Your **Pilot Score** is then your actual win
rate minus what your level gap predicts: *wins your card levels cannot explain*.

The score describes performance relative to the level-gap curve in the chosen
sample. It is **not proof of skill, improvement, or independence from spending**.
Opposition, experience, mode, trophy band, deck choice and the sample itself can
change. The curve is refit over a rolling window, so a score can change even
without another battle from the player.

Compare similar windows and populations, cite sample sizes, and inspect the
basis information where returned. A rising trend is a reason to investigate,
not by itself evidence that a player got better.

Every bin and every score ships its sample size. A score computed on forty
battles is reported as a score computed on forty battles.

## Floors, and what happens below them

Thresholds differ by tool. Deck meta defaults to `min_battles: 5`, card meta
to 10, and callers can change those filters. Those tools return rates for
qualifying rows; a six-battle deck can therefore have a reported rate. They do
not currently enforce the distinct-player floors or confidence intervals of
the proposed within-player estimators.

The Level Curve suppresses rates in bins below 200 observations, and player
Pilot Scores require 30 qualifying battles. Those floors prevent very small
samples from being scored; they do not remove confounding or guarantee a
reliable comparison.

## Rival intelligence

`war_rivals` works because every recorded river race captures **all five clans
in the bracket**, not just ours. Rivals therefore accumulate a record across
every race they have shared with any recorded clan — races seen, fame record,
zero-fame collapses, seasons spanned.

It is pure aggregation of stored observations. There is no prediction in it, and
where the record is thin it says so.

## Reading any of it honestly

Every response carries [an envelope](/docs/responses) with its computation time.
Subject tools additionally expose history and source freshness where applicable.
Use `elixir_coverage` for measured observation intervals; missing coverage is
unknown, not evidence of completeness.
The single most common mistake is reading an absence as a fact: *"no battles in
March"* means nothing if recording began in April.
