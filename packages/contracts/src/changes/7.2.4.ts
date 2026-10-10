import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.2.4",
  date: "2026-09-24",
  summary: md(
    "The timeline after the pre-beta Gym pass (feedback #317-#321).",
    list(
      "A busy window's cap cuts in observed order, the order windows page by: an item learned 17 hours late had become the boundary, and the documented continuation served nothing with has_more true, forever. When more items than a page holds share one observed instant, the page serves what fits and says the rest cannot be split by window (#317).",
      "A quiet crossing at exactly a window's `to` is in that window, as `to` is inclusive: it had been in neither neighbour (#318).",
      'An open war day 1 serves fame and place null, as training days do, until the week\'s first war day closes: it read "0 fame, place 1 of 5" among five unranked clans (#319).',
      "The protocol docs no longer say the standard capabilities are what a client gets without asking (#320); the recurring-sitting note says keep the newest per kind and started_at (#321).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
