---
slug: clan-directory
title: "Clan directory"
description: "Finding a clan by its rules: which clans the directory lists, what a tile shows, the filters, the order, and who can read it."
section: clan
order: 15
navTitle: "Clan directory"
icon: layout-grid
lede: "Every clan that saved its rules in Elixir, as a grid you can filter by those rules."
reviewed: "2026-11-12; first version: signed-in people only, listed by name, the policy's public part"
---

# Clan directory

## What it lists

The [clan directory](/clan/directory) lists every clan whose leaders have
saved a policy in Clan ([Clan policy](/docs/clan-policy#saving)). Saving a
policy is how a clan joins the directory; there is no other step and no
separate switch. A clan with no saved policy is not listed. Elixir lists a
clan only once it records it, and it does not crawl the game for clans.

Any signed-in person can open it, with a clan or without one. Signed out,
it asks you to sign in. It is a page in the app only: no MCP tool or JSON
API operation reads it.

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

- **Search** over the name, the tag and the in-game description.
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
