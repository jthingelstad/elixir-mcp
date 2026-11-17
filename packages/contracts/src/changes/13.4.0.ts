import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.4.0",
  date: "2026-11-17",
  summary: md(
    "Other play modes are told as the game tells them. A sitting carries its Ranked league, climbs and Ultimate Champion rating, the followed players met in it, and each event's record, ruleset and challenge run.",
    list(
      "`elixir_timeline` (`battle_session` schema 4, `session_standout` schema 5): `facts.ranked` (`battles`, `won`, `lost`, `league_from`/`league_to` with their names, `promotions[]` each `{from, to, from_name, to_name, battle_id, at}`, and `rating` `{from, to}` over Ultimate Champion battles) when the sitting held a Ranked battle; `facts.together`, up to three players the record follows met in the sitting (`{player_tag, name, with, against}`: 2v2 partners and friendly or clanmate opponents); each `events[]` entry gains `won`, `lost`, `game_mode`, `drawn_decks` (drafted or handed-out decks) and `run_wins` (the most wins a challenge counter reached), and its `name` is one line. `decks` leaves out decks the player did not bring (draft, pick, preset). Correction: `trophy_net_by_mode.ranked` now counts only Ultimate Champion's rated changes, never the +30 a win below it, so it no longer equals `battles_performance`'s Ranked share of `net_trophies` for a sitting below Ultimate Champion. Sentences say \"Ranked\", the game's name since June 2025, for Path of Legends.",
    ),
    "Additive, with the `trophy_net_by_mode.ranked` correction. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
