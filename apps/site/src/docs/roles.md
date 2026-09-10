---
slug: roles
title: "Roles and quotas"
description: "Roles never gate what you can read. Every approved account reads all recorded game data; tiers set how much Elixir MCP records for you and how many calls your agent gets per day."
section: policy
order: 30
navTitle: "Roles & tiers"
icon: shield-check
lede: "What each tier records for you — never what you may read."
console: ["Your tier", "/account/settings", "Console ▸ Settings"]
---

# Roles and quotas

Every account sits on a six-rung ladder. One principle above everything:
**roles never gate what you can read.** All recorded game data — battles,
snapshots, wars, collections — is open to every approved account, the same
posture as the game's own public API. Tiers set the two things that cost
the service something: **collection** (what Elixir promises to record for
you) and **call volume** (your daily budgets, including the live lane that
spends the one shared Clash Royale API budget).

## The ladder

| Quota | member | leader | family | partner | admin | owner |
|---|---|---|---|---|---|---|
| Player recordings | 50 | 50 | 50 | 50 | unlimited | unlimited |
| Clan watches — activity | 1 | 1 | 3 | 10 | unlimited | unlimited |
| Clan watches — comprehensive | — | 1 | 3 | 5 | unlimited | unlimited |
| Tool calls / day | 500 | 2,000 | 5,000 | 15,000 | unlimited | unlimited |
| Live CR fetches / day | 20 | 100 | 250 | 1,000 | unlimited | unlimited |
| Collections you curate | — | — | 5 | 20 | unlimited | unlimited |
| Integrations | — | — | — | 1 | unlimited | unlimited |
| Agents | 3 | 5 | 10 | 25 | unlimited | unlimited |

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

**admin** — runs the console day-to-day: approves access requests,
answers feedback, curates collections, manages clan recordings, and
sets roles up to partner. Unlimited quotas, exempt from every cap.

**owner** — the super admin; exactly one. Everything an admin can do,
plus granting or revoking the admin role, service tokens, collectors,
and quota overrides. No admin can change the owner's account — or
another admin's.

## Three kinds of principal

Not everything that calls Elixir MCP is a person.

**You** are a person. You sign in with your email and connect your agent of
choice over OAuth; the tools answer about *your* players, your clans, your
event feed. There is no personal API key, and there does not need to be — an
OAuth connection refreshes indefinitely, so even a script that runs unattended
for months stays signed in as you.

**An agent** acts for a clan rather than for a person. It has its own identity,
its own key and its own event feed, so what it does never lands in your history
and what you do never shows up as its. Agents are **not a tier feature**: you
can create one for any clan you already record, at any role, up to the
per-account count in the table above. It spends your daily call budget **and
your live-fetch budget** — every agent you run shares your one daily live
allowance — and it carries its own tier: an admin's agent is not an admin.

That separation is the point. An agent that borrowed your identity would answer
"who am I" with *your* player tag, which is not what a clan's Discord bot should
be able to say out loud.

**An integration** connects another platform to the [REST API](/docs/integrations).
An admin provisions it with explicit permissions and independent API, refresh
and enrollment limits. It has no personal subject or inherited admin authority.

| | You | Agent | Integration |
|---|---|---|---|
| Acts for | yourself | a clan | its own users |
| Signs in with | OAuth | OAuth or a key | a key |
| Available to | everyone | everyone, per clan you record | admin provisioned |

## Added means recorded

Adding a player or clan to your account IS the act of recording it —
there is no separate watch step and no approval queue; your tier's slots
are the only gate, and capture starts immediately. The one per-subject
setting is **notify**: whether that player or clan feeds your event pipe
(`elixir_events`). Remove a subject and its slot frees; a clan's shared
recording stops only when no account has it added.

## Why fifty players, at every tier

One comprehensive clan watch already records about fifty players, so tracking
fifty individually costs the service exactly what a single comprehensive slot
has always cost. And most of them are already recorded anyway — **a recording
is shared by everyone watching it**, so adding a clanmate of a clan already
being captured is free.

That is also what makes relationships worth having. Each player you add is your
**primary** (you), an **alt** (also you, another tag), a **friend** you follow,
or someone you're **watching** — and "how are my friends playing?" is only a
question worth asking if there is room to keep friends in.

So player slots are deliberately not a rung on the ladder. The tiers differ
where cost actually scales: clan watches, daily calls, the live lane,
collections, and integrations.

## Why comprehensive is the scarce thing

A comprehensive watch on a 50-member clan is effectively fifty player
recordings that follow the roster. It is the most expensive promise the
service makes, which is why those slots grow slowly up the ladder —
clan capture spends the shared collector budget, and the ladder is the
gate.

## Earn more by running a collector

Any member, leader or family account operating an active collector gets
**+2 player slots and +1 activity clan watch** on top of its tier (partner
already assumes one), and collector fetches earn
daily tool-call credits (1 per 10 fetches, up to 4× your base) — the
real, compounding benefit of running one. Capacity begets collection:
the fleet is the lever that grows the whole service.

## Upgrades

Request a tier from **Account ▸ Overview** — say what you're building or
leading. The maintainer reviews requests by hand; you'll see the outcome
in your feedback (your agent sees it too, via `elixir_my_feedback`, and
gets an `account_tier_changed` event on the push lane). Hand-tuned per-account
overrides exist for cases the ladder doesn't fit — just ask.

## The fine print

- Quotas reset at midnight UTC. Recorded-data reads are only bounded by
  the daily tool-call budget — never by tier.
- Feedback is never metered. Telling us what's wrong should always be
  free.
- Where each number is enforced and what a refusal looks like is on
  [Limits](/docs/limits). Limits may evolve during the alpha; the
  [changelog](/data/changelog) and `elixir_changelog` tool record every change.
