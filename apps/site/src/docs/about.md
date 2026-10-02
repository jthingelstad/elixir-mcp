---
slug: about
title: "About Elixir"
description: "Elixir records Clash Royale history for you, your friends and your clan, so you can explore it, follow what happens and run your clan. Connect your own AI agent over MCP when you want to bring the record into a conversation."
section: start
order: 1
navTitle: "Welcome"
icon: info
lede: "Your Clash Royale history, your friends and your clan, kept for you to explore."
console: ["See the recorder", "/data", "Data"]
reviewed: "2026-10-02 recorder scope, contract 11.0.0"
---

# About Elixir

Elixir is a **Clash Royale recorder** for players and clans who enjoy the
game and want to keep their history. Record yourself, follow your friends,
and keep your clan's weeks: explore what happened, learn from your own
play, and run the clan with its history in front of you.

The focus is recording what you and the people you follow do, sending
notifications about that record, making it available to your agents, and
giving you a dashboard where you can explore what happened. Elixir has retired game-wide meta statistics, gameplay recommendations and
named recording Collections. Your existing primary, alt, friend and watching
relationships organize the players you follow.

The Clash Royale API only answers "what is true right now" — your last
~30 battles, your current trophies. Elixir polls continuously,
stores every battle once (no matter how many members observed it),
derives daily snapshots, war records, and timeline moments from the stream, and
makes the record available on [Ladder](/ladder), in [Clan](/clan), and in
[emails](/docs/email) about your play and the people you follow. Keeping you
up to date is part of the service, even when you do not open the website.

You can also connect your own AI agent through MCP and bring the same
record into a conversation: *"how has my ladder win rate trended since I
swapped Cannon for Musketeer?"* is a real, answerable question here. MCP is
one way to use Elixir; you do not need an agent to use the recorder.

**How you use it:** request access, add your player tag — adding *is*
recording, there is no separate opt-in. Open your record, follow a friend,
or bring your clan. To connect an agent, use
`https://elixir.poapkings.com/mcp` with Claude or another MCP client. The
[Quickstart](/docs/quickstart) walks it through; [Explore](/console/explore)
lets you browse the recorded facts directly.

**Who runs it:** this is a hobby service operated by Jamie Thingelstad
for the POAP KINGS clan and friends. It is free, and paid tiers are not
planned (see [Terms](/docs/terms)). Occasional product updates go out on the
Elixir newsletter (you're enrolled at sign-in; every issue has an
unsubscribe link, and unsubscribing sticks).

**Inside Elixir:** [Clan](/clan) helps you run your clan: standing, the
Elder band and the actions leaders decide, using your clan's own policy.
[Ladder](/ladder) explores your own play, mode by mode.
[Elixir Drop](https://drop.poapkings.com) is a separate elixir-cost learning
game. A clan can also run its own
[Discord bot](/family/discord), an agent that reads its game facts from
this service. The code is public — start at
[jthingelstad/elixir-mcp](https://github.com/jthingelstad/elixir-mcp);
the [Architecture](/docs/architecture) page maps the related repos.

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell's Fan Content Policy:
www.supercell.com/fan-content-policy.*
