import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.2.1",
  date: "2026-11-15",
  summary: md(
    "`battles_opponents` points at its own docs section, `battles#opponents`, which describes its per-opponent rows (`battles`, `wins`, `losses`, `draws`, `first_seen`, `last_seen`, `modes`, `clan_tag_last_seen`, `mean_level_gap`, `name_known`) and its `min_battles`, `sort` and `limit`. It pointed at `battles#what-a-battle-record-holds`, the section for `battles_query`'s battle rows.",
    "Docs only; no value changes.",
  ),
} satisfies ChangelogEntry;
