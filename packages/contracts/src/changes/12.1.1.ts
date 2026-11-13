import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "12.1.1",
  date: "2026-11-13",
  summary: md(
    'Clan is a part of Elixir, and the tools now name it Clan, never "Elixir Clan" or a family app:',
    list(
      "`attested_by.app` on a fact Clan recorded reads `Clan` (it read `Elixir Clan`); the stored source is unchanged, and a family app's fact keeps its own name.",
      "`clans_my_view` and `clans_directory`: the title, description and notes say Clan.",
    ),
    "Wording only; no field, argument or refusal changed. The JSON API is unchanged.",
  ),
} satisfies ChangelogEntry;
