# MCP and agents

*Rewritten 2026-11-13 to the social layer, from the brief Jamie ratified
on 2026-10-12, under [`VISION.md`](../../VISION.md) and the rulings in
[DECISIONS](../DECISIONS.md) of 2026-11-11 and 2026-11-12. It waits on
Jamie's read; where it and DECISIONS disagree, DECISIONS wins.*

## What it is for

Connecting your own AI agent to Elixir over MCP stays core. [Jamie,
2026-11-11, `VISION.md`] It is how a person brings the record and their
corner of the social layer into a conversation with their own agent:
"how has my ladder win rate trended since I swapped Cannon for
Musketeer?", or "what did my clan get up to this week?". It is a later
chapter of Elixir's story, not its opening: the public story opens with
the social layer, and Elixir is useful without an agent. [Jamie,
2026-11-12, "The public story opens with the social layer"]

## Who it serves

- **A person, as themselves.** Connecting a client to `/mcp` connects as
  you: the tools know your primary, alts, the players you follow and
  your clan, and omitting a tag means you. One self, nothing to
  configure. A person's own connection also reads their own view of
  Clan (`clans_my_view`). [Jamie, 2026-09-08, 2026-10-12]
- **An agent, for a clan.** A principal the person owns, on a page of
  its own in Settings (five tabs, nothing to switch into), with its own
  door, key, timeline pointer and feedback inbox. It acts for one clan,
  which omitting a clan tag means; its tier is capped at its owner's and
  it spends the owner's budget and slots. A linked Discord tells it which
  member is asking. [Jamie, 2026-09-08, 2026-09-23, 2026-10-24,
  2026-11-05]
- **Not integrations.** Programs read the JSON API; agents read MCP.
  [Jamie, 2026-09-25]

## Principles that decide the details

1. **Agents read the social layer and never write it, save a follow the
   person asks for.** An agent reads follows and followers
   (`players_follows`), highlights (`players_highlights`), cheers on your
   items (`elixir_cheers`) and the clan directory (`clans_directory`). It
   never cheers, highlights or posts. It may follow a player when the
   person asks ("an agent should be able to follow a player tag if a
   user asks it"), as a watched player in the person's pooled slots.
   [Jamie, 2026-11-12]
2. **Follow, never track.** The tools, the scope (`follows:write`) and
   every word say follow. [Jamie, 2026-11-12]
3. **Facts, and the agent may coach.** Elixir's tools return facts with
   their controls and notes; they recommend nothing and rate nobody. A
   person's agent may coach and recommend from those facts; the
   suggestion is theirs, never presented as Elixir's. [Jamie, 2026-10-02,
   2026-10-11]
4. **Refuse rather than choose.** With no clan given, the primary's
   current clan or `no_subject`; never an alt's, a friend's or a followed
   clan. Segment tools name their population: "mine" or exactly one
   player or clan; corpus selectors refuse. [Jamie, 2026-10-02;
   engineering, 2026-09-19]
5. **Meaning rides on the value.** One name, one meaning; caveats as
   enums on the field explained once in a note; every tool publishes an
   output schema; conventions (`verbosity`, `days`, `season`) are schema.
   [Jamie, 2026-09-19 to 2026-09-25]
6. **The timeline is the agent's feed.** Each agent has its own pointer,
   a consumer may name a reader, and items carry the reads that expand
   them. What an agent has read never moves the app's New. [Jamie,
   2026-09-13, 2026-10-11, 2026-10-20]
7. **`live_fetch` only fetches.** The payload reaches the caller, never
   the record; recording is a separate ask. [Jamie, 2026-10-08]
8. **A person's connection sees what the person sees.** In Clan: the
   Actions waiting for them, their own standing line, the policy; never
   another member's clock or a removal, and it never decides. A clan
   agent reads the clan's attested facts by their visibility, never a
   leaders-only one, and the policy through the clan directory. [Jamie,
   2026-10-04, 2026-10-12, 2026-10-13, 2026-11-12]
9. **Majors track domain shifts.** An agent reasons from the current
   declaration; removing an unreliable field is a patch; a major is a
   change in what a task means. `elixir_changelog(since)` says what
   shipped. [Jamie, 2026-09-25]

## What it never does

Recommend, rate or judge; pool a population; default to someone other
than you; record on a live fetch; write a cheer or a highlight; show an
agent its owner's private account data or a clan's private state.

## The Discord agent is an experiment

elixir-mcp-discord is "an experiment of an LLM using MCP to be a clan
agent", run on its own tokens and growing more separate from Elixir. It
is a clan agent like any other; Elixir's own Discord is Clan's webhooks.
[Jamie, 2026-11-11]

## No deprecation window, while Elixir is small

Outside agents get what first-party ones get: the current declaration,
and `elixir_changelog(since)` as the notice of what moved. Elixir keeps
moving fast; a window is not promised. [Jamie, 2026-09-25, 2026-10-12]

## Open

Nothing at the level of this page.
