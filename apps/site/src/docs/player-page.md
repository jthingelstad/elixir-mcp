---
slug: player-page
title: "A player's page"
description: "The one page every player name opens for a signed-in member: the player's timeline, highlights and moments, and for a player an account verified, that account's follows, followers and badges. Following from the page, following several players at once, and Follow me links."
section: friends
order: 7
navTitle: "A player's page"
icon: user-round
lede: "Every player's name on Elixir opens one page: what the player has done lately, and who follows whom. Stats and Clan are a link away from it."
reviewed: "2026-11-12 against contract 11.21.0"
---

# A player's page

A player's name opens their page, wherever the name is: Home, Find, the
search sheet, a battle, Stats and the email. The address is
`/home/player/<tag>`, the tag without its `#`. You need to be signed in, as
for every read of Elixir.

The page leads with the player's game name, tag, clan and trophies. Under it:

| Tab | What it holds |
|---|---|
| Timeline | what the record holds for the player in the last 30 days, newest first |
| Highlights | the battles the player chose to highlight, with their own words |
| Moments | the timeline's moments: a new arena, a promotion in Path of Legends, a badge, a clan joined or left |
| Follows | who the player's account follows, and who follows it |
| Record | the recorded profile: the last 30 days in battles, wins, losses, trophies and the deck played most, and the profile's trophies, best and lifetime counts as of its last capture |

A sitting on the Timeline tab looks as it does on Home: its small bar chart
of wins and losses, its battles, won and lost, the trophies it moved and the
deck played most, and **View games**, which opens its battles in place
([Your timeline](/docs/timeline)). You's Timeline is the same.

An item on the Timeline, Highlights or Moments tab takes a cheer, with its
counts, while it is in your own feed: from the last seven days, about a
player or clan you follow ([Cheers](/docs/timeline#cheers)). Older items,
and items on the page of a player you do not follow, show no cheers.

Your own primary player's page, once you have verified it, is **You**
(`/home/you`), with a sixth tab, **Stats**: [your season, read back](/docs/ladder).
Your players' pages opened by name offer **Your stats**, and a clanmate's page
**Open in Clan** when your clan runs Clan.

## Follows, followers and badges

What a page shows about an account is what [Privacy](/docs/privacy) makes
public: who it follows, who follows it, and its verification badges. A page
shows them for a player an account has [verified](/docs/verify), and for no
other player, because follows belong to an account and an unverified player
has no account to speak for.

- **Following** lists the players the account follows (its friends; players
  it only watches are not follows).
- **Followers** names each account that follows the player by the player that
  account verified, game name and tag. An account with no verified player is
  counted, never named.
- **Badges** say that the account verified this player, and that it linked a
  Discord account, never which one.

A page never shows a nickname, yours included, a Discord username or an email
address.

## Following from the page

**Follow** asks first. The question names the player, says they are not told,
and says what it costs: free when Elixir already records them, or one of your
player slots ([What a player slot costs](/docs/recording#what-a-player-slot-costs)).
Nothing is followed until you confirm.

A player in a clan also offers **Follow everyone in** that clan: one question
for the clan's current members (at most 50), saying how many are free and how
many take a slot, against the slots you have left. Past your limit it is
refused whole, and says why; nobody is followed in part. One that needs no
slot always goes ahead. Your own players are left out, and the question says
so. The same **Follow everyone** is over the roster in [Clan ›
Members](/docs/bring-your-clan), for every member; past your limit it stays
shut there, with the reason beside it. A player you only watch, or one only your agent
tracks, is not one you follow yet: following them is free, since Elixir
records them for you already.

## Follow me links

Your own page has **Copy my Follow me link**:
`/home/follow/<tag>`. A link can name several players, comma-separated
(`/home/follow/<tag>,<tag>`), and it names only them: no id for who sent it,
and nothing records who copied it.

Opened signed out, the link explains Elixir and offers **Join Elixir** and
**Sign in**; either brings the reader back to the link. Signed in, it lists the
players, each with its Follow and what it costs, and **Follow all** when there
are several, asked once with the same pricing and refusal as following a clan.
