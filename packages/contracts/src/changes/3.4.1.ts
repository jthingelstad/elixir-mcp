import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.4.1",
  date: "2026-09-15",
  summary:
    "battles_query renders each participant's deck from the recorded card rows: the same {cards:[{id, name, level, evolutionLevel?, starLevel?}], supportCards?} shape, or {rounds:[{cards}]} for a duel, with names from the catalog; the storage-only norm marker is gone. The stored deck JSON left the record with it. No other tool changes shape.",
} satisfies ChangelogEntry;
