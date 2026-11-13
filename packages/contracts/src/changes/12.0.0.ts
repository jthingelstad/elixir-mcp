import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "12.0.0",
  date: "2026-11-13",
  summary: md(
    'Follow, never track (DECISIONS "Agents read the social layer and never write it"): the tools say follow, as the app does, and an agent now reads the social layer it never writes. Four read-only tools, for a person\'s own connection and their agents (an integration is refused with not_entitled):',
    list(
      "`players_follows`: who a player follows and who follows them, with their badges, as their player page shows it.",
      "`players_highlights`: the highlights a player posted, newest first, with the words they wrote and the battle link.",
      "`clans_directory`: the clan directory as Home's Clans page lists it: each clan whose leaders saved a policy, with its recorded tile and the policy's public part; `yours` marks a clan one of your (your owner's) verified players is in.",
      "`elixir_cheers`: the cheers other people gave the items about your primary player, as counts by kind, never who.",
    ),
    "Five tools are renamed and four retire, with no aliases (see breaking); refresh tools/list. The JSON API is 3.6.0, a minor: four new GET operations mirror the new tools, and the operations mirroring the renamed tools keep their paths.",
  ),
  tools_added: [
    "players_follows",
    "players_highlights",
    "clans_directory",
    "elixir_cheers",
  ],
  breaking:
    'Renamed: elixir_track_player is elixir_follow_player, elixir_track_clan is elixir_follow_clan, players_timeline is players_series, clans_timeline is clans_series, clans_members_timeline is clans_members_series (arguments and results unchanged). Retired: elixir_identify (a person who connects Discord in their Elixir Settings is known by on_behalf_of "discord:<user id>"; otherwise ask who they are and pass player_tag; mappings made before 12.0.0 still resolve); clans_context (read clans_directory); battles_trends (folded into battles_performance: pass segment, "mine" or a clan or player, for that population\'s weeks[]); elixir_data_insights (its numbers stay public at /api/public/stats and on the site\'s /data page).',
} satisfies ChangelogEntry;
