import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.18.2",
  date: "2026-11-06",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md(
    "A description corrected; nothing an agent reads changes.",
    list(
      "`elixir_timeline`: a `session_standout`'s `at` is described as the battle that crossed the first new rung, which is what it has always been.",
    ),
    "Additive. The JSON API is unchanged.",
  ),
} satisfies ChangelogEntry;
