import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.16.0",
  date: "2026-09-05",
  summary:
    "Feedback interface round two (agent feedback #4/#5): this changelog tool; structured ship links (shipped_in, related_tools) on feedback responses; feedback_responses_pending hint in response meta when a maintainer reply awaits you; status/since filters on elixir_my_feedback; server instructions now ask agents to file friction on their own judgment.",
  tools_added: ["elixir_changelog"],
} satisfies ChangelogEntry;
