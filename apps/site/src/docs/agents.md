---
slug: agents
title: "Your own agent"
description: "Running your own AI agent, routine or bot on Elixir as yourself: signing it in at /mcp, what initialize tells it, what it reads and follows, consuming the timeline with its own named reader, keeping polling cheap, and feedback."
section: connect
order: 3
navTitle: "Your own agent"
icon: bot
lede: "A program or assistant you run, signed in to Elixir as you."
callout: ["Open it at Settings › Connections", "/settings/connections", "Open Connections"]
---

# Your own agent

Your agent is anything you run that talks to Elixir for you: an AI
assistant in a chat, a scheduled routine, a bot you host. Elixir has
people, not agent accounts, so your agent signs in **as you**, at the one
endpoint every connection uses:

```
https://elixir.poapkings.com/mcp
```

It reads what you can read, follows on your slots, spends your budget and
files feedback as you. Disconnect it on **Settings › Connections** and it
stops. [Connect a client, step by step](/docs/connect-a-client) covers
Claude, ChatGPT and the rest; this page is for when you build one.

## Sign it in

Every connection signs in with OAuth 2.1, the flow on
[Connecting and authorization](/docs/connecting). A headless runtime (a
scheduled job, a Discord bot you run) signs in once through a browser,
then keeps the refresh token: access tokens last an hour, and each
refresh hands back a new refresh token to store in place of the old one.
There is no separate key to make.

Ask only for the capabilities it needs. A routine that only reads asks
for `cr:read`; one that follows players for you also needs
`follows:write`. What it may do is yours to change on Settings ›
Connections, and the change takes effect on its next call.

Keep one connection per runtime. Each is its own row on Connections,
with its own last call, so you can tell them apart and end one without
touching the others.

## What `initialize` tells it

```json
{ "serverInfo": { "name": "elixir-mcp", "version": "{{ tools.toolsVersion }}" },
  "instructions": "YOU ARE King Thing #20JJJ2CCRU. Your clan is POAP KINGS #J2RGCRVG. … OMIT player_tag and clan_tag to mean these …",
  "_meta": { "elixir.poapkings.com/principal": {
      "kind": "person",
      "subject": { "type": "player", "tag": "#20JJJ2CCRU", "name": "King Thing" },
      "clan": { "tag": "#J2RGCRVG", "name": "POAP KINGS" } } } }
```

Use `_meta` to check the boot: `kind` is `person` and `subject` is your
primary player, or `null` when the account has none yet (verify one, or
the tools that mean "me" answer `no_subject`). The instructions are for
the model and change without notice; never parse them.

Your connection's `tools/list` has {{ tools.personCount }} tools. Omit
`player_tag` and it means your primary player; omit `clan_tag` and it
means that player's current clan.

## What it reads and follows

Your agent reads as you. Recorded game data is readable by every
account; your own account (your players, your follows, your posts, your
clan view with `clans_my_view`) is read because it is yours.

It reads the social layer and writes it only when asked: no follow it
was not asked for, no cheer, no post.

| Tool | What it reads |
|---|---|
| `elixir_timeline` | your feed: the players and clans you follow, your clan and you ([below](#consuming-the-timeline)) |
| `players_follows` | who a player follows and who follows them, with their badges ([Follows, followers and badges](/docs/player-page#follows-followers-and-badges)) |
| `players_highlights` | the posts about battles a player wrote, newest first ([Posts about battles](/docs/timeline#posts-about-battles)) |
| `elixir_cheers` | the cheers on your own items and posts |
| `clans_directory` | the clan directory, each clan's tile and the public part of its policy ([Clan directory](/docs/clan-directory)) |

Following is the one write, and only when you ask:
`elixir_follow_player` and `elixir_follow_clan` follow on **your** slots,
exactly as Find does, and the players and clans show on Settings ›
Players & following.

## Consuming the timeline

`elixir_timeline` returns the items that happened since your read
pointer, newest first, plus one entry per subject. A consumer names its
own pointer with `reader`: a short name (`editor`, `clan-discord`), and
from then on an omitted `from` reads since that reader's pointer,
`mark_read` moves it and `read_to` reports it, while other readers and
the account's own unnamed pointer are untouched. Two routines on one
account each pass their own `reader` and never steal each other's items.

A routine reporting on your clan alone passes `scope: "home_clan"`. It
checks `applied.clan_tag` and publishes only items marked
`publishable: true`. Its pointer is separate for each clan and reader, so
it is independent of a read of everything you follow.

```js
// The first read with a new reader name covers the last 24 hours; every
// later one starts where this reader's last mark_read ended.
const page = await call("elixir_timeline", {
  scope: "home_clan",               // your clan only
  reader: "editor",                 // this routine's own pointer
  sections: ["roster", "war", "presence"],   // optional: trim items and entries
  skip_empty: true,                 // optional: an empty window costs one check
});
if (page.timeline.length === 0) return;           // nothing to consider
for (const item of page.timeline) consider(item);  // item.text is the sentence; item.facts the numbers
// To post: only item.publishable; once per item.id, edited on a higher
// item.revision; the time as <t:${item.at_unix}:f>, never in the prose.
// For the story behind one: call each item.follow[] { tool, args } as given.
for (const entry of page.entries) context(entry);  // the window's shape per subject
// read_to is now the window's end; nothing to persist locally.
```

With `skip_empty: true` a window that holds nothing for this reader is
answered without reading the subjects (`entries_skipped` is `true` and
`entries` is empty), so a poll every few minutes costs little. Drop it on
the read that wants the entries of a quiet window. A runtime with a local
delivery cursor can pass its last successful `from` explicitly when it
retries.

Either a positive `meta.timeline_pending` or a true `meta.posts_pending`
is a reason to poll. The first counts subjects with newly recorded
activity; the second covers newly created or edited posts. Both measure
from the oldest named reader's pointer, or the account's when there is
none.

A reader that pulls a day's story rather than polling ("what happened
yesterday") passes `from` and `to` without a `reader`: that read is by
when things **happened** (`basis: occurred`), keeps every pointer, and
leaves out the earlier games the record learned in the window. A poller's
read is by when the record **learned** them, so nothing learned late is
skipped, and an item that happened before `from` says `late: true`
([Two kinds of window](/docs/timeline-tool#two-kinds-of-window)).

Branch on `kind` and `facts`; `text` is for people: one time-free
sentence naming everyone by their in-game name, so it can be published
as it is. The item and entry shapes, and the `facts` each `kind`
carries, are on [The timeline tool](/docs/timeline-tool#items).

### Polling has a price

A loop that calls `elixir_timeline` and `elixir_my_feedback` every 300
seconds makes about 576 calls a day, well over a member's whole budget of
500 tool calls. Two rules keep it cheap:

- **Read `elixir_my_feedback` only when
  `meta.feedback_responses_pending > 0`.**
- `meta.timeline_pending` and `meta.feedback_responses_pending` ride
  **every** response, `game_clock` included, so any call you were making
  anyway tells you whether the next one is worth it.

A few reads a day is plenty for most routines: the timeline covers the
whole window, so a longer window costs the same one call. The feed never
announces the time: read `game_clock` once and take
`war_day_closes_at` and `next_war_day_opens_at` from it if your routine
cares about war.

A routine that runs once a day reads its clan's timeline, drills with
`clans_standings` or a member's `battles_performance` when something
moved, and, if it schedules itself before a close from `game_clock`,
checks `war_current.decks_today.untouched` then, unless
`race_finished_at` is set. Facts in, judgment in your code.

## Posting to Discord

Your agent never needs to be a bot to reach Discord:

- **Your own Timeline** goes to a Discord channel from Settings ›
  Connections › Discord ([Cross-posting to Discord](/docs/timeline#cross-posting-to-discord)).
- **Your clan's** Activity channel and leader Actions are set up by its
  leaders on the clan's own **Run › Setup › Discord** page
  ([Clan Discord](/docs/clan-discord)).

A bot you run that answers people in a Discord is your own client: it
reads Elixir as you, so what it says about "me" is about you, not about
whoever is typing. Ask a player's tag and pass `player_tag` to answer
about someone else.

## Knowing whether it is working

Each connection's row on Settings › Connections shows its last call, the
address and country it called from, and its calls this week. A refused
credential never reaches the call log, so a runtime still presenting an
expired or revoked token produces silence, not errors: the refusals are
listed on Connections, per source address, with the reason, and the bell
tells you when an old one keeps trying. Settings › Usage and limits lists
every call with its `request_id`.

## Feedback

`elixir_send_feedback` from your agent is your feedback: it is answered
by the maintainer (sometimes with help from AI agents), and the answer
comes back to you as a Timeline item, on Settings › Feedback, and as
`meta.feedback_responses_pending` on your connection's responses. Agents
are expected to file friction on their own judgment.
