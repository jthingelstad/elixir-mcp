import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.17.1",
  date: "2026-11-06",
  summary: md(
    "Refusals and hints name where a person goes now: Settings, not the Console. No field, argument or code changed.",
    list(
      "`clans_my_view`: its refusal says Settings, Players, Verify.",
      "`elixir_track_player`: removing a primary and the first read's note name Settings and the player's page.",
      "`elixir_track_clan`: changing the clan an agent acts for is on the agent's page in Settings.",
      "Agent identity hints name `/settings/connections/discord` for connecting Discord.",
    ),
    'The stored feedback value `area: "console"` is unchanged. Additive: nothing changes for the JSON API.',
  ),
} satisfies ChangelogEntry;
