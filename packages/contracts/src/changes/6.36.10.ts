import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.10",
  date: "2026-09-23",
  summary: md(
    "The battles tools, after the Elixir Gym's fourth run on them (feedback #199-#200).",
    list(
      "`trophy_mode_battles` on `battles_performance` and `battles_trends` also counts any battle that reported a trophy change. Past 14,000 the seasonal Trophy Road is event content (type trail, game mode Ladder) that still moves trophies, so a capped player's `trophy_battles` had exceeded the count it is a subset of (19 against 1 for one week). The trophy note no longer says event modes carry no trophies (#199).",
      "The `mode` argument's description lists `event` beside the other groups and says where the seasonal Trophy Road past 14,000 sits.",
    ),
    "Additive; trophy_mode_battles rises for players past 14,000.",
  ),
} satisfies ChangelogEntry;
