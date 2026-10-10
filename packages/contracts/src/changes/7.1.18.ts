import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.18",
  date: "2026-09-24",
  summary: md(
    "The clan tools after the Elixir Gym's fifth run on them (feedback #305-#307).",
    list(
      "`clans_members_timeline` compact: `delta.donations` and `delta.donations_received` are what the weekly counter added across the window, a reset counted from zero. Last minus first had read the Monday reset as a loss: 28 of 48 members negative over one week (#305).",
      "`war_history.member_weeks[].training_decks` rebuilt for weeks before 2026-09-24 now splits training days where the clan's own race rolls them (its recorded close slot, e.g. 09:38Z), not at 10:00Z: battles in that gap had landed on the wrong day and been cut by the four-a-day cap (#306).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
