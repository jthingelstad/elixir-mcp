import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.13",
  date: "2026-09-24",
  summary: md(
    "The battle tools after the Elixir Gym's fifth run on them (feedback #300-#301).",
    list(
      "A clan segment ('mine' or {clan_tag}) says it applies the clan's membership as of the call to the whole window: today's members' battles count, including ones from before they joined, and members who have left since do not. The collection segment and clans_standings already said so (#300).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
