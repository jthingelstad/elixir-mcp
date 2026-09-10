---
slug: agents
title: "Building an agent"
description: "A clan agent is a principal you own with its own key, URL, event cursor and feedback inbox. Creating one, what initialize tells it, resolving which human is asking with on_behalf_of and elixir_identify, consuming the event feed with a private cursor, and the key lifecycle."
section: using
order: 15
navTitle: "Agents"
icon: bot
lede: "A runtime that acts for one clan, with its own door, key, identity map and feed."
console: ["Create and manage agents", "/account/agents", "Console ▸ Connections"]
---

# Building an agent

An agent acts **for a clan**, not for a person. It is a separate principal
that you own: its own identity, its own key and URL, its own event cursor,
its own feedback inbox. What it does never lands in your history and what you
do never shows up as its. If you have not read
[Users, agents and integrations](/docs/connections), start there.

## Create one

**Connections → Agents → Create agent**, or `POST /api/me/agents` with a session.

| Field | Rule |
|---|---|
| `name` | `^[a-z0-9][a-z0-9-]{1,40}$`; unique among your live agents; renamable later |
| `clan_tag` | a clan you have already added; the agent's subject |
| `scope` | optional OAuth scope string for the key; omitted means every capability |

The response (HTTP 201) carries the agent and its key **once**:

```json
{ "agent": { "account_id": "…", "kind": "agent", "public_id": "k3f9x2mq7p",
             "role": "leader", "status": "approved", "clans": [{ "clan_tag": "#J2RGCRVG", "scope": "comprehensive" }] },
  "token": "svt_…", "note": "This token is shown once. Store it now." }
```

Only the key's SHA-256 is stored. The agent's role is your role clamped to
at most `leader`; it spends **your** daily call budget and **your** live lane.
Every tier may create agents (3 / 5 / 10 / 25; owner and admin unlimited);
over the cap the response is `{"error":"not_entitled","reason":"agent_limit","limit":N}`.

## Connect it

Its URL is on its page with a copy button:

```
https://elixir.poapkings.com/a/<public_id>/mcp
```

| Runtime | How |
|---|---|
| A human driving it (you, in Claude) | Add the URL as a connector and sign in. Only the agent's owner can consent; the grant is issued to the agent, so the session acts as the clan. |
| Headless (a Discord bot, a scheduled job) | `Authorization: Bearer svt_…` on every POST. No OAuth. |

A credential is bound to one door: the key at `/mcp` or at another agent's
URL answers 403 `wrong_resource`. A suspended agent's key answers 401 like an
invalid one.

## What `initialize` tells it

```json
{ "serverInfo": { "name": "elixir-mcp", "version": "{{ tools.contractVersion }}+tools.…" },
  "instructions": "YOU ACT FOR POAP KINGS #J2RGCRVG (47 members). Leadership: King Thing #20JJJ2CCRU (leader), … OMIT clan_tag to mean it. Pull clans_roster ONCE and reuse it… You have no player of your own: pass on_behalf_of… call elixir_identify once… You already know 9 of them.",
  "_meta": { "elixir.poapkings.com/principal": {
      "kind": "agent",
      "subject": { "type": "clan", "tag": "#J2RGCRVG", "name": "POAP KINGS", "members": 47 } } } }
```

Use `_meta` to assert the boot: `kind` must be `agent` and `subject` must
not be `null`. The instructions are for the model and change without notice.
The roster is deliberately absent because the instructions are held until
reconnect; call `clans_roster` once per run.

An agent's `tools/list` has {{ tools.agentCount }} tools: everything except `elixir_my_players`,
`elixir_add_player` and `elixir_add_clan`, which need a self. Omit
`clan_tag` anywhere and it means the agent's clan.

## Knowing which human is asking

MCP carries no per-request user identity, so the agent supplies one.
`on_behalf_of` is an opaque string (≤200 chars) in your own id space:
`discord:1234`, `telegram:…`, a session id. Pass it on every call that could
mean "me". The first time an id is unknown, the subject-resolving tools
answer `not_found`:

```json
{ "error": { "code": "not_found",
    "message": "No player is mapped to discord:1234 yet.",
    "hint": "Ask who they are in the clan, then call elixir_identify once with their player_tag. Or pass player_tag explicitly." } }
```

Map it once with `elixir_identify` (scope `account:write`). The tag must be a
**current member of a clan on this connection**; anything else is
`not_entitled`, because a wrong mapping answers confidently about the wrong
person for good. The mapping is per agent account, invisible to every other
account, and confers nothing: recorded data is readable by every account
anyway. `elixir_my_identities` lists what the agent has learned.

### A complete exchange

```text
member (discord:1234): how am I doing?

→ players_summary({ on_behalf_of: "discord:1234" })
← { error: { code: "not_found", message: "No player is mapped to discord:1234 yet.", hint: "…" } }

agent: I don't have you linked yet. Which player are you in POAP KINGS?
member: Raquaza

→ players_search({ query: "Raquaza", limit: 5 })
← { matches: [ { player_tag: "#UL2V9QRG0", name: "raquaza", source: "clanmate" } ], … }

→ elixir_identify({ external_id: "discord:1234", player_tag: "#UL2V9QRG0" })
← { external_id: "discord:1234", player_tag: "#UL2V9QRG0", name: "raquaza", clan_tag: "#J2RGCRVG",
    note: "Pass this external_id as on_behalf_of from now on; omit player_tag and it means them." }

→ players_summary({ on_behalf_of: "discord:1234" })
← { player_tag: "#UL2V9QRG0", name: "raquaza", trophies: …, last_30_days: { battles: 41, wins: 24, losses: 17, draws: 0, win_rate: 0.585, … }, top_deck: …,
    meta: { freshness_seconds: 27, source_polls: { player_battlelog: { observed_at: "…", freshness_seconds: 27 } }, … } }
```

Every later call from `discord:1234` resolves with no lookup. Always read
`meta.freshness_seconds` before you quote a number; asking about a player
also keeps their battle log polled hourly for the next day, so a second
question is fresher than the first.

## Consuming the event feed

`elixir_events` is the push lane. Its cursor is **per account**: two
consumers that both call it with `mark_seen: true` will each acknowledge
events the other never saw. A headless runtime should keep its own cursor
and never mark:

```js
// state.since persisted between runs; seed it from the newest event on
// first run rather than replaying the backlog into a channel.
const page = await call("elixir_events", {
  since: state.since,           // integer event_id; omit on the very first run
  limit: 200,
  mark_seen: false,             // never move the account's cursor
  topics: ["clan_pulse", "war_day_open", "member_joined", "member_left"],
});
for (const ev of page.events) handle(ev);   // { event_id, topic, subject_tag, payload, created_at }; coalesced topics carry payload.count
state.since = page.next_cursor;            // last event_id returned, or unchanged when empty
if (page.has_more) continue;               // same call again, before sleeping
```

Payload floors per topic are on [Events](/docs/events). `meta.events_pending`
on any other response tells you the account cursor has unread rows, which is
only meaningful if something marks. Events prune after 30 days.

A routine that runs once a day around 07:30 UTC sees the `clan_pulse`
digest, drills with `clans_standings` or `battles_trends` when something
moved, and on `war_day_open` checks `war_current.decks_today.untouched` in
the evening. Facts in, judgment in your code.

## Key lifecycle

| Action | Where | Effect |
|---|---|---|
| Rotate | agent page → Rotate, or `POST /api/me/principals/rotate` | one transaction: every live key revoked, a new one issued with the same name and scope. `public_id` (the URL), identities and the event cursor survive. |
| Revoke | agent page → Revoke key | the key stops immediately; nothing to restore. Issue a new one with Rotate when ready. |
| Suspend / Resume | agent page | `status: disabled`; the same key reads as invalid until resumed. Reversible. |
| Rename | agent page | changes the name; must stay unique among your live agents |
| Delete | – | there is no delete. Suspend is the reversible stop; revoke is the irreversible one. |

## Knowing whether it is working

A refused key never reaches the call log, so a runtime still presenting a
rotated key produces silence, not errors. The agent's page shows, per key,
`last_used_at` and **the current key has never been used**; per source
address, refusals in the last seven days with the reason (`revoked_key`,
`principal_suspended`, `wrong_door`, `unknown_key`); and `calls_7d`,
`last_seen` (address, country, client name) and `unread_events`. Your own
Usage breaks the agents' calls out of your daily budget.

## Feedback from an agent

`elixir_feedback` filed through an agent is attributed to the agent, answered
by the maintainer, and delivered back as a `feedback_responded` event plus
`meta.feedback_responses_pending` on the agent's own responses. Agents are
expected to file friction on their own judgment.
