---
slug: connections
title: "Users, agents and integrations"
description: "Three kinds of connection to Elixir, what each one is for, and which you want. A user is you. An agent acts for a clan. An integration serves its own users."
section: connect
order: 1
navTitle: "Connect an agent"
icon: plug
lede: "Clients that act as you: OAuth grants, capabilities and disconnecting."
reviewed: "2026-10-12 against contract 11.11.3 and JSON API 3.2.0"
callout: ["Open it at Settings › Connections & agents", "/settings/connections", "Open Connections & agents"]
---

# Users, agents and integrations

Three different things can connect to Elixir, and the difference is not
technical trivia, it decides what "me" means, whose data comes back, and who
pays for the calls.

The short version:

| | You | An agent | An integration |
|---|---|---|---|
| Acts for | yourself | a clan | its own users |
| "Me" is | your primary player | the clan | nobody |
| Signs in with | OAuth | a key, or OAuth by its owner | a key |
| Who can have one | everyone | everyone | admin provisioned |

## You

When you connect Claude, or any MCP client, to
`https://elixir.poapkings.com/mcp`, you are connecting **as yourself**. You sign
in with your email (new to Elixir, the same page creates your account), and
from then on the tools know who you are.

That last part matters more than it sounds. Ask *"how am I playing?"* and your
agent does not need to look you up first: your connection already knows your
primary player, your alts, the friends you follow, and your clan. Omit the
player tag and it means you.

You can only have one self, so there is nothing to configure. This is the
connection almost everybody wants.

### Signing in to other Elixir products with this account

Clan, at `/clan`, is part of Elixir: it uses the same account and
the same sign-in, so there is nothing to connect. Elixir Drop signs you in
**with Elixir**, and creates your Elixir account if you are new. As one of
Elixir's own apps it shows no consent page: signed in here already, you go
straight back to Drop; otherwise you enter your email and code, and the
page lists what Drop gets, including *Know your email address*, with
nothing to tick. Only the Elixir family's own apps (a client the
maintainer has provisioned for the family, with every redirect on a family
origin) can ask for that; any other client that asks is refused, and
every other client shows its consent page. Drop learns who you are from
your Elixir account, so you are the same person there as here. It is listed on Connections like any other client, and disconnecting
it there ends its access. Your address is never released to any client
outside the family, which includes every MCP client and agent. See
[Sign in with Elixir](/docs/sign-in-with-elixir).

### Your first question

On **Connections**, **Try asking…** offers questions based on your
recorded data. Copy one and paste it into the AI client you connected. A profile
can support a summary of one reading; battle history can support a review, deck
comparisons or two-week comparisons. A clan-war question appears when a clan you
added has a recorded war week. You can view the full question before copying it.

These are curated starting points. They ask your client to check freshness,
sample sizes and missing data. If the first read has not arrived yet, the panel explains
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
agent has no personal players to leak, because it has no self. Its subject is
the clan.

You can create an agent for **any clan you already record**, whatever your role. It is
not a paid feature. It spends your daily call and live-fetch budgets and your
recording slots, and its own role is capped at yours (and at `leader`): an
admin's agent is not an admin, and when your role changes, the agent's is
clamped to it.

### Agents serve many people

A clan agent talks to a whole Discord, so "me" is a different person every time.
MCP has no way to say *which* human is asking, so the agent tells us: it passes
whatever id its own surface has, `discord:1234`, `signal:…`, anything, and the
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

You can hold more than one (a personal connection *and* an agent for your clan),
but keep them in **separate sessions**, not both switched on in the same chat.

They publish the same tool names, so an assistant with both cannot tell which
one you meant, and the two answer from different subjects. In Claude that means
a dedicated project for clan work with only the agent connector enabled.

Each connection has its own URL, so a credential presented at the wrong one is
refused rather than quietly answering about the wrong subject.

## Where things are

The top bar holds **Home**, **Find** and **Clan**, with search, Help and the
bell beside them. A phone has **Home**, **Find**, **Clan**, **You** and the
bell as tabs at its foot; on a wide screen the account menu is You. **You**
is your own player's page, with **Stats** (your season, read back; it was
Ladder) as its last tab. **Settings**, in the
account menu, holds what we
record for you and who can call on your behalf, and each agent you own has a
page of its own there (below). On a wide screen a rail stays in view as a page scrolls;
on a phone it folds into one row above the page.

| Page | What it does |
|---|---|
| Home | one feed of the last seven days, newest first, beside your week and your clan: what happened to the players and clans you follow, your clan and you, the same items your connections read with `elixir_timeline` ([Home's feed](/docs/timeline#homes-feed)). A new account gets its steps until the first read lands. Opening Home marks what is new since your last visit; it never changes what your connections have read ([its own place](#home-keeps-its-own-place-in-the-timeline)) |
| Find | your clan's members, search and **Follow a friend** by tag, the players you met in your battles, the clan directory and your own follow link ([Find](/docs/follow-a-friend#find)) |
| You | your primary player's own page once you have [verified](/docs/verify) it, with a **Stats** tab ([your season, read back](/docs/ladder)); your other players, listed to you alone; Settings, Play Drop and signing out. With no verified player, You says how to verify one |
| The bell | what is about you, not your friends: cheers on your items (counts, never who), new followers, your clan's Actions waiting on you as a leader, an old key still trying to connect, answers to your feedback, and what changed on your account ([the bell](/docs/your-account#the-bell)). A dot shows while something needs you or something came since you last opened it |
| Search | the magnifier on the top bar: your players and clans as you type, a tag finds anyone on record, each player row naming the tag, clan and trophies and opening the [player page](/docs/player-page), **Follow this tag** asks before it follows, and a war week in your clan opens Clan's War tab |
| Help | the question mark on the top bar: what the page you are on is for, a link to read more, and **Send feedback**, which carries the page along. **Feedback**, in Settings, keeps what you filed and what the maintainer answered |

**Settings**, in the account menu at the top, has its own rail:

| Page | What it does |
|---|---|
| Profile | your address, the timezone your date windows use and Elixir prints every time in (a new account starts on its signup browser's; UTC when it has none), and closing your account |
| Emails | a switch for each email, and **All sent**, the emails Elixir sent you |
| Players & tracking | your players (relationship, nickname, notify) and your clans (scope, notify), and where you change them; your agent can also start tracking someone and set a nickname with its tools |
| Players & tracking › Verify | prove that you control a player by playing one battle with a deck Elixir names |
| Connections & agents | every OAuth client you consented, its last call, address and country, calls this week, refused credentials; controls to change capabilities or disconnect; one row per agent you own, opening its pages; **New agent**; Discord sharing for your timeline; [your RSS link](/docs/timeline#your-rss-link); and the question to try once your agent can answer |
| Usage and limits | today's call and live-fetch meters, what your account allows and what earns the next role, fourteen days of calls, who and which tools spent them with agents broken out, your own website reads counted apart (they spend no daily quota), and **Requests**, every call with its `request_id` |
| Sign-ins & devices | every session that can still act as you, this one marked, and your account events |
| Feedback | what you filed and what the maintainer answered |

An **agent's page** (Open on its row) has five tabs:

| Page | What it does |
|---|---|
| Overview | its clan, its key and when it was first used, its last successful call, where it connects from, anything refusing it, and the address to connect it at |
| What it reads | the clans and players it tracks, and which clan it acts for |
| Usage | its calls as a share of your budget, which it spends, its calls with `request_id`, and its account events |
| Connections | the clients connected as it, what each may do, and refusals of its key |
| Settings | its name, what its key may do, the key itself (issue, revoke, suspend), removing a suspended agent from view, and who it answers for |

Overview links its **Timeline** (newest first, the items it reads with
`elixir_timeline`; viewing it there never moves its pointer) and its
**Feedback** (what it has filed and what the maintainer answered; new feedback
is filed as you).

### Home keeps its own place in the timeline

Home's feed has a place of its own in the
[timeline](/docs/timeline), apart from every read pointer. Showing the
feed moves it to the end of the window the feed showed; it never moves
back. A dot on the Home tab shows while the recorder has admitted
something for one of your subjects since that place. The page marks each
item the record learned since the place it opened from (by `observed_at`)
**New**, and draws a **New since your last visit** rule under the last of
them. A first visit has no place yet and marks nothing new.

The two never move each other. Viewing the page leaves your read pointer,
every `reader`'s and `meta.timeline_pending` where they were, and an
agent's `mark_read` never clears that count. On an agent's pages
the place is the agent's, moved when you view its Timeline, and still not
its pointer.

## Making one

Create clan agents under **Settings › Connections & agents › New agent**. Platform integrations are
managed under **Admin → Integrations**. Both show a newly issued key once;
only its hash is stored. See the [integration guide](/docs/integrations) for
REST resources, permissions and bounded refreshes. An integration does not
enroll a player or clan for recording.
