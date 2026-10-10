import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.2.3",
  date: "2026-09-24",
  summary: md(
    "Board collections say how old they are (feedback #322-#323).",
    list(
      "`collections_get` on a board collection (`synced_from`) serves `synced_at` (the last sync), `synced_snapshot_observed_at` (the board snapshot that sync applied) and `board_observed_at` (the board's newest). When the board has moved since the sync, a note says the newer board is not applied yet and points at `rankings_players`; the note no longer claims \"today's membership\" outright (0172).",
      "A collection segment on the meta tools dates the membership it applies (the board as synced).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
