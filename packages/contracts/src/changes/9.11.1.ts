import { md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.11.1",
  date: "2026-09-26",
  summary: md(
    "The meta tools' `excluded` counts battles again, as at 9.10: at 9.11.0 `considered` counted a duel as its rounds, so it no longer matched `battles_query` or `battles_trends` over the same window (acceptance 188.3, 200.1). A duel is one battle in `considered` and `excluded.duels`; its rounds are decided games in `decided_battles` and the rows, and `duel_rounds` beside `decided_battles` says how many.",
  ),
} satisfies ChangelogEntry;
