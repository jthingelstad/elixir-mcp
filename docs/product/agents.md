# MCP and your own AI

*Rewritten 2026-11-23 to "Elixir has people, not agents" in
[DECISIONS](../DECISIONS.md), from the brief Jamie ratified on
2026-11-13 ("I think the rest is good to go"), under
[`VISION.md`](../../VISION.md). The agent-account half of that brief is
removed; its principles for a person's own connection stand as agreed.*

## What it is for

Connecting your own AI agent to Elixir over MCP stays core. [Jamie,
2026-11-11, `VISION.md`] It is how a person brings the record and their
corner of the social layer into a conversation with their own AI client:
"how has my ladder win rate trended since I swapped Cannon for
Musketeer?", or "what did my clan get up to this week?". It is a later
chapter of Elixir's story, not its opening: the public story opens with
the social layer, and Elixir is useful without an AI. [Jamie,
2026-11-12, "The public story opens with the social layer"]

## Who it serves

- **A person, as themselves, and only that.** Every MCP connection is a
  person's, by OAuth, at one endpoint, `/mcp`: the tools know your
  primary, alts, the players you follow and your clan, and omitting a
  tag means you. One self, nothing to configure. A person's own
  connection also reads their own view of Clan (`clans_my_view`).
  [Jamie, 2026-09-08, 2026-10-12, 2026-11-23]
- **No agent accounts.** Elixir has no principal that acts for a clan,
  no per-clan door, no key a person can make, and no argument that
  names a different human. "Now that 'Clans' are real entities in
  Elixir -- we can just associate config and web hooks and such with
  Clans as they are" [Jamie, 2026-11-23]: a clan's Discord and its
  other setup belong to the clan, set up by its leaders in Clan.

## Principles that decide the details

1. **Your AI reads the social layer and never writes it, save a follow
   you ask for.** It reads follows and followers (`players_follows`),
   posts with battle attachments (`players_highlights`), the public clan
   directory (`clans_directory`) and reactions to your own items and
   posts (`elixir_cheers`). It never cheers, highlights or posts. It may
   follow a player when you ask ("an agent should be able to follow a
   player tag if a user asks it"), in your own slots, as a friend, never
   as you. [Jamie, 2026-11-12, 2026-11-17]
2. **Follow, never track.** The tools, the scope (`follows:write`) and
   every word say follow. [Jamie, 2026-11-12]
3. **Facts, and your AI may coach.** Elixir's tools return facts with
   their controls and notes; they recommend nothing and rate nobody. A
   person's AI may coach and recommend from those facts; the suggestion
   is theirs, never presented as Elixir's. [Jamie, 2026-10-02,
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
6. **The Timeline is your AI's feed.** A consumer may name a reader with
   its own pointer, and items carry the reads that expand them. What a
   connection has read never moves the app's New. [Jamie, 2026-09-13,
   2026-10-11, 2026-10-20]
7. **`live_fetch` only fetches.** The payload reaches the caller, never
   the record; recording is a separate ask. [Jamie, 2026-10-08]
8. **A person's connection sees what the person sees.** In Clan: the
   Actions waiting for them, their own standing line, the policy; never
   another member's clock or a removal, and it never decides. [Jamie,
   2026-10-04, 2026-10-12, 2026-10-13, 2026-11-12]
9. **A breaking change is Jamie's call.** A client reasons from the
   current declaration. A tool change that breaks a caller is asked up
   front and stated in its pull request. `serverInfo.version` is a
   fingerprint of the tools and moves with any declaration; What's new
   (`elixir_updates`) tells what changed. [Jamie, 2026-09-25, 2026-11-23]

## What it never does

Recommend, rate or judge; pool a population; default to someone other
than you; record on a live fetch; write a cheer or a highlight; show a
connection anything its person could not see; give a clan or a bot an
identity of its own.

## Discord

Elixir's own Discord is Clan's webhooks, set up by a clan's leaders on
the clan's Run ▸ Discord page, with no bot to run; a person's own
Timeline can be cross-posted to Discord from their Settings. A bot built
on MCP is an outside client and connects as a person, like any other.
[Jamie, 2026-11-11, 2026-11-23]

## No deprecation window, while Elixir is small

Outside clients get what first-party ones get: the current declaration,
a fingerprint that moves when a declaration does, and What's new for the
changes worth telling. Elixir keeps moving fast; a window is not promised.
[Jamie, 2026-09-25, 2026-10-12, 2026-11-23]

## Open

Nothing at the level of this page.
