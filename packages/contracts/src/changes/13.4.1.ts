import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "13.4.1",
  date: "2026-11-17",
  summary: md(
    'Timeline sentences say "session" where they said "sitting", the word the app, the mail and the docs use for a run of battles.',
    list(
      '`elixir_timeline`: `text` reads "played 12 battles in one session" for a `battle_session` and a `session_standout`, a player entry\'s summary "40 battles in 5 sessions", a clan entry\'s "in 9 sessions" and "standout sessions:". Read `facts`, never parse `text`. No field, kind, key or shape changed: `battle_session`, `session_standout`, `completeness: recorded_sitting` and every stored id stay as they were.',
    ),
    "A correction to wording only. The JSON API is unchanged at 5.1.0.",
  ),
} satisfies ChangelogEntry;
