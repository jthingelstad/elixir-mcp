---
slug: clan-agent-context
title: "Agent context"
description: "The policy and standing facts Clan shares with a member's connected agent, and what stays private."
section: protocol
order: 6
navTitle: "Agent context"
icon: bot
lede: "What Clan tells a connected agent about the clan's policy and a member's place in it."
---

# Agent context

## Agent context

An agent may read its assigned clan’s explicit Clan War intent only after a
separate, approved private-context grant. `clans_context` takes no clan argument
and returns `context` with exactly eight fields: `schema_version`, `clan_tag`,
`status`, `reason`, `war_intent`, `policy_version`, `policy_saved_at`, and `read_at`.
The MCP envelope also carries the usual applied, notes, docs and meta fields.
There are no scoring values, leader notes, player names, member decisions or other
private policy details. Standard game scopes alone grant no policy access.

Each grant binds one agent, its actual owner, its assigned clan and one existing
service credential. Every read checks the current owner and assignment, an
approved person owner’s verified primary/alt claim, and open recorded membership
in that clan. Friends, watched players and a remembered former clan cannot qualify.
Ownership or assignment changes durably revoke the grant; explicit revocation,
credential revocation, suspended accounts, lost verification or closed membership
refuse the read. Permission does not transfer to another clan or owner.

A successful read with no saved policy returns unknown/no_policy with null
revision/save time; missing or unsupported intent returns
unknown/war_intent_unspecified. Unknown never means not participating. Saved
revision numbers are local to one clan; saved_at is provenance, while read_at
times this current read. An old saved policy can still be current. Refresh at
startup, before planning and immediately before firing an affected routine.
Defer that routine on unknown, a failed refresh, unsupported schema or wrong clan;
never substitute a cached decision.
