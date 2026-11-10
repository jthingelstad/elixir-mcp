import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.18.6",
  date: "2026-11-10",
  summary: md(
    "Adding a player now reads its battle log on the live lane right after its profile, so roughly the last 30 battles arrive within a minute instead of at the scheduler's next round (Jamie, 2026-11-09).",
    list(
      "`elixir_track_player` (`action: add`, a new tag): the first read asks for the profile and then the battle log, both live, from the pool's daily first reads (one profile and one battle log per player slot). Its notes say both are on their way, and usually land within a minute, when both were asked; when the battle log was refused (the live bucket empty, the day's first reads used) the notes keep the old wording and the scheduler reads it.",
    ),
    "Wording and behaviour only: no field changes. The JSON API's `POST /api/v1/me/players` runs the same add and is unchanged in shape.",
  ),
} satisfies ChangelogEntry;
