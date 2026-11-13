# Timeline

*Rewritten 2026-11-13 to the social layer, from the brief Jamie ratified
on 2026-10-12, under [`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. It waits on
Jamie's read; where it and DECISIONS disagree, DECISIONS wins.*

## What it is for

The timeline is what you see in Elixir: the players you follow, newest
first, with your own play in it. The unit is the gaming session, not the
single battle ("just did 12 battles, here are the cards he played
with"), and around the sessions are the moments: a deck switch, a card
earned for the first time, a new arena, a new rank in ranked play, a
special badge. A player can pick one game from a session and highlight
it with a few words of their own; that battle is the one single-battle
item. [Jamie, 2026-11-11, `VISION.md`, "Timeline shape"]

It is also the spine of delivery: everything Elixir tells a person, on
Home, in the digest, in Discord or to an agent, is a timeline item or a
digest of items, so one derivation feeds every surface and a story is
got right in one place. [Jamie, 2026-10-12]

## Who it serves

- **A person**, on Home, in the digest, in their RSS feed and, if they
  turn it on, cross-posted to a Discord channel of their own: every
  player and clan they follow with notifications on. What the app shows
  as new is its own, "independent of what agents have seen via MCP".
  [Jamie, 2026-10-20]
- **A player's followers**, on the player page: that player's sessions,
  moments and highlights, for any signed-in member.
- **A clan**, on Clan's Feed: the clan's last seven days with its current
  members' highlights, and its leaders' Actions as items. [Jamie,
  2026-11-12, "Clan's Actions are notifications and timeline items"]
- **An agent**, over `elixir_timeline`: the players and clans it
  follows, with its own read pointer; a consumer may name a `reader` for a
  pointer of its own. [Jamie, 2026-09-13, 2026-10-08]
- **The editors.** Elixir Clan's Discord stories read the same items and
  decide what to tell. [Jamie, 2026-10-11]

## Principles that decide the details

1. **The record is the trigger.** An item exists because the record
   admitted something: a session, a crossing, a roster change, a war
   week, an attested fact, a highlight. A moment names the battle that
   caused it and how; absence over a guess; replays and backfills write
   rows, never moments; a late capture is counted, never narrated.
   [Jamie, 2026-09-15 to 2026-09-17]
2. **One story is one item.** An `id` names the happening, not the
   reader; a story that grows (a session, a proof that lands late, an
   edited highlight) is the same id at a higher revision, never a
   retelling. A story about a friend who is also a clanmate is one item
   naming both. [Jamie, 2026-10-11]
3. **Publication-grade.** Each item is one time-free sentence about its
   subjects in their in-game names, with the facts it was written from,
   its visibility, whether it may be published, and the reads that
   expand it. Nicknames ride in their own field and are never published.
   [Jamie, 2026-10-11]
4. **Newest first, keep the newest.** Past the cap the newest items are
   served and the older ones counted, so a reader back after days lands
   on now. Two windows: what happened (occurred) and what the record
   learned (observed, so nothing learned late is skipped). [Jamie,
   2026-09-23]
5. **The feed shows people's play.** Home's feed and the RSS feed carry
   sessions, moments and highlights; the account's own notices go to the
   bell. Every item stays in the timeline an agent reads. [Jamie,
   2026-11-12, "The feed shows only people's play"]
6. **People react; nobody comments.** A signed-in person cheers an item
   with one of six; counts are shown, never who. An agent reads cheers
   and never writes them. Cheers never go to mail or Discord. [Jamie,
   2026-11-11, 2026-11-12]
7. **Facts, never advice.** The text states what happened and lets the
   reader conclude; coaching belongs to the person's own agent. [Jamie,
   2026-10-11]
8. **Visibility travels with the item.** Game facts are for every
   member; attested facts reach the clan, the player or the leaders by
   their type; the account's own lines are the owner's. A decided Clan
   Action is on the clan's timeline for its leaders only. Leaders-only
   and owner items are never publishable, and nothing of Elixir's posts
   an item that is not. [Jamie, 2026-09-25, 2026-10-11, 2026-11-12]
9. **A shared post is public.** A highlight its owner shares opens
   without an account at its own link, with its link preview; so does a
   battle link someone sends. [Jamie, 2026-11-11, "Everyone signs in;
   shared posts stay public"]
10. **Storing it is a performance choice.** The timeline is computed from
    the record unless a surface cannot reach 2 s at p95 that way; Home's
    week and the bell are stored and kept warm, and a stored item is
    never the authority over the record. [Jamie, 2026-11-09, 2026-11-12]
11. **A person's cross-post is unfiltered and event-driven.** The owner
    turns it on in Settings for their own timeline or an agent's; one line
    per item, edited in place as the story grows, a link back to the
    player page with no preview, no backfill, no time of its own unless
    the item is over three hours old. [Jamie, 2026-10-10, 2026-10-11,
    2026-11-12]

## Who tells it

- **Elixir** serves every item, in words written by code, and makes items
  easier to expand, never shorter. [Jamie, 2026-10-11]
- **Elixir Clan's Discord** is an editor: code, or the clan's own model
  in a voice its leaders write, frames stories for the clan's channel,
  each linking back to Elixir with no preview. [Jamie, 2026-10-11,
  2026-11-12]
- **A person's own agent** may judge, coach and tell what is worth
  telling; the judgment is the agent's. The Discord agent
  (elixir-mcp-discord) is a separate experiment of an LLM using MCP as a
  clan agent, run on its own tokens, and not part of how Elixir tells
  the timeline. [Jamie, 2026-11-11, "Clan posts to Discord by webhook;
  elixir-mcp-discord is a separate experiment"]

## What it never does

Narrate a backfill or a late capture; publish a nickname, a leaders-only
item or the account's own lines; show who cheered; give advice; let an
agent write a cheer or a highlight.

## Open

- **Acting from Discord** (deciding an Action, marking away) is
  undecided on purpose. Default in force: Discord is a channel, and every
  write happens in Elixir. [Jamie, 2026-10-12, 2026-11-11]
- **Comments**, whether and when, and the moderation they would need.
  Default in force: none. [`VISION.md`, Open]
- **A shared post in the clan's Discord** through Clan's webhook (Jamie,
  2026-11-12) is not built: which webhook, and whether leaders opt in.
