import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "9.15.0",
  date: "2026-09-28",
  summary: md(
    "Every `elixir_timeline` item carries `id`, the story it tells, and `revision`, how far that story has grown (#111), so an agent tells a story once, recognises it in the next read, and updates it when it grows rather than retelling it.",
    list(
      "`id` is opaque and the same across reads and windows. A ledger moment's comes from its ledger row (a duplicated row that the read serves once keeps the lowest row's); a sitting's from its player and its first battle, found by walking back past the window's start, so `battle_session` and `session_standout` of one sitting share it; the rest from what names the happening. It names the happening, not the reader: a member's moment has one id on the clan's timeline and on the player's own.",
      "`revision` is 1 for a moment that never grows. A sitting's is its battles counted from its first battle (a standout's, up to the last rung the window learned), so a sitting told at 20 battles and read again at 40 is the same id at a higher revision.",
      "The member-read note says to update on a higher revision where it said to keep the newest item per kind and `started_at`. `/api/me/timeline` carries the fields too.",
    ),
    "Additive. The JSON API has no timeline operation and is unchanged.",
  ),
} satisfies ChangelogEntry;
