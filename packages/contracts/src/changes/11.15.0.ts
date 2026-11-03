import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.15.0",
  date: "2026-11-03",
  summary: md(
    "A sitting on the timeline names each trophy mode's own net, so a Path of Legends or seasonal Trophy Road sitting no longer reads as flat beside `battles_performance` (feedback #381, #382).",
    list(
      "elixir_timeline: `battle_session` (schema 3) and `session_standout` (schema 4) gain `facts.trophy_net_by_mode`, each mode group's net for the groups whose battles reported a `trophy_change` (`ladder`, `ranked`, `event`). `trophy_net` and `trophy_net_peak` stay Trophy Road's alone, and the trophy rungs still read them; `battles_performance`'s `net_trophies` over the same window is the sum of `trophy_net_by_mode`.",
    ),
    "Additive. JSON API unchanged.",
  ),
} satisfies ChangelogEntry;
