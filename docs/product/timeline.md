# Timeline

*Draft. Not yet ratified.*

## What it is for

Most of Elixir answers a question. The timeline is the other direction:
it tells a person, or their agent, what happened to the players and
clans they track since they last looked, newest first, like a newsfeed,
"written so a person can read it and an agent can act on it." It is the
notification feed of the record, and the one source every delivery
surface tells from. [Jamie, 2026-09-13, 2026-09-23]

It is the spine of delivery: everything Elixir tells a person, in the
console, by mail, in Discord or to an agent, is a timeline item or a
digest of items, so one derivation feeds every surface and a story is
got right in one place. [Jamie, 2026-10-12]

It is chatty by design. "Agents and users should learn a lot from it
with almost no editorial filtering"; on a fifty-member clan it is high
volume, and that is the point. Judgment about what is worth telling
lives above it, in the editors. [Jamie, 2026-10-11]

## Who it serves

- **A person**, in the console, by mail, and cross-posted to a Discord
  channel of their own: every player they track with notifications on,
  every clan they added.
- **An agent**: the clans it tracks (members appear on the clan's
  timeline, never as subjects of their own) and the players it watches.
  Every agent has its own read pointer, and a consumer may name a
  `reader` for a pointer of its own. [Jamie, 2026-09-13, 2026-10-08]
- **The editors.** Elixir Clan's Discord stories and the family's Discord
  agent read the same feed and decide what to tell. [Jamie, 2026-10-11]

## Principles that decide the details

1. **The record is the trigger.** An item exists because the record
   admitted something: a sitting, a crossing, a roster change, a war
   week, an attested fact. A moment names the battle that caused it and
   how; absence over a guess; replays and backfills write rows, never
   moments; a late capture is counted, never narrated. [Jamie,
   2026-09-15 to 2026-09-17]
2. **One story is one item.** An `id` names the happening, not the
   reader; a story that grows (a sitting, a proof that lands late) is the
   same id at a higher revision, an update and never a retelling. A story
   about a friend who is also a clanmate is one item naming both.
   [Jamie, 2026-10-11]
3. **Publication-grade.** Each item is one time-free sentence about its
   subjects in their in-game names, with the facts it was written from,
   its visibility, whether it may be published, and where it leads
   (`follow`: the reads that expand it). Nicknames ride in their own
   field and are never published. [Jamie, 2026-10-11]
4. **Newest first, keep the newest.** Past the cap the newest items are
   served and the older ones counted, so a reader back after days lands
   on now. Two windows: what happened (occurred) and what the record
   learned (observed, the poller's, so nothing learned late is skipped).
   [Jamie, 2026-09-23]
5. **Facts, never advice.** The text states what happened and lets the
   reader conclude; coaching belongs to the person's agent. [Jamie,
   2026-10-11]
6. **Visibility travels with the item.** Public game facts; clan, player
   or leaders for attested facts by their type; owner for the account's
   own administration. Leaders-only and owner items are never
   publishable, and nothing of Elixir's posts an item that is not.
   [Jamie, 2026-09-25, 2026-10-11]
7. **Three layers tell it.** The hub serves everything, unfiltered, and
   makes items easier to expand, never shorter. Elixir Clan's Discord is
   an editor: code or the clan's model frames stories under the clan's
   policy. The family's Discord agent is a storyteller that may judge
   what is worth a post and tell "aha" moments. [Jamie, 2026-10-11] The
   agent is the conversational product for any clan that wants
   conversation in Discord, run by the clan on its own tokens; a
   person's own agent is for the person's own questions. Its guide's
   "Ask Elixir goes away" direction is retired. [Jamie, 2026-10-12]
8. **A person's cross-post is unfiltered and event-driven.** The owner
   turns it on in the console for their own timeline or an agent's; one
   line per item, edited in place as the story grows, links back and no
   embeds, no backfill, no time of its own unless the item is over three
   hours old. [Jamie, 2026-10-10, 2026-10-11]

## What it never does

Thin itself for editorial reasons; queue, fan out or prune (it is
synthesized at read); narrate a backfill or a late capture; publish a
nickname, a leaders-only item or the account's own lines; give advice.

## Discord, where we are learning

Discord receives posts (a person's cross-post, Clan's Actions and
stories) and the family's agent converses there. Acting (deciding an
Action, marking away) stays in Elixir for now, until the posting and the
agent have shown what members actually do in Discord; this is the one
area the briefs leave deliberately open. [Jamie, 2026-10-12]

## Open

- **Acting from Discord** is undecided on purpose (above). Default in
  force: a channel; every write happens in Elixir.
