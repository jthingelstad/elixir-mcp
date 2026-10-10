import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.22.2",
  date: "2026-09-06",
  summary:
    "Correctness fixes in adding and removing players, both of which agents hit directly. elixir_add_player with make_primary now SWITCHES the primary instead of failing on a uniqueness violation, and works on a player you have already added. elixir_remove_player, when you remove your primary while other players remain, promotes the oldest remaining one and returns it as primary_player_tag - previously the account was left with no primary at all and every default-player tool answered not_found. A shared recording now stops when its LAST subscriber removes it, in any order; it used to require the account that first added it, so the wrong order left the recording running forever. Player-slot limits are now enforced atomically, so concurrent adds cannot overshoot the cap.",
} satisfies ChangelogEntry;
