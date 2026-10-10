import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.9.0",
  date: "2026-09-16",
  summary:
    "The timeline as a trigger for a clan bot (docs/reviews/2026-09-16-TIMELINE-FOR-PROACTIVE.md). elixir_timeline: a member's session that crosses a disclosed rung (5/10/20 wins in a row, 150/300/500 ladder trophies net, 20/40 battles in one sitting) is a session_standout item on the clan's timeline, at the crossing battle's instant, once per rung and never re-reported; the clan entry's standouts gain sessions (capped at five) and session_rungs. bracket_observed (section war) names a new war week's four rivals with recorded: true|false on the record's first sight of them; the week's start time stays the clock's. kinds filters items by kind. On badge_earned, legendary_badge_earned and card_unlocked items the badge's or card's name is facts.badge / facts.card and facts.name is the member (it was the badge's, so a clan timeline read 'Lava Hound unlocked Lava Hound'); badge_earned items appear only at a badge's final level or a multiple of five, the entry still counts every level-up; badge_earned payloads carry max_level. collection_level_step widens with the level (every 5 below 100, 50 to 1,000, 100 above) and carries step. clans_standings: trophy_net and current_streak per member. Additive, except facts.name on the three item kinds, which now means the member.",
} satisfies ChangelogEntry;
