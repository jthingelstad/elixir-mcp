import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.22",
  date: "2026-09-24",
  summary: md(
    "Boat defenses leave `clans_standings` (Jamie, 2026-09-24; Gym #263.3).",
    list(
      "A boat defense is an enemy attacking the clan's boat, answered by the member's defense deck: the member did not play it. `clans_standings` no longer counts one in a member's battles, wins, losses, win rate, streak or level gap; war days had stopped counting them in 7.1.7. A member attacked often had shown a war win rate made of games they never played.",
      "The daily rollups count each day's defenses apart (0171), so every reader can tell them from battles played. `battles_query` still lists defenses, with `boat.side`.",
    ),
    "Changes a number: standings win rates move for members whose boat was attacked.",
  ),
} satisfies ChangelogEntry;
