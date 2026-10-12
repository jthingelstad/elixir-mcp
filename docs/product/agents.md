# MCP and agents

*Draft. Not yet ratified.*

## What it is for

MCP is how a person brings the record into a conversation with their own
agent: "how has my ladder win rate trended since I swapped Cannon for
Musketeer?" is a real, answerable question. It is one way to use Elixir,
an extension of the recorder, not a requirement. [Jamie, VISION, about]

## Who it serves

- **A person, as themselves.** Connecting Claude to `/mcp` connects as
  you: the tools know your primary, alts, friends and clan, and omitting
  a tag means you. One self, nothing to configure. [Jamie, 2026-09-08]
- **An agent, for a clan.** A principal the person owns, with its own
  door, key, timeline pointer and feedback inbox; "me" is the clan; its
  tier is capped at its owner's and it spends the owner's budget and
  slots. The family's Discord agent is one. [Jamie, 2026-09-08,
  2026-09-23]
- **Not integrations.** Programs read the JSON API; agents read MCP.
  [Jamie, 2026-09-25]

## Principles that decide the details

1. **Facts, and the agent may coach.** Elixir's tools return facts with
   their controls and notes; they recommend nothing and rate nobody. A
   person's agent, and the family's Discord agent, may coach and
   recommend from those facts; the suggestion is theirs, never presented
   as Elixir's. [Jamie, 2026-10-02, 2026-10-11]
2. **Refuse rather than choose.** With no clan given, the primary's
   current clan or `no_subject`; never an alt's, a friend's or a tracked
   clan. Segment tools name their population: "mine" or exactly one
   player or clan; corpus selectors refuse. [Jamie, 2026-10-02;
   engineering, 2026-09-19]
3. **Meaning rides on the value.** One name, one meaning; caveats as
   enums on the field explained once in a note; every tool publishes an
   output schema; conventions (`verbosity`, `days`, `season`) are schema.
   [Jamie, 2026-09-19 to 2026-09-25]
4. **The timeline is the agent's feed.** Each agent has its own pointer,
   a consumer may name a reader, and items carry `follow` so an agent can
   expand a story with the tools. [Jamie, 2026-09-13, 2026-10-11]
5. **`live_fetch` only fetches.** The payload reaches the caller, never
   the record; recording is a separate ask. [Jamie, 2026-10-08]
6. **A person's agent sees what the person sees.** In Clan too: the
   Actions waiting for them, their own standing, the policy; never
   another member's clock, and it never decides. `[proposed]` A clan
   agent sees the clan's attested facts and war intent, as today.
   [Jamie, 2026-10-04, 2026-10-12]
7. **Majors track domain shifts.** An agent reasons from the current
   declaration; removing an unreliable field is a patch; a major is a
   change in what a task means. `elixir_changelog(since)` says what
   shipped. [Jamie, 2026-09-25]

## What it never does

Recommend, rate or judge; pool a population; default to someone other
than you; record on a live fetch; show an agent its owner's private
account data.

## No deprecation window, while Elixir is small

Outside agents get what first-party ones get: the current declaration,
and `elixir_changelog(since)` as the notice of what moved. Elixir keeps
moving fast; a window is not promised. [Jamie, 2026-09-25, 2026-10-12]

## Open

Nothing at the level of this page.
