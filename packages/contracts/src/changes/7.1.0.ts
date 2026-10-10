import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.0",
  date: "2026-09-23",
  summary: md(
    'An agent can track (Jamie, 2026-09-23: a clan agent "may be asked to track a competitive clan", and a family agent had no way to be configured at all).',
    list(
      '`elixir_track_player` and `elixir_track_clan` are available to agents. An agent tracks with an agent\'s meaning: its players are `watching`, never `primary`, `alt` or `friend` (those say "me"), and a relationship other than watching is refused as `not_entitled`.',
      "Recording slots are the person's, pooled across them and every agent they own: a subject counts once however many of them track it, and a clan counts once at the widest scope any of them gives it. An agent's `quota_exceeded` names the owner's tier and says the slots are shared.",
      "An agent keeps the clan it acts for: removing it while it is the agent's primary, or removing its last clan, is refused as `not_entitled`. The owner re-points an agent at another of its clans from the agent's console.",
      "Integrations still track nothing; both tools stay withheld from them.",
    ),
    "Additive: two tools reach a principal kind they did not.",
  ),
} satisfies ChangelogEntry;
