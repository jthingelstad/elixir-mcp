import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.16",
  date: "2026-09-24",
  summary: md(
    "The timeline after the Elixir Gym's sixth run on it (feedback #302-#304).",
    list(
      "A member read (`player_tag`) says a sitting still being learned comes back in the next read with a running total under the same `started_at`, since a member read keeps no pointer: keep the newest (#302).",
      'The clan entry summary ends every capped list with +N: quiet, back, new bests, ranked and standout sessions. "back:" had named 3 of 12 returns and read as complete (#303).',
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
