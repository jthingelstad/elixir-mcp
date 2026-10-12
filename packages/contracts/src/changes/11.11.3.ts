import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.11.3",
  date: "2026-10-12",
  summary: md(
    "Collector points and credits are retired, and tiers are earned in the game: running an active collector earns its operator the Family tier and nothing else, and a verified player leading or co-leading a clan the account tracks earns Leader. There is no request to make; Partner stays granted by hand.",
    list(
      "elixir_collectors: `points` and `quota_credits` are kept for shape and are always 0 (they go at a later major). Rows are ordered by enrolment, not points. The description and note say an active collector earns the Family tier.",
      "meta.quota: `calls.max` is the tier's base (or the account's override), with no collector credits on top.",
      "elixir_track_player and elixir_track_clan: a slot refusal's hint names the earned tiers (lead a clan you track, run a collector) instead of a request on the website.",
    ),
    "A correction: shapes are unchanged. JSON API 3.2.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
