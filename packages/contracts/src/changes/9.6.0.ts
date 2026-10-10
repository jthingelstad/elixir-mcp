import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.6.0",
  date: "2026-09-25",
  summary: md(
    "A new attested fact, `award_standing`: where a member stands in one of the clan's own awards for a season still running (the award's name and id, the season, the place, the value and its unit, as of when, and `previous_player_tag` when the place changed hands). The awards and their rules are the clan's app's (Elixir Clan), so it computes the standing and writes it on its own integration key each morning, labelled as the app's, never a person's; the clan and its agent see it on the timeline (`kinds: [\"award_standing\"]`, section `attested`). A clan's agent can now answer \"who leads War Champ\" in the clan's own terms and notice a lead change. Additive; JSON API 2.6.0.",
  ),
} satisfies ChangelogEntry;
