import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.32.1",
  date: "2026-09-23",
  summary:
    "`cards_synergy`'s raw-window mode split uses the season rollup's mode-group rule, so a battle of an odd API type reads `casual` on both paths, not `other` on one (#154).",
} satisfies ChangelogEntry;
