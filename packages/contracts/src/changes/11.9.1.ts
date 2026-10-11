import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.9.1",
  date: "2026-10-11",
  summary: md(
    "Corrections to 11.9.0's follow addresses on elixir_timeline items.",
    list(
      "elixir_timeline: a sitting's battles_performance address spans from its first battle to one second past its last, so the read holds every battle the sitting counts (battle windows end before to).",
      "elixir_timeline: a player's own clan_joined or clan_left leads to players_summary only; the clan it names may be one nobody records, where clans_roster answers not_recorded. A clan's member_joined, member_left and member_role_changed keep their clans_roster address.",
    ),
    "A correction: fields and shapes are unchanged. JSON API 3.1.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
