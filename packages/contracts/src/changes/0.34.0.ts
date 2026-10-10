import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.34.0",
  date: "2026-09-08",
  summary:
    "The daily clan pulse now says whether a quiet member is really quiet. 'Days quiet' has always been counted from the last battle we recorded, so for somebody we had stopped polling it measured our own blind spot rather than their inactivity - and telling the two apart cost a coverage call per name. Each quiet member now carries days_since_poll and recorded_since alongside days_quiet: if we polled them minutes ago, nine days of silence is theirs; if we have not polled them in a week, most of it is ours. A member we have never polled reports null rather than zero, because a blind spot must not read as freshness. Members with no recorded history at all are now named instead of counted, since the quiet list is built from recorded battles and structurally cannot contain them. Filed by a connected agent from a pulse it was reading.",
} satisfies ChangelogEntry;
