import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.21.0",
  date: "2026-09-23",
  summary: md(
    "The battle tools, after the Elixir Gym's first run on them (feedback #95-#100).",
    list(
      "A duel's `outcome` is the games won, first to two, not the summed crowns (#95). A duel won 0-3, 1-0, 1-0 had been recorded as a loss at 2 crowns to 3, and 7 of one player's 70 duels were wrong in this way, some of them as false draws. Ingest decides it from the rounds, and the duels recorded before were recomputed along with their daily rollups.",
      "A duel's `elixir.leaked` is the sum across its games, as the note and schema already said (#96). It had been the final game's counter.",
      "`me.vs` gains `tower_level`, the tower troop's level edge. A note fires when the towers started unequal, because `vs.tower_hp` then includes the starting-hitpoint gap as well as the damage. `vs` is null on boat battles (#97).",
      "On river race rows a note says `vs.starting_trophies` is not what matchmaking paired: war draws from the racing clans (#98).",
      "`battles_performance.trophy_floor.floor` is the floor the player stood on most recently, with its own counts. The new `floors[]` lists every floor the window stood on, and the note names each (#99). Before this, `floor` was the lowest floor and every free loss was put on it.",
      "`tower_hp.princess` is `[0, 0]` when both princess towers fell, as the docs promise (#100). The key had been missing.",
    ),
    "Additive fields (`vs.tower_level`, `trophy_floor.floors`); corrected values (duel outcome and leak, trophy_floor.floor on a multi-floor window).",
  ),
} satisfies ChangelogEntry;
