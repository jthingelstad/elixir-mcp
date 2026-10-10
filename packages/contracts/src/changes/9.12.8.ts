import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.12.8",
  date: "2026-09-28",
  summary: md(
    "Event classification follows Jamie's ruling (#109). A clanmate battle (`clanMate`, `clanMate2v2`) is `casual` even when it carries an event tag: about 62% of clanmate friendlies do, because friends play a friendly under an event's rules. Any other tagged battle is `event`, the API's `unknown` type included (Royale Shuffle); an untagged `unknown` stays `casual`. Every battle tool's `mode` filter, `mode_group` label and per-mode split, the timeline and the daily rollups agree; the meta population still leaves out every tagged battle.",
    list(
      "`battles_performance` `group_by: game_mode` keys its rows by `(game_mode, type, event_tag)`: Supercell reuses a game-mode slot for several events, and one row had pooled them. Each row carries `event_tag` and `event_title` (the events read's title, `null` when it never sighted the event); both are `null` on a row that is not event content.",
      'The `mode: "event"` pool note names the per-event view, and is not attached to that view, which pools nothing.',
    ),
    "Behaviour correction; the `by_mode` item schema is declared.",
  ),
} satisfies ChangelogEntry;
