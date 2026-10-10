import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.25.0",
  date: "2026-09-23",
  summary: md(
    "The elixir family, after the Elixir Gym's first run on it (feedback #118-#123), and every tool with an outputSchema.",
    list(
      "`elixir_timeline`'s item cap now cuts cleanly (#120). When a cap leaves items out, the page stops before the first of them, `next_cursor` continues exactly there, `has_more` is true, the read pointer moves only to the cut, and `timeline_more` counts the items still to read after the kind and section filters. Before, the newest items were dropped while the cursor pointed past them, so a reader on the pointer lost them for good.",
      "Every timeline item carries `observed_at`, when the record saw it, which is what selects it into a window, beside `at`, when it happened. A note says so when items dated before `from` are served (#118).",
      "A `quiet_crossed` moment's facts are as of the crossing: `days_quiet` is the rung. `days_since_poll` is null, not negative, when the only poll known came after the window's end (#119).",
      "The moment ledger's history is stated: profile-derived moments begin 2026-09-14T04:27Z, and steps from before the step rule carry `step: null`. A moment written twice (#48) is served once (#121).",
      "`result_too_large` gives the actual size, stops telling a compact call to use compact, and names `kinds` and `sections` where a tool takes them (#122). `elixir_my_identities` and `elixir_docs` page reads carry notes, and the page reads a `docs` pointer (#123).",
      "All 55 tools publish an `outputSchema`; 6.14.0 said so, and nine had none (#115). A test now holds it.",
    ),
    "Additive: observed_at, step null, has_more/next_cursor now honest on a capped window.",
  ),
} satisfies ChangelogEntry;
