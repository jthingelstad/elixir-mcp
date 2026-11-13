# 2026-11-12 — Follow, never track: the words people read

Jamie, 2026-11-12: "track" becomes "follow" everywhere (DECISIONS,
"Follow, never track"). This first of four pull requests changes the words
a person reads: the web app, the public docs, the site's data page and the
web API's messages. The MCP tool names, their descriptions and refusals, the
OAuth scope and the JSON API come in the MCP major that follows, and storage
names are left (see the last section).

## The vocabulary, as the code has it

| State in the code | What it does | Word before | Word now |
| --- | --- | --- | --- |
| a claim, `relationship = primary` | you; what an omitted tag means | your player, "tracked" | your player (added, never "followed") |
| a claim, `relationship = alt` | also you; Stats opens | alt, "tracked" | alt |
| a claim, `relationship = friend` | followed on purpose; first in the digest; Stats opens | friend, "you follow" | friend, "you follow" (unchanged) |
| a claim, `relationship = watching` | recorded; after friends in the digest; Stats refused (`not_followed`); what an agent's follow always is | "watching", "you watch them" | **unchanged**: "watching" behaves differently from a friend, so it keeps its word |
| any of the four, as the umbrella (Elixir records the player because of you) | the slot, the reason to record | track, tracked, tracking | follow, followed, following |
| an `account_clan` row (scope activity or comprehensive) | records the clan, and at comprehensive every member | track a clan, tracked clan | follow a clan, followed clan |
| Settings' page for all of it | `/settings/players` | Players & tracking | Players & following |

The add button for a player or a clan says **Follow**; the stop button says
**Stop following** (a watched player's row on What members see already said
**Stop watching**, and keeps it). Your own first player is **added**, never
followed: "Add your player" in the quickstart and the examples.

## Left as it was, on purpose

- "Email tracking", the open/click "tracking" that SES never does, an
  invite's "tracking parameter", and "on track" in Clan's awards: other
  meanings of the word.
- The recording internals: the "tracked-only" correction, a roster read's
  "membership tracking", the scheduler's and ingest's comments.
- Code identifiers and storage: `Tracking.jsx`, `TrackedRecord.jsx`, the
  event group key `tracking`, `signals.tracking`, the `untracked` card
  state, `/console/account/tracking` redirects. A rename there changes
  nothing anyone reads.
- Admin-only text (the clan preview's error).

## Doc anchors

Three headings moved with their words, and `docForwards.js` keeps the old
addresses answering: `agents#what-an-agent-tracks`,
`roles#tracked-means-recorded` and `quickstart#2-track-your-player`.

MCP and the JSON API unchanged; no migration.
