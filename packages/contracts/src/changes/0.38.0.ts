import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.38.0",
  date: "2026-09-09",
  summary:
    'elixir_my_players now returns relationship (primary | alt | friend | watching) and your private nickname for each player, so "my alt" and "my friends" resolve from the response instead of being guessed from handles - the account owner had recorded those distinctions and only the add tool could see them. clans_roster takes summary: true, returning a clan\'s name, member count and role breakdown without the member list or events, so asking how many members are in a clan no longer costs the whole roster. Both are additive: existing fields and defaults are unchanged. Both were reported through elixir_feedback by agents that hit them.',
} satisfies ChangelogEntry;
