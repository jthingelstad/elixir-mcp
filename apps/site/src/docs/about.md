---
slug: about
title: "About Elixir"
description: "Elixir is the missing social layer of Clash Royale: follow your friends and your clan, see how they play, and cheer them on. What it is, how you use it, what feeds it, and who runs it."
section: start
order: 1
navTitle: "Welcome"
icon: info
lede: "Follow your friends and your clan, see how they play, and cheer them on."
reviewed: "2026-11-13 the social layer first; 2026-10-12 who writes the words"
callout: ["Open it at Status and data", "/data", "Status and data"]
---

# About Elixir

Elixir is the missing social layer of Clash Royale: follow your friends and
your clan, see how they play, and cheer them on.

Clash Royale is played mostly alone. You can add someone as a friend in the
game, but it does not show you their battles or let you celebrate what they
did. In Elixir you follow the players you care about, and their sessions,
their firsts and the battles they are proud of come to one feed on
[Home](/home), newest first, with your own play in it. You cheer an item
with one of six cheers, and highlight a battle of your own with a few words
about it. Your clan is a group of friends too: follow it to see its week,
and if you lead it, run it on a policy in [Clan](/clan). One digest email
brings the people you follow and your clan's news to your inbox, weekly or
daily, so you keep up even when you do not open the website.

**How you use it:** sign in, add your player tag, follow a few people and
choose your digest. The [Quickstart](/docs/quickstart) walks it through.
Everything inside needs an account; a highlight someone shares, or a battle
link someone sends, opens without one.

**What feeds it:** the Clash Royale API only answers "what is true right
now": your last ~30 battles, your current trophies. Elixir reads
continuously through its [collectors](/docs/operators), stores every battle
once (no matter how many members saw it), and derives daily readings, war
records and timeline moments from the stream. Following a player is what
starts recording them ([Recording and coverage](/docs/recording)). The same
record is your season in [Stats](/home/you/stats), your clan's week in
[Clan](/clan), and the facts behind every feed item and digest.

You can also connect your own AI agent through MCP and bring that record
into a conversation: *"how has my ladder win rate trended since I swapped
Cannon for Musketeer?"* is a real, answerable question here. An agent is
optional; you do not need one to use Elixir. Connect it at
`https://elixir.poapkings.com/mcp` with Claude or another MCP client
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
[Discord bot](/family/discord), an agent that reads its game facts from
this service. The code is public. Start at
[jthingelstad/elixir-mcp](https://github.com/jthingelstad/elixir-mcp);
the [Architecture](/docs/architecture) page maps the related repos.

*This material is unofficial and is not endorsed by Supercell. For more
information see Supercell’s Fan Content Policy:
www.supercell.com/fan-content-policy.*
