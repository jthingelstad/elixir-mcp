import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.1.5",
  date: "2026-09-24",
  summary: md(
    "`elixir_timeline` after the Elixir Gym's fourth run on it, the first on the 7.x newsfeed (feedback #244-#255).",
    list(
      "`player_tag` keeps one player's items: their own moments and, on a clan's timeline, their member moments. A clan agent answering \"anything new with me?\" had to read the whole clan feed (#253).",
      "`kinds`, `sections` and `player_tag` apply before the 150-item cap, as the size budget already did; the cap had counted items the filter then removed, so a filtered reader got 18 of 50 items and a busy-window note (#244).",
      "Every window bound compares at the millisecond precision the tool serves, (from, to] for every kind: the record keeps microseconds, so passing the busy-window note's `to` lost the item at the cut (#245).",
      "A same-day rejoin is its own item: roster moves collapse only when they share their instant (#246). The entry drops duplicated ledger rows as the items do (#250).",
      "`quiet_crossed` items come from each member's battle gaps inside the window, so a crossing stays when the member later played again or crossed a higher rung; the entry's presence list stays the window-end state (#247). `returned` is observed when the record learned the return (#252).",
      "A clan entry's `activity.played_here_learned_later` counts battles played in the window that the record learned afterwards, and a note says activity counts what the window learned and points at `clans_standings` for play time (#248).",
      "A past window's war fame is null, not 0, when the record holds no war day of that week closed by `to` (a Colosseum week) (#249). The regular weeks' 3,435 after day 1 is the record: the clan banked it in several weeks.",
      "`read_to` reports the pointer actually stored, which only moves forward, with a note when a past window left it where it was (#251).",
    ),
    "Additive: one new argument; bounds now match what the tool serves.",
  ),
} satisfies ChangelogEntry;
