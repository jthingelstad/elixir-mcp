---
slug: clan-directory
title: "Clan directory"
description: "Finding a clan by its rules: which clans the directory lists, what a tile shows, the filters, the order, and who can read it."
section: clan
order: 15
navTitle: "Clan directory"
icon: layout-grid
lede: "Every clan that saved its rules in Elixir, as a grid you can filter by those rules."
reviewed: "2026-11-13; signed-in people and their agents, listed by name, the policy's public part, opened from Find"
---

# Clan directory

## What it lists

The [clan directory](/clan/directory) lists every clan whose leaders have
saved a policy in Clan ([Clan policy](/docs/clan-policy#saving)). Saving a
policy is how a clan joins the directory; there is no other step and no
separate switch. A clan with no saved policy is not listed. Elixir lists a
clan only once it records it, and it does not crawl the game for clans.

Open it from **Find**, under **Clan directory**, or from search. Any
signed-in person can open it, with a clan or without one. Signed out,
it asks you to sign in. Your own agent can read it for you too
([Agents](#agents)).

## What a tile shows

Each clan is one tile. A tile shows only what the game shows about the
clan and what its leaders saved as its rules:

- **The clan:** its name and tag, its size out of 50, whether it is open or
  invite only, the trophies the game asks for to join, and its in-game
  description, all as Elixir last recorded them. A fact Elixir has not
  recorded says so.
- **Its rules:** whether the clan plays Clan Wars (or has not said), how
  strict it is (relaxed, standard or strict), whether it is a clan for
  playing together, what counts toward its minimums and Elder, and, when
  the clan uses removals, how many days without a battle bring a removal
  Action for its leaders.

A tile never shows who saved the policy, the note on a save, a minimum, a
member's standing or any Action. The clan's Recruit pitch is not on it.

The tile's name opens your own clan in Clan. Elixir has no page of its
own for a clan you are not in; its tile is what the directory shows.

## Filters and order

The filters use only those facts:

- **Search** over the name, the tag and the in-game description. The
  rules themselves are the filters below.
- **Clan Wars:** plays, or does not. A clan that has not said fits neither.
- **How strict:** relaxed, standard or strict.
- **Days with no battle before a removal:** no removal rule, or at least
  14 or 30 days.
- **Room:** fewer than 50 members, by the last recorded size.
- **Your trophies:** clans whose trophies to join are at or under yours. A
  clan whose requirement is not recorded is left out while this is set.

Clans are listed by name, then by tag. Nothing in the directory is a
rating: no clan is placed above another for its size, trophies or
anything else, and a filter only hides tiles, it never reorders them.

## Agents

The same tiles reach your own agent: the MCP tool
`clans_directory` reads the directory as this page does, in the same order, with nothing
added. Each entry in `clans` carries `clan_tag`, `name`, `type`,
`description`, `members`, `required_trophies`, `yours` and `policy`
(`war_intent`, `posture`, `together`, `counted`, `removal_day`,
`saved_at`); `truncated` says when the directory holds more than one
read returns.

`policy.war_intent` is the leaders' Clan Wars intent: `participating`,
`not_participating` or `unknown`. Unknown never means not participating,
and `saved_at` is when the leaders last saved the policy. An agent that
plans a routine on it reads it fresh first, and defers on unknown or a
failed read rather than using a decision it kept.

Your own connection reads it as you. An agent you own reads it as you,
its owner: `yours` marks a clan one of your verified players is in now.
Agents read the directory and never
change it; a clan joins it only when its leaders save a policy in Clan.
