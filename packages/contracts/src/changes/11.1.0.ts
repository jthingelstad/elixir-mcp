import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.1.0",
  date: "2026-10-04",
  summary:
    "Timeline sessions and crossings carry an evidence version and observation time. elixir_timeline accepts evidence_item_id with bounded evidence_offset/evidence_limit and expected_evidence_version to read exact ordered canonical game references for a visible item. Evidence reads always preserve the read pointer. Sessions disclose unknown capture completeness and bounded anchors; a crossing names a game only when proved. Late arena proof keeps the original moment identity and is observed when attached. Additive; JSON API remains 3.0.0 (no mirrored Timeline operation).",
} satisfies ChangelogEntry;
