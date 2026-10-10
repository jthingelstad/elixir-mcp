import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.2.1",
  date: "2026-09-25",
  summary: md(
    "`clans_timeline` with `verbosity: compact` answers the metrics you named, as the full read does; it answered the five clan metrics whatever was named, so a compact read of two metrics came back larger than the full one (the acceptance catalogue's two-metric seed, on the 2.3.0 deploy). Unnamed, compact still keeps the five clan metrics.",
  ),
} satisfies ChangelogEntry;
