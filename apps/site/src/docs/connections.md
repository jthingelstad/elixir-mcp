---
slug: connections
title: "Users, agents and integrations"
description: "Three kinds of connection to Elixir, what each one is for, and which you want. A user is you. An agent acts for a clan. An integration serves its own users."
section: agent
order: 1
navTitle: "Connect an agent"
icon: plug
lede: "Clients that act as you: OAuth grants, capabilities and disconnecting."
console: ["Manage your clients", "/console/account/connections", "Console ▸ Connections"]
reviewed: "2026-10-06 against contract 11.2.3 and JSON API 3.0.0"
---

# Users, agents and integrations

Three different things can connect to Elixir, and the difference is not
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

Elixir Clan, at `/clan`, is part of Elixir: it uses the same account and
the same sign-in, so there is nothing to connect. Elixir Drop signs you in
**with Elixir**: the same consent page, listing what it asks for, including
*Know your email address*. Only the Elixir family's own apps (a client the
maintainer has provisioned for the family, with every redirect on a family
origin) can ask for that; any other client that asks is refused. Drop learns
who you are from your Elixir account, so you are the same person there as
here. It is listed on Connections like any other client, and disconnecting
it there ends its access. Your address is never released to any client
outside the family, which includes every MCP client and agent. See
[Sign in with Elixir](/docs/sign-in-with-elixir).

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
timeline, its own notion of who it is. What it does never lands in your
history, and what you do never shows up as its.

The reason to want one is that a clan is not a person. If a Discord bot
connected as *you*, then "who do you track?" would answer with **your** personal
player list, and everything it did would be recorded as something you did. An
agent has no personal players to leak, because it has no self — its subject is
the clan.

You can create an agent for **any clan you already record**, at any tier. It is
not a paid feature. It spends your daily call and live-fetch budgets and your
recording slots, and its own role is capped at yours (and at `leader`) — an
admin's agent is not an admin, and when your role changes, the agent's is
clamped to it.

### Agents serve many people

A clan agent talks to a whole Discord, so "me" is a different person every time.
MCP has no way to say *which* human is asking, so the agent tells us: it passes
whatever id its own surface has — `discord:1234`, `signal:…`, anything — and the
first time we don't recognise someone, it asks who they are in the clan and
remembers.

That mapping only picks a default player. It grants nothing: recorded data is
readable by every account either way. It is the agent's alone: on your own
connection "me" is always your primary player, `on_behalf_of` is ignored,
and the tools that build the map (`elixir_identify`, `elixir_my_identities`)
are not listed.

## An integration

An integration has **no "me" at all**. It reads explicitly named recorded
resources on behalf of its own users, naming what it wants on every call.

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
you, who can call on your behalf, and how the service is running. The
switcher at the top moves between you and each agent you own, whose console
is the same pages scoped to it (below).

| Page | What it does |
|---|---|
| Overview | whether your agent can answer about you yet, and what each unfinished line is waiting for; your players and clans in brief; your tier's slot usage; once your primary's clan is on record, [Bring your clanmates](/docs/bring-your-clan#bring-your-clanmates) |
| Timeline | what happened to the players and clans you track over the last seven days, newest first: the same items your connections read with `elixir_timeline`; reading it here marks nothing read |
| Explore | the same read tools in a browser (players, clans and wars, decks, war weeks); the one write is nicknames |
| Your record → Tracking | your players (relationship, nickname, notify) and your clans (scope, notify), and where you change them; your agent can also start tracking someone and set a nickname with its tools |
| Your record → Verify | prove that you control a player by playing one battle with a deck Elixir names |
| Access → Connections | every OAuth client you consented, its last call, address and country, calls this week, refused credentials; controls to change capabilities or disconnect; one row per agent you own, opening its console; and **New agent** |
| Access → Usage | today's call and live-fetch meters, fourteen days of calls, who and which tools spent them with agents broken out, and **MCP requests**, every call with its `request_id` |
| Service → Status | recording health, budget gauge, capture gaps; under it **Collectors** (the fleet, your own collectors, the one-time token reveal) and **Efficiency** (what the battle-log schedule costs and loses) |
| Send feedback | what you filed and what the maintainer answered |

**Account settings**, in the account menu at the top, has its own rail:

| Page | What it does |
|---|---|
| Profile | your address, the timezone your date windows use and the console prints every time in (UTC until you set one), slot meters, the tier-upgrade request and today's quota |
| Emails from Elixir | a switch for each email, and **All sent**, the emails Elixir sent you |
| Sign-in and devices | every session that can still act as you, this one marked |
| Sign-ins | your account events |

An **agent's console** (the account selector, or Open on its row) has its own
rail:

| Page | What it does |
|---|---|
| Overview | its clan, its key and when it was first used, its last successful call, where it connects from, anything refusing it, and the address to connect it at |
| Timeline | its timeline, newest first, the items it reads with `elixir_timeline`; reading it here never moves its pointer |
| Its record → Tracking | the clans and players it tracks, and which clan it acts for |
| Its record → Activity | its calls with `request_id`, and its account events |
| Its record → Usage | its calls as a share of your budget, which it spends |
| Access → Connections | the clients connected as it, what each may do, and refusals of its key |
| Access → Settings | its name, what its key may do, the key itself (issue, revoke, suspend), and who it answers for |
| Access → Feedback | what it has filed and what the maintainer answered; new feedback is filed as you |

## Making one

Create clan agents under **Connections → New agent**. Platform integrations are
managed under **Admin → Integrations**. Both show a newly issued key once;
only its hash is stored. See the [integration guide](/docs/integrations) for
REST resources, permissions and bounded refreshes. An integration does not
enroll a player or clan for recording.
