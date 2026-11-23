---
slug: connections
title: "Your connections"
description: "Connecting your own AI to Elixir as yourself, what it knows about you, signing in to other Elixir apps, and where things are in Elixir and Settings."
section: connect
order: 1
navTitle: "Your connections"
icon: plug
lede: "Clients that act as you: OAuth grants, capabilities and disconnecting."
reviewed: "2026-11-23 one MCP endpoint, every connection a person's; 2026-11-17 Notifications next to your account at every width; 2026-11-13 against JSON API 5.0.0"
callout: ["Open it at Settings › Connections", "/settings/connections", "Open Connections"]
---

# Your connections

Elixir has people, and every connection is a person's. When you connect
your own AI (Claude, ChatGPT, any MCP client, or a routine you run), it
connects **as you**, at one endpoint:

```
https://elixir.poapkings.com/mcp
```

## Connecting as you

When you connect Claude, or any MCP client, to that address, you are
connecting **as yourself**. You sign
in with your email (new to Elixir, the same page creates your account), and
from then on the tools know who you are.

That last part matters more than it sounds. Ask *"how am I playing?"* and your
AI does not need to look you up first: your connection already knows your
primary player, your alts, the friends you follow, and your clan. Omit the
player tag and it means you.

You have one self, so there is nothing to configure. Every app you
connect is listed on **Settings › Connections**, and disconnecting it
there ends its access.

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
outside the family, which includes every MCP client. See
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

## Which do I want?

- **Playing Clash Royale and curious about your own history** → connect
  your AI as yourself. Nothing else to do.
- **Building a routine or a bot that runs for you** →
  [Your own agent](/docs/agents): it signs in as you, the same way.
- **Running a clan and want its news in Discord** → your clan's leaders
  set that up on the clan's **Run › Discord** page
  ([Clan Discord](/docs/clan-discord)); no bot to run.
- **Building an app that signs people in with Elixir** →
  [Sign in with Elixir](/docs/sign-in-with-elixir); it learns who they
  are, and reads nothing else.

## Where things are

The top bar holds **Timeline**, **Find** and **Clan**, with search, Help,
**Notifications** (the bell) and your account at its right. The bell sits
next to your account on every screen, a phone's too. A phone has
**Timeline**, **Find**, **Clan** and **Profile** as tabs at its foot; on a
wide screen the account menu is Profile. **Profile**
is your own account page, with **Your stats** (your season, read back). **Settings**, in the
account menu, holds what we
record for you and who can call on your behalf. On a wide screen a rail stays in view as a page scrolls;
on a phone it folds into one row above the page.

| Page | What it does |
|---|---|
| Timeline | one feed of the last seven days, newest first, beside your week and your clan: what happened to the players and clans you follow, your clan and you, the same items your connections read with `elixir_timeline` ([Your Timeline](/docs/timeline#your-timeline)). A new account opens on its six [Getting set up](/docs/timeline#getting-set-up) steps until they are done. Opening your Timeline marks what is new since your last visit; it never changes what your connections have read ([its own place](#your-timeline-keeps-its-own-place)) |
| Find | your clan's members, search and **Follow a friend** by tag, the players you met in your battles, the clan directory and your own Follow me link ([Find](/docs/follow-a-friend#find)) |
| Profile | your primary player's own page once you have [verified](/docs/verify) it, with a **Stats** tab ([your season, read back](/docs/ladder)); your other players, listed to you alone; Settings, Play Drop and signing out. With no verified player, Profile says how to verify one |
| Notifications | the bell. What is about you, not your friends: cheers on your items (counts, never who), new followers, your clan's Actions waiting on you as a leader, an old key still trying to connect, answers to your feedback, and what changed on your account ([Notifications](/docs/your-account#notifications)). Its number counts what needs you and what came since you last opened it |
| Search | the magnifier on the top bar: your players and clans as you type, a tag finds anyone on record, each player row naming the tag, clan and trophies and opening the [player page](/docs/player-page), **Follow this tag** asks before it follows, and a war week in your clan opens Clan's War tab |
| Help | the question mark on the top bar: what the page you are on is for, a link to read more, and **Send feedback**, which carries the page along. **Feedback**, in Settings, keeps what you filed and what the maintainer answered |

**Settings**, in the account menu at the top, has its own rail:

| Page | What it does |
|---|---|
| Profile | your address, the timezone your date windows use and Elixir prints every time in (a new account starts on its signup browser's; UTC when it has none), and closing your account |
| Emails | your digest (**Weekly**, **Daily** or **Off**), a switch for each other email, and **All sent**, the emails Elixir sent you ([Turn an email off](/docs/turn-an-email-off)) |
| Players & following | your players (relationship, nickname, notify) and your clans (scope, notify), and where you change them; your AI can also start following someone and set a nickname with its tools |
| Players & following › Verify | prove that you control a player by playing one battle with a deck Elixir names |
| Connections | every app you connected as yourself, its last call, address and country, calls this week, refused credentials; controls to change capabilities or disconnect; the `/mcp` address to copy; the questions to try once your AI can answer; Discord sharing for your Timeline; and [your RSS link](/docs/timeline#your-rss-link) |
| Usage and limits | today's call and live-fetch meters, what your account allows and what earns the next role, fourteen days of calls, which connections and tools spent them, your own website reads counted apart (they spend no daily quota), and **Requests**, every call with its `request_id` |
| Sign-ins & devices | every session that can still act as you, this one marked, and your account events |
| Feedback | what you filed and what the maintainer answered |

### Your Timeline keeps its own place

Your Timeline has a place of its own in the
[timeline](/docs/timeline), apart from every read pointer. Showing the
feed moves it to the end of the window the feed showed; it never moves
back. A dot on the Timeline tab shows while the recorder has admitted
something for one of your subjects since that place. The page marks each
item the record learned since the place it opened from (by `observed_at`)
**New**, and draws a **New since your last visit** rule under the last of
them. A first visit has no place yet and marks nothing new.

Viewing the page leaves your read pointer, every `reader`'s and
`meta.timeline_pending` where they were, and a `mark_read` from your AI
never moves the page's **New** markers. A `mark_read` does lower
`meta.timeline_pending`, which counts from the oldest active named
reader.
