import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.8.1",
  date: "2026-10-11",
  summary: md(
    "Corrections to 11.8.0's elixir_timeline. An occurred read builds a sitting begun before from whole. An evidence read with no basis finds an item from either kind of window. A member_away's date is in the reader's time zone. Two notes 11.8.0 dropped are back.",
    list(
      "elixir_timeline: an occurred read whose window starts mid-sitting serves the whole sitting (its battles, totals, decks and evidence), not the part after from; the window's own battle counts are unchanged.",
      "elixir_timeline: an evidence read (evidence_item_id) that names no basis looks for the item in the other kind of window before answering evidence_unavailable, so a poller's late item can be read back with only its original from and to. applied.basis says which basis found it.",
      "elixir_timeline: member_away's until date is written in the reader's time zone, not UTC.",
      "elixir_timeline: a member read (player_tag) whose window cuts a sitting says it comes back under the same id at a higher revision when the sitting is a session_standout too, as it did for battle_session before stories merged.",
      "elixir_timeline: the late note on an observed read says the read selects items by when the record observed them and dates each at when it happened.",
    ),
    "A correction: fields and shapes are unchanged. JSON API 3.1.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
