# Stats

*Rewritten 2026-11-13 to the social layer, from the Ladder brief Jamie
ratified on 2026-10-12, under [`VISION.md`](../../VISION.md) and the
rulings in [DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. It
waits on Jamie's read; where it and DECISIONS disagree, DECISIONS wins.*

## What it is for

The game forgets; Stats reads a player's season back from the record,
one mode at a time: what they played and how it went. "A mirror, not a
coach." It is Elixir's answer to "how am I doing?" without an agent, and
to "how is my friend doing?" for a player you follow. [Jamie,
2026-10-02, 2026-10-03, 2026-11-12]

Stats is You's fifth tab (`/home/you/stats`), with a scope bar (Player,
Season, mode, freshness) above four tabs: Season, Battles, Decks, Cards.
[Jamie, 2026-11-12, "You is your own player page, with Stats";
engineering, 2026-11-05]

## Who it serves

The signed-in person, for their own players (the primary and any alt)
and for the players they follow, opened from that player's page. A
watched player and a stranger are refused on the server; their record is
on the player page's Record tab instead. [Jamie, 2026-11-12, "Stats
opens for the players you follow"]

## Principles that decide the details

1. **One mode at a time.** Each mode is its own game; nothing on a page
   pools across them; a win rate across all would describe none.
   [Jamie, 2026-09-22]
2. **Every number is one a tool returned.** Each page is a handful of the
   same reads a connected agent makes; no number the tools do not
   return, no model behind it. [Jamie, 2026-10-02]
3. **Form is numbers only.** "Am I improving?" is two stretches of one
   mode's record side by side (this game week beside the four before;
   before and since the most-played deck arrived; this season beside the
   last), each with its count; a direction stated with its numbers is a
   fact; no verdict word, arrow, colour, score or advice; under ten
   decided battles a side is not shown. [Jamie, 2026-10-08, 2026-10-11,
   2026-10-20]
4. **The season as the record holds it.** Seasons come from the record,
   not a calendar; a just-added player is told the first capture is on
   its way, never shown an empty season; a wrong tag says so with the
   fix in reach. [Jamie, 2026-10-03, 2026-10-08]
5. **What you faced is ordered by the reader.** Most battles first; most
   losses first is a choice in the address; a row needs its floor; no
   row is labelled or advised on. [Jamie, 2026-10-08]
6. **A player's battles, one by one.** Stats treats battles individually,
   war battles included: the calendar and Battles show each on the day
   it was played. War by the week is about the clan war's week, not a
   player's battles. [Jamie, 2026-10-20]
7. **Words follow whose season it is.** A followed player's Stats says
   "their" where yours says "your", links back to their player page, and
   leaves out what is about verifying your own player. [engineering,
   2026-11-12]

## What it never does

Coach, judge or pace; show the season of a player you do not follow;
pool modes; run a model; show a number without its count.

## A person's own reads are unmetered

A person reading Stats on Elixir's website never spends their daily tool
quota, as a first-party client does not; the hourly bucket still
applies. Quotas are for agents and the live lane, which
spend the shared Clash Royale budget. [Jamie, 2026-10-12]

## Open

Nothing at the level of this page.
