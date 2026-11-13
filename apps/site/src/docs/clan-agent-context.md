---
slug: clan-agent-context
title: "Agent context"
description: "The agent policy-context tool retired in 12.0.0; a clan's public policy is in the clan directory."
section: protocol
order: 6
navTitle: "Agent context"
icon: bot
lede: "Where an agent reads a clan's Clan Wars intent now that the agent context tool has retired."
---

# Agent context

## Agent context

The agent context tool, `clans_context`, retired in contract 12.0.0. It gave
an agent with a separately approved grant eight fields of its clan's policy,
the Clan Wars intent among them. That intent, and the rest of the policy's
public part, is now in the [clan directory](/docs/clan-directory#agents-and-apps),
which a person's own agent reads with `clans_directory`: no grant, no clan
argument, every clan that saved a policy.

Read `policy.war_intent` on the clan's entry: `participating`,
`not_participating` or `unknown`. Unknown never means not participating,
and `saved_at` is when the clan's leaders last saved the policy. Refresh
before planning a routine that depends on it, and defer that routine on
unknown or a failed read; never substitute a cached decision.
