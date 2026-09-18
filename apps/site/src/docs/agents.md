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
`elixir_track_player` and `elixir_track_clan`, which need a self. Omit
`clan_tag` anywhere and it means the agent's clan.

## Knowing which human is asking

MCP carries no per-request user identity, so the agent supplies one.
`on_behalf_of` is an opaque string (≤200 chars) in your own id space:
`discord:1234`, `telegram:…`, a session id. Pass it on every call that could
mean "me". The first time an id is unknown, the subject-resolving tools
answer `no_subject` (there is nothing to answer about; an agent has no self
to fall back on):

```json
{ "error": { "code": "no_subject",
    "message": "No player is mapped to discord:1234 yet.",
    "hint": "Ask who they are in the clan, then elixir_identify({ external_id, player_tag }) once to remember it. Or pass player_tag explicitly." } }
```

Map it once with `elixir_identify` (scope `account:write`). The tag must be a
**current member of a clan on this connection**; anything else is
`not_entitled`, because a wrong mapping answers confidently about the wrong
person for good. The mapping is per agent account, invisible to every other
account, and confers nothing: recorded data is readable by every account
anyway. `elixir_my_identities` lists what the agent has learned.

### A complete exchange

Pass the asker's display name beside the id (`display_name`, 3.18.0) and
the refusal does the roster comparison for you: `error.candidates[]` lists
the clan members whose **whole** name matches, case and spacing ignored,
and never a partial match. One candidate is one `elixir_identify` call;
zero or several is a question to the person.

```text
member Raquaza (discord:1234): how am I doing?

→ players_summary({ on_behalf_of: "discord:1234", display_name: "Raquaza" })
← { error: { code: "no_subject", class: "subject", message: "No player is mapped to discord:1234 yet.",
    candidates: [ { player_tag: "#UL2V9QRG0", name: "raquaza", clan_tag: "#J2RGCRVG", role: "coLeader" } ],
    hint: "candidates[] holds the one clan member whose whole name is 'Raquaza': elixir_identify({ external_id: \"discord:1234\", player_tag: \"#UL2V9QRG0\" }) once, say so in a line, and answer." } }

→ elixir_identify({ external_id: "discord:1234", player_tag: "#UL2V9QRG0" })
← { external_id: "discord:1234", player_tag: "#UL2V9QRG0", name: "raquaza", clan_tag: "#J2RGCRVG",
    notes: ["Pass this external_id as on_behalf_of from now on; omit player_tag and it means them.", …],
    docs: "agents#knowing-which-human-is-asking" }

→ players_summary({ on_behalf_of: "discord:1234" })
← { player_tag: "#UL2V9QRG0", name: "raquaza", trophies: …, last_30_days: { battles: 41, wins: 24, losses: 17, draws: 0, win_rate: 0.585, … }, top_deck: …,
    applied: { window: { from: "…", to: null, source: "fixed", days: 30 } }, notes: […], docs: "recording#completeness",
    meta: { freshness_seconds: 27, source_polls: { player_battlelog: { observed_at: "…", freshness_seconds: 27 } }, … } }
```

Without `display_name`, or when no whole name matches (`candidates: []`),
ask which player in the clan they are, resolve the answer with
`players_search`, and identify once. Every later call from `discord:1234`
resolves with no lookup. Always read
`meta.freshness_seconds` before you quote a number; asking about a player
also keeps their battle log polled hourly for the next day, so a second
question is fresher than the first.

## Consuming the timeline

`elixir_timeline` returns the items that happened since your read pointer,
in order, plus one entry per subject. For an agent the subject is the clan
it represents: its members' sessions and moments, joins and departures, the
war moments and the presence crossings arrive as items, and the entry
summarizes the window. A consumer names its own pointer with `reader`
(3.18.0): a short name (`editor`, `poap-kings-discord`), and from then on
an omitted `from` reads since that reader's pointer, `mark_read` moves it
and `read_to` reports it, while other readers on the same account and the
account's own unnamed pointer are untouched. A headless runtime reads and
marks as itself:

```js
// The first read with a new reader name covers the last 24 hours; every
// later one starts where this reader's last mark_read ended.
const page = await call("elixir_timeline", {
  reader: "editor",                 // this consumer's own pointer
  sections: ["roster", "war", "presence"],   // optional: trim items and entries
});
if (page.timeline.length === 0) return;           // nothing to consider
for (const item of page.timeline) consider(item);  // item.text is the sentence; item.facts the numbers
for (const entry of page.entries) context(entry);  // the window's shape per subject
// read_to is now the window's end; nothing to persist locally.
```

A runtime that keeps its own cursor still can (pass `from`, `mark_read:
false`), but then `meta.timeline_pending` cannot help it: that hint counts
admissions since the OLDEST named pointer on the account, or the account's
own when no reader has ever marked, so a reader that marks sees it fall to
0 after its read and can skip the next poll when it is 0 on any call it was
making anyway.

The item and entry shapes are on [Timeline](/docs/timeline), with the
`facts` keys each `kind` carries (a `battle_session` has `battles`, `won`,
`lost`, `by_mode` and `trophy_net`; a `session_standout` adds `crossed` and
`newly`; a `ranked_promotion` has `from`, `to` and their names and, when the
record holds it, the promoting battle under `promoted_by`; a clan's
`member_left` has the departing member's `player_tag`, `name` and
`role_at_departure`). Branch on `kind` and `facts`; `text` is for the person.
`meta.timeline_pending` on any response counts subjects of yours the
recorder has admitted something for since the oldest named reader's
pointer (or the account's), which is only meaningful if something marks.

**Polling has a price.** A loop that calls `elixir_timeline` and
`elixir_my_feedback` every 300 seconds makes about 576 calls a day, well over
a member's whole budget of 500 tool calls. Two rules keep it cheap: **read
`elixir_my_feedback` only when `meta.feedback_responses_pending > 0`**, and
`meta.timeline_pending` and `meta.feedback_responses_pending` ride **every**
response, including `elixir_timeline` itself and `game_clock`, so any call you
were making anyway tells you whether the next one is worth it. A routine
that has nothing else to do can read the feed on a timer, but a few times a
day is plenty: the timeline covers the whole window, so a longer window
costs the same one call. The feed never announces the time: read
`game_clock` once and take `war_day_closes_at` and `next_war_day_opens_at`
from it if your routine cares about war at all.

A routine that runs once a day reads its clan's timeline, drills with
`clans_standings` or `battles_trends` when something moved, and, if it
schedules itself before a close from `game_clock`, checks
`war_current.decks_today.untouched` then, unless `race_finished_at` is set.
Facts in, judgment in your code.

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
`last_seen` (address, country, client name) and `timeline_pending`. Your own
Usage breaks the agents' calls out of your daily budget.

## Feedback from an agent

`elixir_feedback` filed through an agent is attributed to the agent, answered
by the maintainer, and delivered back as a `feedback_responded` event plus
`meta.feedback_responses_pending` on the agent's own responses. Agents are
expected to file friction on their own judgment.
