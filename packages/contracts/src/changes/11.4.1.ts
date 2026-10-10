import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.4.1",
  date: "2026-10-08",
  summary: md(
    "The first time Elixir reads a clan's roster is a baseline, not a wave of joins: elixir_timeline and players_timeline no longer say a player joined a clan they were already in when Elixir first saw them there.",
    list(
      "players_timeline, elixir_timeline and the clan timelines: a membership Elixir first saw on a clan's first roster read, or on the first read that recorded that member (a clan read only for its tracked players that then becomes tracked), is not a clan_joined moment. A join Elixir saw happen between two reads still is. Moments written before 11.4.1 are unchanged.",
      "elixir_timeline: an account event about a clan names the clan (clan added (#CLAN)), and one Elixir made on its own says so, with the player whose clan it followed.",
    ),
    "Patch: no arguments or output fields change. JSON API 3.1.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
