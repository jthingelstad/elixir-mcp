import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.12.5",
  date: "2026-09-28",
  summary: md(
    "`cards_catalog` lists the tower troops the current `/cards` catalog lists, four today, not five (#44). The fifth, `29000000` \"Archer Queen\", was never sent by the game's API: a test fixture leaked into the retired elixir-bot's raw payloads and was replayed as a catalog fetch. The catalog now follows the newest fetch, so a replayed old catalog, or a support card first seen in a battle or a profile, is not listed until `/cards` lists it, and a tower troop `/cards` stops listing leaves `tower_troops`. Every card stays on the record for the battles that name it. The Archer Queen card is `26000072`. Behaviour correction; no output-schema change.",
  ),
} satisfies ChangelogEntry;
