import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "14.0.0",
  date: "2026-11-18",
  summary: md(
    "Watching has retired. Every other player you follow is a friend, with the same recording slots and notification choices.",
    list(
      "`elixir_follow_player`: relationship is primary, alt or friend; watching is no longer accepted. A later unnamed player and every agent follow use friend. A person's first unnamed player remains primary, and an agent still cannot claim a player as itself.",
      "`elixir_my_players` and the connection's opening list friends together. Existing watched claims become friends in place, preserving their dates, private nicknames, settings and recording. No follow event, account link or delivery is created by the migration.",
      "For a person, every friend follow now has the same social visibility and Stats access. Agent follows stay on that agent and create no social writes. Explicit new person follows retain ordinary verified-account linking; existing subscriptions are not expanded by the migration.",
      "Repeated elixir_follow_player additions report the stored relationship and notification choice. A muted primary or alt stays that. Person follows and relationship changes preserve two-way blocks, including unnamed later additions.",
    ),
    "Domain change and MCP major approved by Jamie on 2026-11-17 (US Central). JSON API 6.0.0 removes watching from the /api/v1/me relationship enum; its path and other fields are unchanged.",
  ),
  breaking:
    "The watching relationship is retired with no alias. Use friend for any non-self player follow, including agents. Existing watched relationships are migrated silently.",
} satisfies ChangelogEntry;
