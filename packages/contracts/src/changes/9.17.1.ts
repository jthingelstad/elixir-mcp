import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.17.1",
  date: "2026-09-29",
  summary:
    "`elixir_examples` now declares both answer shapes correctly: its index has `examples`, while a selected example has its transcript and supporting details instead. The responses were already correct; this patch removes erroneous output-schema mismatch logs.",
} satisfies ChangelogEntry;
