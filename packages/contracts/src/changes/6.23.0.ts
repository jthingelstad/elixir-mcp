import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.23.0",
  date: "2026-09-23",
  summary: md(
    "The clan tools, after the Elixir Gym's first run on them (feedback #110-#112).",
    list(
      "`clans_participation` `war_weeks[]` carries `finished_early` and `finish_war_day`, and members carry `war_scoring_decks` at full verbosity (#110). A note names every war week that finished early. Decks played after the boat crossed earn 0 points, so `war_points / war_decks` is not a rate on those weeks: 15-19% of the decks shown in the last two weeks were such decks.",
      "`clans_timeline` says that its profile-derived values, the `members_*_plus` counts included, cover only the members whose profile was polled that game day. It names the days where that was fewer than all. The game day in progress carries `partial: true` (#111).",
      "`clans_roster` keeps `notes` and `docs` at compact and serves `role_counts` at full (#112).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
