import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.8.1",
  date: "2026-10-11",
  summary: md(
    "Two elixir_timeline notes 11.8.0 dropped are back: a member read whose window cuts a standout sitting says the sitting recurs under the same id, and an observed read with late items says it selects by when the record observed them.",
    list(
      "elixir_timeline: a member read (player_tag) whose window cuts a sitting says it comes back under the same id at a higher revision when the sitting is a session_standout too, as it did for battle_session before stories merged.",
      "elixir_timeline: the late note on an observed read says the read selects items by when the record observed them and dates each at when it happened.",
    ),
    "A correction: fields and shapes are unchanged. JSON API 3.1.0 is unchanged.",
  ),
} satisfies ChangelogEntry;
