import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.18.1",
  date: "2026-11-06",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md(
    'A correction to 11.18.0: `elixir_docs` and `elixir://docs/<page>#<section>` follow a moved section when it is asked for by its old title as well as its old slug, so `elixir_docs({ page: "recording", section: "Daily series" })` answers again.',
    "The examples in the descriptions of `elixir_nickname` and `players_search` use made-up names. No argument, field or error changed.",
  ),
} satisfies ChangelogEntry;
