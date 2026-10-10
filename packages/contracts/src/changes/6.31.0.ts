import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.31.0",
  date: "2026-09-23",
  summary: md(
    "The battle tools, after the Elixir Gym's second run on them (feedback #148-#151).",
    list(
      '`battles_meta_decks` and `battles_meta_cards` apply the meta population (no event content, only decks the player chose) on every window. Before, a custom window or a segment read raw had kept both, which disagreed with the season rollup. `mode: "event"` there answers empty with a note, not a silent zero (#148).',
      "`mode` is event-aware everywhere: `battles_trends`, `cards_synergy`, the card profile and `battles_opponents` filter event battles by their event tag, and `battles_cards` labels them `event`, not `casual` (#148).",
      "`battles_query` `deck_stats` counts the battles this call matches (its window, mode and filters), the same set as `total_count`. It had counted the deck's lifetime whatever the window said. It is now declared in the output schema (#149).",
      "A note says when rows carry no tower level (river race rows record no support cards), so their towers may have started unequal and `vs.tower_hp` is not a margin of victory (#150).",
      "A too-large refusal on a one-size tool no longer advises `compact` or quotes the verbosity, and an unknown-argument refusal lists `verbosity` among the known arguments (#151).",
    ),
    "Corrected values: deck_stats, and the meta tools on raw windows now exclude what the season rollup excluded.",
  ),
} satisfies ChangelogEntry;
