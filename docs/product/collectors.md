# Collectors and operators

*Rewritten 2026-11-13 to the social layer, from the brief Jamie ratified
on 2026-10-12, under [`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. It waits on
Jamie's read; where it and DECISIONS disagree, DECISIONS wins.*

## What it is for

A collector is a volunteer's machine that fetches Clash Royale data for
the shared record with the volunteer's own API key and posts it back over
HTTPS. The fleet is how Elixir records at all, and so how there is a
timeline of the players you follow: the game does the playing,
collectors record it, and Elixir is where people see it. "The fleet
shares one rate budget; extra collectors add resilience, not quota."
[Jamie, 2026-09-06, 2026-09-28, 2026-11-11]

## Who it serves

The record, and through it everyone. Anyone may run one: enrollment is
raising a hand, whoever does is approved, and the admission checks are
the trust a hobby record needs; no shadow lane is built first. The
collector is credited publicly to the operator's primary player by its
card name; the machine's name and address are private. [Jamie,
2026-09-06, 2026-09-07, 2026-10-12]

Anyone raises a hand at Settings › Collectors › Run a collector, linked
from `/data`; once they run one, Settings › Collectors holds the
one-time token and each collector's own record. Anyone can
see the fleet on `/data`, which lists each collector by card name and
operator, whether it is keeping up and whether its release is signed.
Admin's fleet and efficiency pages are staff-only, under Settings ›
Admin. [Jamie, 2026-11-12, "Console folds into You, player pages and
Settings"; engineering, 2026-11-12]

## Principles that decide the details

1. **Zero AWS, two secrets.** The collector holds its CR key and its
   Elixir token, calls three routes, never chooses targets, never sees
   user data. The server owns scheduling, pacing, contract and release
   authority; a stale client is fixed by updating the client, never by
   restoring a field on the hub. [Jamie, 2026-09-06, 2026-09-26]
2. **Signed releases, named by the hub.** A build is a candidate until
   the hub names it; the collector installs only a named release whose
   signature and hash check; no pin, no opt-out, rollback is naming the
   previous release; raising the minimum version is Jamie's call. Go
   only. [Jamie, 2026-09-06, 2026-09-25, 2026-09-26]
3. **One budget, for people.** One global rate budget; the session clock
   is the player's schedule; the tick charges only rows it inserts; a
   failed fetch is retried in minutes; errors never advance freshness.
   [Jamie, 2026-09-19, 2026-09-28]
4. **Which collectors run is answered by the hub.** `/data`, Settings ›
   Admin, `elixir_collectors` and `/api/public/status`, never a repo doc.
   [Jamie, 2026-09-26]
5. **Running one earns the Family tier, and that is the reward.** No
   points, credits or bonus slots; one obvious reward. [Jamie,
   2026-10-12]
6. **The collector mail is operational.** Its weekly mail and upgrade
   notices go to the people running a collector, apart from the digest,
   because it is "for a unique channel". [Jamie, 2026-11-12]

## What it never does

Hold AWS credentials; choose its own work; run unsigned code; add quota;
publish an operator's machine or address.

## Open

Nothing at the level of this page.
