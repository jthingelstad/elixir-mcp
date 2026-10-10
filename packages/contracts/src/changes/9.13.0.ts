import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.13.0",
  date: "2026-09-28",
  summary: md(
    "`clans_participation` says who was in the clan, and in what role, at each war finish (#46), so a clan's own rules can be replayed at a past finish without applying today's roster and roles to it.",
    list(
      "Each member row carries `in_clan_at_war_finish` and `role_at_war_finish`, aligned to `war_weeks` as `war_decks` is. Each is read from the clan's roster reads on either side of the finish and served only when the two agree; `null` is unknown, never absent: the week is unfinished, no read follows the finish yet, or the change fell between the reads. A role is also `null` outside the clan, at a finish before `role_history_since` (the first live roster read; imported history carries tenure, not roles), and where a member's recorded role changes do not chain, as when an older roster was admitted after a newer one.",
      "At full verbosity each row carries `role_changes`: every role change observed in the window, with `role_before`, `role_after`, `window_start` and `observed_at`.",
      "`former_members` lists who left inside the window and has not come back, with `role_at_departure`, the join and leave instants and the same columns; their battles and donations count only what they played and gave in this clan. `former_member_count` counts them.",
    ),
    'Additive. The eight-week full read of a large clan with many departures can pass the result cap, whose refusal names `weeks` and `verbosity: "compact"`; the JSON API operation has no cap.',
  ),
} satisfies ChangelogEntry;
