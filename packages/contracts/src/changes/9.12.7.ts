import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.12.7",
  date: "2026-09-28",
  summary: md(
    "`battles_compare` carries `meta.completeness_note`, as `battles_performance` and `battles_query` do (#108). It reads the same capture control once for each compared tag, when the window ends inside the last seven days, and the note has one sentence for each side whose newest profile interval is under 90% recorded or cannot be measured with more than 48 hours since the last profile poll; each sentence names its tag, and a complete side is not mentioned. With no incomplete side there is no note. Behaviour correction; no output-schema change.",
  ),
} satisfies ChangelogEntry;
