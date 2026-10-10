import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.6",
  date: "2026-09-23",
  summary: md(
    "The card tools, after the Elixir Gym's third run on them (feedback #191-#192).",
    list(
      "Tournament battles sit in no trophy band, as ranked ones have since 6.22.0. A tournament row's starting trophies are the player's running score in that tournament (1, 2, 3 on consecutive battles), not Trophy Road trophies, and they had filled 89.6% of `under_5000`: Witch \"at low trophies\" read 0.43, which was tournament Witch, where the ladder band holds 39 battles at 0.615. `trophy_band` on `cards_card`, `cards_synergy`, `battles_meta_cards` and `battles_meta_decks` changes for that band, the band tables are rebuilt, and the band note says so (#191).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
