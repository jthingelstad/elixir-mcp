---
slug: about
title: "About Elixir"
description: "Elixir is the missing social layer of Clash Royale: follow your friends and your clan, see how they play, and cheer them on. What it is, how you use it, what feeds it, and who runs it."
section: start
order: 1
navTitle: "Welcome"
icon: info
lede: "Follow your friends and your clan, see how they play, and cheer them on."
reviewed: "2026-11-14 the Discord bot links to Building an agent, the family pages are gone; 2026-11-13 the social layer first; 2026-10-12 who writes the words"
callout: ["Open it at Status and data", "/data", "Status and data"]
---

# About Elixir

Elixir is the missing social layer of Clash Royale: follow your friends and
your clan, see how they play, and cheer them on.

Most of Clash Royale is you against one opponent. You can add friends in
the game, but you can't see their battles or celebrate what they pull off.
Elixir fixes that.

- **Follow the players you care about.** Their sessions, their firsts (a new
  Arena, a new league) and their best battles land in one feed on
  [Home](/home), newest first, with your own play in it.
- **Cheer them on.** Every item takes one of six cheers.
- **Show off.** Highlight one of your own battles and tell the story in your
  own words.
- **Keep up with your clan.** Follow it to see its week. Lead it? Run it on
  your clan's rules in [Clan](/clan).
- **Get your digest.** One email with your friends and your clan's news,
  weekly or daily, so you keep up even when you don't open Elixir.

**Getting started:** sign in, add your player tag, follow a few people and
choose your digest. The [Quickstart](/docs/quickstart) walks you through it.
Everything inside needs an account. A highlight or battle link someone
shares opens for anyone.

**What powers it:** the Clash Royale API only knows what's true right now:
your last ~30 battles, your trophies today. Elixir's
[collectors](/docs/operators) keep reading, store every battle once (however
many members saw it), and turn the stream into daily records, war results
and feed moments. Following a player is what starts recording them
([Recording and coverage](/docs/recording)). That same record is your season
in [Stats](/home/you/stats), your clan's week in [Clan](/clan), and the facts
behind every feed item and digest.

**Bring your own AI:** connect an AI agent over MCP and ask it about your
games. *"How has my ladder win rate changed since I swapped Cannon for
Musketeer?"* is a real question it can answer here. It's optional: you don't
need an agent to use Elixir. Connect it at `https://elixir.poapkings.com/mcp`
with Claude or another MCP client
([Connect a client](/docs/connect-a-client)).

**Who runs it:** this is a hobby service operated by Jamie Thingelstad
for the POAP KINGS clan and friends. It is free, and no paid version is
planned (see [Terms](/docs/terms)). Occasional product updates go out on the
Elixir newsletter. New signup has a checked “Send me Elixir product news”
box; uncheck it before requesting your sign-in email to skip enrollment.
Every issue has an unsubscribe
link, and unsubscribing sticks.

**Who writes the words:** Elixir's own voice (the emails, the timeline's
lines, Stats and this site) is written from the record by code, and
Elixir pays for no language model. A model writes only where someone
brings their own: a clan's leaders can add the clan's own key in
[Clan](/docs/clan-policy) to draft messages, and your own AI agent writes
its own answers from the record it reads here.

**Inside Elixir:** [Clan](/clan) helps you run your clan: standing, the
Elder band and the actions leaders decide, using your clan's own policy.
[Stats](/home/you/stats) explores your own play, mode by mode.
[Elixir Drop](https://drop.poapkings.com) is a separate elixir-cost learning
game. A clan can also run its own
[Discord bot](/docs/agents), an agent that reads its game facts from
this service. The code is public. Start at
[jthingelstad/elixir-mcp](https://github.com/jthingelstad/elixir-mcp);
the [Architecture](/docs/architecture) page maps the related repos.

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell’s Fan Content Policy:
www.supercell.com/fan-content-policy.*
