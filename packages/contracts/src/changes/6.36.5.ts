import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.36.5",
  date: "2026-09-23",
  summary: md(
    "The battles tools, after the Elixir Gym's third run on them (feedback #186-#190).",
    list(
      "`battles_trends` starts at `from` as given. It had moved `from` back to the Monday 00:00 UTC that starts its week while echoing the argument, so a `days: 7` read counted 29 battles and a net of +29 where the window held 24 and -27, and a season read pooled ten hours of the season before. The first week is marked partial and says what it covers (#186).",
      "`battles_trends` labels each week's modes with the same fold as `battles_query`'s `mode_group`, so event battles read `event`, not `casual`. The battles docs list `trail` under `event`, not `casual`, name `event` among the `mode_group` values and point at `battles_query({ game_mode })` (#187).",
      'A raw `battles_meta_decks` or `battles_meta_cards` read over a segment says how many battles were outside the meta population (`excluded.outside_meta`) and why: event battles and decks the player did not choose. A player whose week was nearly all event play had read "considered 10, no decks" with nothing saying why (#188).',
      "`players_timeline` answers a named `progress_key`; every named key had failed with `internal` (#189).",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
