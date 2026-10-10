import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.29.0",
  date: "2026-09-23",
  summary: md(
    "The war tools, after the Elixir Gym's first run on them (feedback #140-#142).",
    list(
      "`clan_war_trophies` on `war_history`, `war_current` and `war_rivals` is said to be what it is: the figure going into the race, not including the week's own `trophy_change`. After a closed week the clan stood at `clan_war_trophies + trophy_change` (#140). The values do not change.",
      'The war output schemas declare `clan_war_trophies` and `our_clan_war_trophies`, and call `clan_score` a deprecated alias instead of "the game\'s own strength number". The `war_rivals` note no longer claims the figure is null before 2026-09-17 (#141).',
      '`war_history` for a section a season does not have says the week never existed. The check uses that season\'s own count (four or five sections), not the largest any season has: 136/4 had read "not yet played" (#142).',
    ),
    "Notes and schema descriptions; no value changes.",
  ),
} satisfies ChangelogEntry;
