---
slug: agents
title: "Agents"
navTitle: "Agents"
description: "An agent acts for a clan rather than a person: its own identity, key and event feed. How to create one, how to connect it, and how it learns which human is asking."
order: 21
section: connections
---

# Agents

An agent is a principal you own that acts **for a clan**. It has its own
identity, its own key, its own event feed and its own feedback inbox — so what
it does never lands in your history, and what you do never shows up as its.

If you have not read [Users, agents and integrations](/docs/connections), start
there; this page assumes you know why you want one.

## Creating one

**Account → Agents → Create agent.** You need a clan you already record, which
is the only gate: agents are available at every tier, not just paid ones.

Name it, pick the clan, and you get a key **shown once**. Only its hash is
stored — there is no way to recover it later, and no support path that ends in
us telling you what it was. If you lose it, revoke and make another.

An agent carries its own tier, capped below yours: an admin's agent is not an
admin. It spends *your* daily call budget, which is the trade that lets it be
free.

## Connecting it

Every agent has its own URL:

```
https://elixir.poapkings.com/a/<agent-id>/mcp
```

Two ways in, for two different situations:

- **A human driving it** — you, connecting Claude to your clan agent — signs in
  and consents, exactly like a personal connection. You never handle a key.
- **A headless runtime** — a Discord bot, a scheduled job — uses the key.

A credential is bound to one door. An agent key presented at the personal `/mcp`
is refused, and so is one agent's key at another agent's URL. That is deliberate:
the alternative is a connection quietly answering about the wrong subject.

## What an agent sees

Its tool surface is **not** the personal one. There is no `elixir_my_players`,
no `elixir_add_player`, no `elixir_add_clan` — an agent has no self to have
players, and adding a clan is an act you perform as yourself.

What it gains instead is its clan as a default: omit `clan_tag` and it means the
clan it acts for. Its opening instructions name that clan, its size and its
leadership, so it does not spend a call discovering its own identity.

The roster is deliberately **not** in those instructions. It changes daily, and
an agent holds its instructions until it reconnects — an embedded roster would
be confidently wrong by evening. Pull `clans_roster` once and reuse it.

## Knowing which human is asking

A clan agent talks to many people through one connection, and MCP carries no
per-request identity. So the agent supplies one.

Pass `on_behalf_of` with whatever id your surface has — `discord:1234`,
`signal:…`, `telegram:…`, a session id, anything. It is opaque to us on purpose:
the point is that any surface works.

The first time someone asks about themselves, we will not recognise the id and
will say so. The agent asks who they are in the clan, calls `elixir_identify`
once, and from then on `on_behalf_of` resolves to that player — for them, and
for everyone else who asks later. `elixir_my_identities` lists what it has
learned.

Two things worth knowing:

- **It grants nothing.** Recorded data is readable by every account either way,
  so a mapping only chooses a default subject. A wrong one produces a visibly
  wrong answer, not access to something.
- **It is permanent.** A Clash Royale tag never changes hands. Somebody who
  rejoins under a new tag is a new person, not the same one renamed.

## A worked example

> **Member:** how am I playing?
> **Agent** *(calls `players_summary` with `on_behalf_of: discord:1234`, is told
> nobody is mapped)*: I don't have you linked yet — which player are you?
> **Member:** I'm Raquaza
> **Agent** *(calls `elixir_identify`, then answers)*: 62% over your last 16
> ladder battles…

Every question after that resolves with no lookup at all.

## Revoking

**Account → Agents → Revoke key.** The agent stops working immediately. Its
identity, its clan and its learned mappings survive, so issuing a new key picks
up where it left off.
