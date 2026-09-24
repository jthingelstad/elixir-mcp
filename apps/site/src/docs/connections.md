---
slug: connections
title: "Users, agents and integrations"
description: "Three kinds of connection to Elixir MCP, what each one is for, and which you want. A user is you. An agent acts for a clan. An integration serves its own users."
section: using
order: 14
navTitle: "Connections"
icon: plug
lede: "Clients that act as you: OAuth grants, capabilities and disconnecting."
console: ["Manage your clients", "/account/connections", "Console ▸ Connections"]
reviewed: "2026-09-19 against contract 6.1.0"
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

### Signing in to other Elixir products with this account

Elixir Clan (and, soon, Elixir Drop) can sign you in **with Elixir**: the
same consent page, plus one extra line, *Know your email address*, which
only an app that asks for it is ever shown. That is how those products know
you are the same person you are here. It is listed on Connections like any
other client, and disconnecting it there ends its access; the address
itself is never shown to an MCP client or an agent. See
[Protocol → Signing a person in](/docs/protocol#signing-a-person-in-with-elixir).

### Your first question

On **Connections**, **Try asking…** offers questions based on your
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

The rail groups the console into what you are reading, what we record for
you, who can call on your behalf, and how the service is running. Its top
line is the account selector: you, and each agent you own, whose console is
the same pages scoped to it (below).

| Page | What it does |
|---|---|
| Overview | whether your agent can answer about you yet, and what each unfinished line is waiting for; your players and clans in brief; your tier's slot usage |
| Timeline | what happened to the players and clans you track over the last seven days, newest first: the same items your connections read with `elixir_timeline`; reading it here marks nothing read |
| Explore | the same read tools in a browser; the one write is nicknames |
| Your record → Tracking | your players (relationship, nickname, notify) and your clans (scope, notify), and the only place these change |
| Your record → Activity | your calls with `request_id`, the emails Elixir sent you, and account events |
| Your record → Usage | seven days of calls and errors, top tools, today's balance with agents broken out |
| Access → Connections → Clients | every OAuth client you consented, its last call, address and country, calls this week, refused credentials; controls to change capabilities or disconnect; and one row per agent you own, opening its console |
| Access → Connections → Agents | create an agent; per-agent spend, refusals and unread timeline subjects; each opens its console |
| Access → Profile | your address, the timezone your date windows use and the console prints every time in (UTC until you set one), slot meters, the tier-upgrade request and today's quota |
| Access → Feedback | what you filed and what the maintainer answered |
| Service → Status | recording health, budget gauge, capture gaps |
| Service → Status → Collectors | the fleet, your own collectors, the one-time token reveal, the ladder |

An **agent's console** (the account selector, or Open on its row) has its own
rail:

| Page | What it does |
|---|---|
| Overview | its clan, its key and when it was first used, its last successful call, where it connects from, anything refusing it, and the address to connect it at |
| Timeline | its timeline, newest first, the items it reads with `elixir_timeline`; reading it here never moves its pointer |
| Its record → Activity | its calls with `request_id`, and its account events |
| Its record → Usage | its calls as a share of your budget, which it spends |
| Access → Connections | the clients connected as it, what each may do, and refusals of its key |
| Access → Settings | its name, what its key may do, the key itself (issue, revoke, suspend), and who it answers for |
| Access → Feedback | what it has filed and what the maintainer answered; new feedback is filed as you |

## Making one

Create clan agents under **Connections → Agents**. Platform integrations are
managed under **Admin → Integrations**. Both show a newly issued key once;
only its hash is stored. See the [integration guide](/docs/integrations) for
REST resources, permissions and automatic recording enrollment.
