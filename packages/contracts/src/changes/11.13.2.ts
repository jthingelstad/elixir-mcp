import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.13.2",
  date: "2026-10-21",
  summary: md(
    "Path of Legends leagues carry the names the game uses: Master I, Master II and Master III, where Elixir said Master 1, Master 2 and Master 3. Champion to Ultimate Champion are unchanged.",
    list(
      "elixir_timeline: a `ranked_promotion` item's `from_name` and `to_name`, a summary entry's ranked notable and its league `from` and `to` name Master I to Master III with Roman numerals. A number outside the seven still reads `League <n>`.",
    ),
    "No field is added or removed. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
