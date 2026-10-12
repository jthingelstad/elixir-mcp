# Collectors and operators

*Draft. Not yet ratified.*

## What it is for

A collector is a volunteer's machine that fetches Clash Royale data for
the shared record with the volunteer's own API key and posts it back over
HTTPS. The fleet is how Elixir records at all, and how it survives one
machine going dark: "the fleet shares one rate budget; extra collectors
add resilience, not quota." [Jamie, 2026-09-06, 2026-09-28]

## Who it serves

The record, and through it everyone. Anyone may run one: enrollment is
raising a hand, the maintainer approves whoever does, and the admission
checks (shape, identity, content-derived ids, quarantine) are the trust
a hobby record needs; no shadow lane is built first. The collector is
credited publicly to the operator's primary player by its card name;
the machine's name and address are private. [Jamie, 2026-09-06,
2026-09-07, 2026-10-12]

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
4. **Which collectors run is answered by the hub.** Admin ▸ Collectors,
   `elixir_collectors` and `/api/public/status`, never a repo doc.
   [Jamie, 2026-09-26]
5. **Running one earns the Family tier, and that is the reward.** The
   points economy (fetch points to daily call credits, bonus player and
   clan slots while active) retires; one obvious reward. [Jamie,
   2026-10-12]

## What it never does

Hold AWS credentials; choose its own work; run unsigned code; add quota;
publish an operator's machine or address.

## Open

Nothing at the level of this page.
