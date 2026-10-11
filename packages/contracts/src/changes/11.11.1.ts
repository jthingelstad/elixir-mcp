import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.11.1",
  date: "2026-10-11",
  summary: md(
    "Corrections to 11.11.0's sitting details.",
    list(
      'elixir_timeline session_standout: a sitting only partly played with its 2v2 partner says how much ("20 battles in one sitting, 1 of them with <name> in 2v2"). At 11.11.0 it read as though the whole sitting was with them.',
      "elixir_timeline: a long window's sitting details are read faster. At 11.11.0 a month of a clan's standouts spent about 3 seconds looking up every participant's name; now only the names the details give are read.",
    ),
    "A correction: fields and shapes are unchanged. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
