import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.12.4",
  date: "2026-09-27",
  summary: md(
    "The opening brief arrives whole (review §6.1-6.2). `instructions` ran about 4,500 characters and Claude Code hands a model the first 2,048, so START, the feedback line and half the rules never arrived. It now fits 2,048 in order of value: who you are (the other players and clans you track by name while they fit, otherwise counted; `elixir_my_players` lists them), the one-line rules, START, feedback, and one pointer to `elixir_docs` page `protocol`, section `argument-conventions`, for the window grammar and verbosity it no longer restates.",
    list(
      "A personal connection's `tools/list` leaves out the agent-only `on_behalf_of` and `display_name` (in `segment` too), about 6 KB; a call that still sends them is not refused, they are dropped.",
      "An error result no longer carries `structuredContent`: it is held to the tool's `outputSchema`, which an error envelope does not meet, so a strict client could discard the refusal. The same `{error, meta}` JSON is the text block, as before.",
      "`MCP-Protocol-Version` is checked after `initialize`: absent means 2025-03-26, an unsupported value is HTTP 400 with JSON-RPC -32600.",
      "An unknown argument's hint names the contract version and says to reconnect when a client cached `tools/list` earlier.",
    ),
  ),
} satisfies ChangelogEntry;
