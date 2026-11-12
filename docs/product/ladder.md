# Ladder

*Overtaken in part, 2026-11-12: Ladder is Stats under You, and Stats opens
for the players you follow (DECISIONS "Stats opens for the players you
follow"). Who it serves and what it never does are corrected below; the
rest of the brief is not rewritten.*

*Ratified by Jamie, 2026-10-12, in the sitting that drafted it.*

*Under [`VISION.md`](../../VISION.md) of 2026-11-11, Elixir is the missing
social layer of Clash Royale. Where this brief disagrees with the vision or
[DECISIONS](../DECISIONS.md), they win; the brief is rewritten after the
Design session (#752).*

*Rearranged at step 5 of the redesign, 2026-11-06: a scope bar (Player, Season, mode, freshness) and four tabs, Season, Battles, Decks, Cards ([Structure](structure.md)).*

## What it is for

The game forgets; Ladder reads a person's own season back from the
record, one mode at a time: what they played and how it went. "A mirror,
not a coach." It is Elixir's answer to "how am I doing?" for a person
without an agent. [Jamie, 2026-10-02, 2026-10-03]

## Who it serves

The signed-in person, for their own players (the primary and any alt)
and for the players they follow, opened from that player's page. A
watched player's season, and a stranger's, is not on Stats. [Jamie,
2026-10-03, 2026-11-12]
Orientation is part of release readiness: someone opening Elixir
understands it is a recorder and sees their next step. [Jamie,
2026-10-03]

## Principles that decide the details

1. **One mode at a time.** Each mode is its own game; nothing on a page
   pools across them; a win rate across all would describe none.
   [Jamie, 2026-09-22]
2. **Every number is one a tool returned.** Each page is a handful of the
   same reads a connected app makes; no number the tools do not return,
   no model behind it. [Jamie, 2026-10-02]
3. **Form is numbers only.** "Am I improving?" is two stretches of one
   mode's record side by side (this game week beside the four before;
   before and since the most-played deck arrived; this season beside the
   last [Jamie, 2026-10-20]), each with its count;
   a direction stated with its numbers is a fact; no verdict word,
   arrow, colour, score or advice; under ten decided battles a side is
   not shown. [Jamie, 2026-10-08, 2026-10-11]
4. **The season as the record holds it.** Seasons come from the record,
   not a calendar; a just-added player is told the first capture is on
   its way, never shown an empty season; a wrong tag says so with the
   fix in reach. [Jamie, 2026-10-03, 2026-10-08]
5. **What you faced is ordered by the reader.** Most battles first; most
   losses first is a choice in the address; a row needs its floor; no
   row is labelled or advised on. [Jamie, 2026-10-08]
6. **A person's battles, one by one.** Ladder treats battles
   individually, war battles included: the calendar and Battles show each on
   the day it was played. War by the week is about the clan war's week, not a
   person's battles. [Jamie, 2026-10-20]

## What it never does

Coach, judge or pace; show the season of a player you do not follow
(a watched player or a stranger); pool modes; run a model;
show a number without its count.

## A person's own reads are unmetered

A person browsing their own record on Elixir's website is never
rate-limited by their tier, as a first-party client is not. Quotas are
for agents, integrations and the live lane, which spend the shared Clash
Royale budget. [Jamie, 2026-10-12]

## Open

Nothing at the level of this page.
