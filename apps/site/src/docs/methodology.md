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
and anything below its floor is served as counts rather than a rate.

If you want an opinion, your agent can form one. The tool will not form it for
you, because a tool that editorialises is a tool you cannot check.

## What the corpus actually is

It is **the matchmaking neighbourhood of the clans we record** — dense around
their trophy bands, thin everywhere else. It is not a global ladder sample and
it does not pretend to be.

Three biases we disclose rather than hide:

**It is an ecosystem, not the ladder.** Responses echo the trophy-band
composition of the sample, so you can see what population a number describes
before you trust it.

**There are two classes of player in it.** Members of recorded clans have deep
histories; most of their opponents appear once or twice. Estimators are built so
both contribute at exactly the strength their history supports — no opponent is
discarded, and none is over-trusted.

**War decks and ladder decks are different metas.** Mode is a first-class filter,
and any pooled response says which modes went into it.

## Skill is confounded with everything

The trap in naive deck statistics: a deck's raw win rate is mostly a fact about
*who plays it*. Popular decks among strong players look strong. That is not a
finding, it is an artefact — and it is the single most common way clan-level
deck stats mislead.

So deck and card numbers here are computed as **lift relative to the player**:
how a deck performed against how that same player performs generally. A deck
that wins 55% in the hands of someone who wins 55% anyway has told you nothing,
and the number says so.

## Pilot Score

Card levels win games. That is not controversial, and it makes raw win rate a
poor measure of how well someone actually plays.

`battles_levels` measures the **level curve** empirically — win rate by
deck-average level gap, across the corpus, binned where the data actually lives
and never extrapolated beyond it. Your **Pilot Score** is then your actual win
rate minus what your level gap predicts: *wins your card levels cannot explain*.

Two things make it worth having:

- It is **independent of spending**. A well-levelled account and a modest one
  can be compared on it.
- The **trend matters more than the value**. A climbing Pilot Score means you
  are getting better, whatever your absolute rate is doing.

Every bin and every score ships its sample size. A score computed on forty
battles is reported as a score computed on forty battles.

## Floors, and what happens below them

Below its sample floor a statistic is served as **counts only** — never as a
rate, never as a ranking. This is deliberate and it will sometimes be
frustrating: a deck you have played six times has no win rate here, because six
battles cannot support one.

A card with few recorded battles is not a trend. If a response looks thin, check
its stated sample before drawing anything from it.

## Rival intelligence

`war_rivals` works because every recorded river race captures **all five clans
in the bracket**, not just ours. Rivals therefore accumulate a record across
every race they have shared with any recorded clan — races seen, fame record,
zero-fame collapses, seasons spanned.

It is pure aggregation of stored observations. There is no prediction in it, and
where the record is thin it says so.

## Reading any of it honestly

Every response carries [an envelope](/docs/responses) saying when it was
computed, how far back the record goes, and whether capture was incomplete.
The single most common mistake is reading an absence as a fact: *"no battles in
March"* means nothing if recording began in April.
