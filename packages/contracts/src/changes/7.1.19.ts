import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.19",
  date: "2026-09-24",
  summary: md(
    "The collections tools after the Elixir Gym's fifth run on them (feedback #308-#309).",
    list(
      "The clan-segment coverage note says the uncounted members are not recorded now, so none of their battles count, not even ones captured while they were. It had said they appear only in recorded players' battles, which was untrue of a member whose own log had been polled (#308).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
