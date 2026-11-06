import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.18.3",
  date: "2026-11-06",
  // What an agent must know: a lede paragraph, one bullet per tool, then
  // the closing line (Additive, or what changed for the JSON API). Add
  // tools_added for a new tool and breaking for a major. The changelog
  // test fails while this is empty.
  summary: md(
    "Words only: refusals and one hint now use the app's names.",
    list(
      "`elixir_track_clan`: a slot refusal names your role, not your tier. The code and fields are unchanged.",
      "A missing capability's hint points to Settings, Connections & agents.",
    ),
    "Additive. The refusal codes are unchanged, and so is the JSON API.",
  ),
} satisfies ChangelogEntry;
