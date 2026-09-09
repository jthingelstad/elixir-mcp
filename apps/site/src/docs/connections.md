---
slug: connections
title: "Users, agents and integrations"
navTitle: "Users, agents & integrations"
description: "Three kinds of connection to Elixir MCP, what each one is for, and which you want. A user is you. An agent acts for a clan. An integration serves its own users."
order: 20
section: connections
---

# Users, agents and integrations

Three different things can connect to Elixir MCP, and the difference is not
technical trivia — it decides what "me" means, whose data comes back, and who
pays for the calls.

The short version:

| | You | An agent | An integration |
|---|---|---|---|
| Acts for | yourself | a clan | its own users |
| "Me" is | your primary player | the clan | nobody |
| Signs in with | OAuth | a key, or OAuth by its owner | a key |
| Who can have one | everyone | everyone | admin provisioned |

## You

When you connect Claude — or any MCP client — to
`https://elixir.poapkings.com/mcp`, you are connecting **as yourself**. You sign
in with the email on your account, and from then on the tools know who you are.

That last part matters more than it sounds. Ask *"how am I playing?"* and your
agent does not need to look you up first: your connection already knows your
primary player, your alts, the friends you follow, and your clan. Omit the
player tag and it means you.

You can only have one self, so there is nothing to configure. This is the
connection almost everybody wants.

### Your first question

On **Account → Connections**, **Try asking…** offers questions based on your
recorded data. Copy one and paste it into the AI client you connected. A profile
can support a snapshot summary; battle history can support a review, deck
comparisons or two-week comparisons. A clan-war question appears when a clan you
added has a recorded war week. You can view the full question before copying it.

These are curated starting points. They ask your client to check freshness,
sample sizes and missing data. If capture has not arrived yet, the panel explains
what to do next and refreshes while open. Copying a question does not call the
MCP service or count as an answered question.

## An agent

An agent acts **for a clan, not for a person**.

It is a separate principal that you own: its own identity, its own key, its own
event feed, its own notion of who it is. What it does never lands in your
history, and what you do never shows up as its.

The reason to want one is that a clan is not a person. If a Discord bot
connected as *you*, then "who do you track?" would answer with **your** personal
player list, and everything it did would be recorded as something you did. An
agent has no personal players to leak, because it has no self — its subject is
the clan.

You can create an agent for **any clan you already record**, at any tier. It is
not a paid feature. It spends your daily call budget, and it carries its own
tier — an admin's agent is not an admin.

### Agents serve many people

A clan agent talks to a whole Discord, so "me" is a different person every time.
MCP has no way to say *which* human is asking, so the agent tells us: it passes
whatever id its own surface has — `discord:1234`, `signal:…`, anything — and the
first time we don't recognise someone, it asks who they are in the clan and
remembers.

That mapping only picks a default player. It grants nothing: recorded data is
readable by every account either way.

## An integration

An integration has **no "me" at all**. It reads the corpus on behalf of its own
users, naming what it wants on every call.

[Elixir Drop](https://drop.poapkings.com) is the example: it looks up whoever is
playing, in whatever clan they happen to be in, and has no relationship with any
particular clan of its own.

Integrations use the [REST Integration API](/docs/integrations), with an
admin-issued server key, explicit permissions and their own capacity. They do
not inherit the human sponsor's admin powers or personal quota.

## Which do I want?

- **Playing Clash Royale and curious about your own history** → connect as
  yourself. Nothing else to do.
- **Running a clan and want a Discord bot, or Claude, doing clan work** → make
  an agent for the clan.
- **Building an app for other people** → an integration.

## One connection at a time

You can hold more than one — a personal connection *and* an agent for your clan
— but keep them in **separate sessions**, not both switched on in the same chat.

They publish the same tool names, so an assistant with both cannot tell which
one you meant, and the two answer from different subjects. In Claude that means
a dedicated project for clan work with only the agent connector enabled.

Each connection has its own URL, so a credential presented at the wrong one is
refused rather than quietly answering about the wrong subject.

## Where things are in the console

| Page | What it does |
|---|---|
| Account → Overview | your players (relationship, nickname, notify), your clans (scope, notify), slot usage, tier-upgrade request, timezone |
| Account → Connections | every live connection - yours and your agents' and integrations' - with what it can do, where it last called from, and controls to change its capabilities or disconnect it |
| Account → Agents | create, connect URL, rotate, revoke, suspend, rename; per-agent spend, refusals and unread events |
| Account → Connections | every OAuth client you consented, its last call, address and country, calls this week, refused credentials; disconnect |
| Account → Activity | your calls with `request_id`, account events, the notification feed (read-only) |
| Account → Usage | seven days of calls and errors, top tools, today's balance with agents broken out |
| Account → Collector | your collectors, the one-time token reveal, the ladder |
| Account → Feedback | what you filed and what the maintainer answered |
| Explore | the same read tools in a browser; the one write is nicknames |
| Data → Dashboard, Status | corpus totals; recording health, budget gauge, collector fleet, capture gaps |

## Making one

Create clan agents under **Account → Agents**. Platform integrations are
managed under **Admin → Integrations**. Both show a newly issued key once;
only its hash is stored. See the [integration guide](/docs/integrations) for
REST resources, permissions and automatic recording enrollment.
