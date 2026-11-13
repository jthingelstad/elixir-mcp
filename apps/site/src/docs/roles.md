---
slug: roles
title: "Roles and quotas"
description: "Roles never gate what you can read. Every active account reads all recorded game data; your role sets how much Elixir MCP records for you and how many tool calls you get per day."
section: policy
order: 30
navTitle: "Roles"
icon: shield-check
lede: "What each role records for you, never what you may read."
reviewed: "2026-10-12 roles are earned in the game, the collector points economy retired; a family is recorded, Clan is one clan at a time; 2026-10-06 for public member signup"
callout: ["Open it at Settings › Profile", "/settings/profile", "Open Profile"]
---

# Roles and quotas

Every account sits on a six-rung ladder. One principle above everything:
**roles never gate what you can read.** All recorded game data (battles,
daily readings, wars) is open to every active account, the same
posture as the game's own public API. Your role sets the two things that cost
the service something: **recording** (what Elixir promises to record for
you) and **call volume** (your daily budgets, including the live lane that
spends the one shared Clash Royale API budget).

Two things sit outside that rule. Your own account data is private to
you. And the few facts the Elixir family's own apps add about a clan (a
leader's note on why a member left, an award) are shown only to the
people each one is for: a clan's facts to its verified members and
their agents, a member's away only to the clan's leaders.

## The ladder

| Quota | member | leader | family | partner | admin | owner |
|---|---|---|---|---|---|---|
| Player recordings | 50 | 50 | 50 | 50 | unlimited | unlimited |
| Clan watches, the clan only | 1 | 1 | 3 | 10 | unlimited | unlimited |
| Clan watches, every member | none | 1 | 3 | 5 | unlimited | unlimited |
| Tool calls / day | 500 | 2,000 | 5,000 | 15,000 | unlimited | unlimited |
| Live CR fetches / day | 20 | 100 | 250 | 1,000 | unlimited | unlimited |
| Agents | 3 | 5 | 10 | 25 | unlimited | unlimited |

Tool calls are what your agents and connected apps spend at the MCP door.
Your own reads on Elixir's website, Find, player pages and Stats, never count
against them; they share only the hourly limit ([Limits](/docs/limits)).

Member, Leader and Family are **earned in the game**, and checked every
time you use Elixir, the way Clan checks your role
([Upgrades](#upgrades)). Partner is granted.

**member**: signup. You, a couple of alts, and your clan at
activity scope (roster + war, no member fan-out). Elixir fills that clan
slot with your primary player's clan for you when it is free ([Your
player's clan](/docs/recording#your-players-clan)).

**leader**: you run a clan: one of your [verified](/docs/verify)
players is its leader or co-leader, and you follow the clan. One
every-member watch: every member's battles and profile, following
membership as it changes. This is the role a clan's own agent needs.

**family**: you run a collector for Elixir. Multiple every-member
watches, for a clan family (a main plus feeders) or the clans you follow. A family is how they are
recorded; in [Clan](/docs/bring-your-clan#your-role-here)
each clan keeps its own policy, standing, Actions and awards, and you
switch between the clans your own players (your primary and alts) are
in. A clan you only record or watch does not appear there.

**partner**: full access to Elixir's API surface, granted by the
maintainer for serious tooling (a clan bot, a community service).
Community-scale slots and budgets, and an expectation: partners run a
collector. At this scale you should be adding capacity to the fleet, not
only consuming it.

**admin**: runs Admin day-to-day: answers feedback,
provisions platform integrations, revokes connections, and grants or
removes partner. Unlimited quotas, exempt from every cap.

**owner**: the super admin; exactly one. Everything an admin can do,
plus granting or revoking the admin role and running the collector
fleet. No admin can change the owner's account, or another admin's.

## Three kinds of principal

Not everything that calls Elixir MCP is a person.

**You** are a person. You sign in with your email and connect the apps you
choose (Claude, ChatGPT and others) over OAuth; the tools answer about *your* players, your clans, your
timeline. There is no personal API key. An OAuth connection refreshes itself,
so a script that runs unattended stays signed in as you, for up to 90 days
from your consent; then it asks you to consent again
([Protocol](/docs/connecting#tokens)). A headless runtime that does clan
work uses an agent's key instead, which does not expire.

**An agent** acts for a clan rather than for a person. It has its own identity,
its own key and its own timeline, so what it does never lands in your history
and what you do never shows up as its. **Every role can have agents**: you
can create one for any clan you already record, up to the
per-account count in the table above. It spends your daily call budget, **your
live-fetch budget**, every agent you run shares your one daily live
allowance, **and your recording slots**: what your agents follow is counted
with what you follow, once per player or clan, however many of you follow it.
Its own role is capped at yours, and at `leader`: an admin's agent is not an
admin, and an agent's role follows yours as it is read now (member while
you are a member, leader otherwise), so an agent never sits above its owner. Each agent has its own page,
opened from its row in Settings › Connections & agents.

That separation is the point. An agent that borrowed your identity would answer
"who am I" with *your* player tag, which is not what a clan's Discord bot should
be able to say out loud.

**An integration** connects another platform to the [REST API](/docs/integrations).
It is platform access an admin provisions: no role
includes one, and it is set up with explicit permissions and independent
API and refresh limits. It has no personal subject or inherited
admin authority.

| | You | Agent | Integration |
|---|---|---|---|
| Acts for | yourself | a clan | its own users |
| Signs in with | OAuth | OAuth or a key | a key |
| Available to | everyone | everyone, per clan you record | admin provisioned |

## Followed means recorded

Following a player or clan on your account IS the act of recording it:
there is no separate watch step and no approval queue; your role's slots
are the only gate, and recording starts immediately. The one per-subject
setting is **notify**: whether that player or clan feeds your timeline
(`elixir_timeline`). Remove a subject and its slot frees; a clan's shared
recording stops only when no account follows it.

## Why fifty players, whatever your role

One every-member clan watch already records about fifty players, so following
fifty individually costs the service exactly what a single every-member slot
costs. And most of them are already recorded anyway: **a recording
is shared by everyone watching it**, so a player slot is spent only when
Elixir records the player because of you. A member of a clan recorded in
full, or a player another account already follows, is free ([What a player
slot costs](/docs/recording#what-a-player-slot-costs)).

That is also what makes relationships worth having. Each player you follow is your
**primary** (you), an **alt** (also you, another tag), a **friend** you follow,
or someone you're **watching**, and "how are my friends playing?" is only a
question worth asking if there is room to keep friends in.

So player slots are deliberately not a rung on the ladder. The roles differ
where cost actually scales: clan watches, daily calls, the live lane.

## Why every-member watches are the scarce thing

An every-member watch on a 50-member clan is effectively fifty player
recordings that follow the roster. It is the most expensive promise the
service makes, which is why those slots grow slowly up the ladder:
clan recording spends the shared collector budget, and the ladder is the
gate.

## Upgrades

Leader and Family are not requested. Each comes with something you do, and
Elixir checks it every time you use it:

- **Leader**: [verify](/docs/verify) a player of yours (your primary or
  an alt) who is the leader or a co-leader of a clan, and follow that
  clan. Verified, because several accounts may claim one tag on trust;
  only Verify proves whose it is. Their role in the clan is the one
  Elixir last recorded.
- **Family**: [run a collector](/docs/operators) for Elixir. It counts
  while it is active: its last fetch was admitted since its last
  probation. A collector on probation, draining or revoked does not.
  Running one earns the Family role, and nothing else: there are no
  points, call credits or bonus slots.
- **Partner**: granted by the maintainer, on request through
  [feedback](/settings/feedback).

When both apply, the higher role wins: a leader who runs a collector is
Family. A role earned is lost when its ground goes: step down as
co-leader, leave the clan, stop following it or stop the collector, and
the next request reads the role below. Nothing you already follow is
removed when that happens; your role's slots refuse only the next add
until you are back under them.

Hand-tuned per-account overrides exist for cases the ladder doesn't fit;
ask through feedback.

## The fine print

- Quotas reset at midnight UTC. Recorded-data reads are only bounded by
  the daily tool-call budget, never by role, and your own reads on the
  Find, player pages and Stats are not bounded by it at all.
- Feedback has no limit of its own. Sent from the website it costs
  nothing; sent by your agent it is one tool call like any other.
  Telling us what's wrong should always be close to free.
- Where each number is enforced and what a refusal looks like is on
  [Limits](/docs/limits). Limits may evolve during the beta; the
  [updates](/updates) and the `elixir_changelog` tool record every change.
