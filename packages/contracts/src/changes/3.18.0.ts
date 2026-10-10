import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.18.0",
  date: "2026-09-19",
  summary: md(
    "The seam (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 3.2, 6 and 7, Phase 5).",
    list(
      "`elixir_timeline` takes `reader` (a short name for this consumer's read pointer): an omitted `from` reads since that reader's pointer, `mark_read` moves it, `read_to` reports it, and other readers on the account and the account's own unnamed pointer are untouched. `meta.timeline_pending` counts admissions since the OLDEST named pointer when any reader has marked, so a consumer that names itself sees it fall to 0 after its read.",
      "An empty timeline window is cheap: one probe off the battle `created_at` index says whether the clan learned a battle in the window before the day-wide member scans run.",
      "Every error body carries `class` (`retry` | `input` | `subject` | `server` | `budget`; `ERROR_CLASS` in the contracts package): `live_pending` and `query_timeout` are `retry`, `internal` and `live_unavailable` are `server`, `quota_exceeded` is `budget`, the rest `input` or `subject`.",
      "The subject tools take `display_name` beside `on_behalf_of`, and an unmapped id's `no_subject` carries `candidates[]` (the clan members whose whole name matches; `player_tag`, `name`, `clan_tag`, `role`) with a hint that names the one `elixir_identify` call.",
      "`elixir_feedback` takes `request_ids[]` beside `request_id`.",
      "`outputSchema` declared on `elixir_my_feedback`, `rankings_players`, `war_history`, `battles_meta_decks`, `battles_meta_cards`, `battles_levels` and `clans_participation` (`tools/list` and the tool reference render them; the registry validates against them).",
      "A person's omitted `clan_tag` is the primary player's clan and nothing else: when that clan is not recorded the call is `not_recorded` naming it, where it used to slide to an alt's recorded clan.",
    ),
    "Additive; migration 0136 adds `timeline_reader`.",
  ),
} satisfies ChangelogEntry;
