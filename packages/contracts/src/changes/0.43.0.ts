import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.43.0",
  date: "2026-09-10",
  summary:
    "The service documents itself over MCP. elixir_docs returns the documentation index (every page with its section and lede), one page as Markdown by slug, or the pages matching a query with an excerpt around the first hit; elixir_examples returns the eleven worked examples - the question somebody asks, the answer, what it reads, the tools it calls and how to set it up - as an index or one by slug; elixir_updates returns what shipped, newest first, optionally since a date. All three read the same sources the public site renders from, built into the door at deploy, so an agent asked how to use Elixir MCP answers from the same text a person reads at elixir.poapkings.com/docs. Read-only, cr:read, no account data.",
  tools_added: ["elixir_docs", "elixir_examples", "elixir_updates"],
} satisfies ChangelogEntry;
