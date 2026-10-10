import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.19.1",
  date: "2026-09-23",
  summary: md(
    "Three small honesty fixes from the Gym's open questions and the usage audit.",
    list(
      "`war_rivals` rounds `mean_fame` and `median_fame` to whole fame and never said so, so recomputing them from the standings differed by half a point (0 and 4059 give 2030, not 2029.5). The note says it now.",
      "`war_history.weeks[].finished_early` is NULL on a week still in progress. It read `false`, which is the one wrong answer the flag exists to prevent: the week has not failed to reach the line, it has not had the chance, and a consumer filtering `finished_early === false` for weeks the clan did not close out was catching the live one.",
      "`battles_query`'s `limit` description no longer implies 25 full battles is a safe page. A full row grew with tower hitpoints, elixir, the comparison block and a duel's rounds, and about ten can reach the result cap. The hard guard is unchanged on purpose - a page that fits should still be served, and the `result_too_large` refusal already prices the retry from the actual bytes.",
    ),
    "Notes and descriptions, plus one null where a false was wrong.",
  ),
} satisfies ChangelogEntry;
