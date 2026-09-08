---
slug: integrations
title: "Integrations"
navTitle: "Integrations"
description: "Building an app on the Elixir MCP corpus: what an integration is, how it authenticates, how quota works when your traffic scales with your users, and the rules a consumer must follow."
order: 23
section: connections
---

# Integrations

An integration is a principal with **no "me"**. It reads the recorded corpus on
behalf of its own users, naming what it wants on every call.

[Elixir Drop](https://drop.poapkings.com) is the working example: it looks up
whoever is playing, in whatever clan they happen to be in, and has no
relationship with any particular clan of its own.

If you are building something for one clan, you probably want
[an agent](/docs/agents) instead.

## Getting one

Integrations sit at the **partner** tier, and the reason is capacity rather than
prestige: an integration's call volume is a function of *your* userbase, not
your own habits. That is a conversation to have rather than a checkbox — ask.

They are token-only. There is no human at the keyboard to consent, so there is
nothing for OAuth to do.

## How it differs

**Nothing defaults to "yours."** Pass `player_tag` and `clan_tag` explicitly on
every call; there is no account subject to fall back on. The identity tools
(`elixir_my_players`, nicknames, the event feed) are simply absent from an
integration's surface, because none of them mean anything without a self.

**Your key carries only what it needs.** Ask for the narrowest scope that works
— most integrations want `cr:read` and nothing else. A credential that can edit
collections in order to read a war clock is a credential you have to be careful
with for no benefit.

**Your quota is yours.** An integration carries its own daily allowance, sized
for an app, rather than drawing on its owner's personal budget.

## The rules

**Pull, never push.** Consumers read from Elixir MCP; Elixir MCP does not call
out to consumers. One service knowing about another's endpoints is how two
systems become one system with extra steps.

**Cache what you read.** The corpus changes on the order of minutes, not
milliseconds. An app that re-reads the same clan roster for every page view is
spending a shared budget on nothing — and the budget really is shared, because
every fetch ultimately spends the one global Clash Royale API allowance.

**Handle missing data as normal.** `not_recorded` is the ordinary cold case, not
a failure: a player nobody has added has no history here. Design the empty state
first; you will hit it constantly.

**Do not present recorded gaps as facts.** See [the response
envelope](/docs/responses) — `recorded_since` is the field that stops *"no
battles in March"* meaning something it does not.

## What is not here

There is no REST API yet. Everything goes through MCP, which is a deliberate
starting point rather than a limitation we have hit — one protocol, one
authorisation model, one place tools are defined. If you are building something
where that is the wrong shape, say so; that is the sort of friction worth
hearing about.

## Time without a clan

`game_clock` answers what season it is, which week, whether today is a training
or war day, and when each rolls over — with no player and no clan. It exists
precisely because an integration should not have to nominate an arbitrary clan
to learn the date.
