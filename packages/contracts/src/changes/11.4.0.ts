import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.4.0",
  date: "2026-10-08",
  summary: md(
    "Adding a player now reads its profile once straight away, from the live lane within the one rate budget and at no cost to the caller, and Elixir follows the primary player's clan for the account at activity scope as soon as a profile shows one (accounts made from 2026-10-08 on).",
    list(
      "elixir_track_player: a newly added tag asks for one live profile read, at most once a day per tag. Its notes say the first capture usually lands within a few minutes with roughly the last 30 battles, that Clash Royale answered not found for a tag it does not know (when the last day's read said so), and when Elixir followed the primary player's clan for the account. One recording_started is logged per add (it was two).",
    ),
    "Additive: no arguments or output fields change. JSON API 3.1.0 is unchanged in shape; the Console's POST /api/me/players response gains first_read, not_found and clan_followed.",
  ),
} satisfies ChangelogEntry;
