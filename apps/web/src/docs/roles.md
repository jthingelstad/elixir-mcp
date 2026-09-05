# Roles and quotas

Every account sits on a five-step ladder. One principle above everything:
**roles never gate what you can read.** All recorded game data — battles,
snapshots, wars, collections — is open to every approved account, the same
posture as the game's own public API. Tiers set the two things that cost
the service something: **collection** (what Elixir promises to record for
you) and **call volume** (your daily budgets, including the live lane that
spends the one shared Clash Royale API budget).

## The ladder

| Quota | member | leader | family | partner | admin |
|---|---|---|---|---|---|
| Player recordings | 3 | 5 | 10 | 25 | unlimited |
| Clan watches — activity | 1 | 1 | 3 | 10 | unlimited |
| Clan watches — comprehensive | — | 1 | 3 | 5 | unlimited |
| Tool calls / day | 500 | 2,000 | 5,000 | 15,000 | unlimited |
| Live CR fetches / day | 20 | 100 | 250 | 1,000 | unlimited |
| Collections you curate | — | — | 5 | 20 | unlimited |
| Service tokens | — | — | — | 1 | unlimited |

**member** — the default. You, a couple of alts, and your clan at
activity scope (roster + war, no member fan-out).

**leader** — you run a clan. One *comprehensive* watch: every member's
battles and profile, following membership as it changes. This is the tier
a clan's own agent needs.

**family** — you run a clan family: a main plus feeders. Multiple
comprehensive watches, and the first tier that creates
[collections](/explore/collections) — curated groupings everyone can
browse.

**partner** — you run serious tooling (a clan bot, a community service)
on top of Elixir. A service token for headless auth, community-scale
slots — and an expectation: partners run a collector. At this scale you
should be adding capacity to the fleet, not only consuming it.

**admin** — the maintainer. Unlimited, and exempt from every cap.

## Why comprehensive is the scarce thing

A comprehensive watch on a 50-member clan is effectively fifty player
recordings that follow the roster. It is the most expensive promise the
service makes, which is why the slots grow slowly up the ladder and why
clan watches are approved by hand — clan capture spends the shared
collector budget.

## Earn more by running a collector

Any account operating a healthy collector gets **+2 player slots and +1
activity clan watch** on top of its tier, and collector fetches also earn
daily tool-call credits (1 per 10 fetches, up to 4× your base). Capacity
begets collection: the fleet is the lever that grows the whole service.

## Upgrades

Request a tier from **Account ▸ Overview** — say what you're building or
leading. The maintainer reviews requests by hand; you'll see the outcome
in your feedback (your agent sees it too, via `elixir_my_feedback`, and
gets a `role_changed` event on the push lane). Hand-tuned per-account
overrides exist for cases the ladder doesn't fit — just ask.

## The fine print

- Quotas reset at midnight UTC. Recorded-data reads are only bounded by
  the daily tool-call budget — never by tier.
- Feedback is never metered. Telling us what's wrong should always be
  free.
- Limits may evolve during the alpha; the
  [changelog](/docs) and `elixir_changelog` tool record every change.
