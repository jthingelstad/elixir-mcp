import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.13.1",
  date: "2026-10-16",
  summary: md(
    "elixir_timeline answers again on a war day. From 11.8.0, a clan's war line on the war day in progress (its decks tally) threw before the timeline was built, so every read that reached a tracked clan's war day failed from war day 1 on 2026-10-15. The tally's as_of is the earlier of the window's end and now, as 11.8.0 documented. No field changes. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
