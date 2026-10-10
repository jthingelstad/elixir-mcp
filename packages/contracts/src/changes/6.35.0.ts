import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.35.0",
  date: "2026-09-23",
  summary: md(
    "The player tools, after the Elixir Gym's second run on them (feedback #171-#172).",
    list(
      "`fit_for` on battles_meta_decks and battles_meta_cards carries `recent_mean_level`, the level the player fields now (their last ten decided battles, as players_collection serves it). `vs_fielded` and the upgrade targets read against it, and a note says when the player is levelling up. The 30-day mean alone had told a levelling account to upgrade to where it already plays (#171).",
      "players_summary declares both `trophy_range`s and says how they differ: `trophy_floor.trophy_range` is trophies landed on after each ladder battle, and a deck's is the trophies its battles started at. `best_deck` is declared with `top_deck`'s properties, and `last_played_at` is declared (#172). The values are unchanged.",
    ),
    "Additive fields and descriptions; the upgrade target moves to the recent level.",
  ),
} satisfies ChangelogEntry;
