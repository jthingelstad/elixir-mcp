import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.19.0",
  date: "2026-11-12",
  summary: md(
    "A followed player costs a player slot only when Elixir records them because of you (#760). One Elixir already records is free: an open member of a clan recorded at comprehensive scope, or a player another account followed first (the first follower pays, and when their follow ends the next one does). A free follow whose reason goes away keeps recording and starts counting; nobody is forced off, and over the ceiling only a new slot-costing follow is refused. The ceiling stays 50.",
    list(
      "`elixir_track_player` (add): a new `slot` block, `took` (this add spent a slot), `free`, `free_because` (`in_recorded_clan`, `followed_by_others` or null), `used` and `limit` (null is unlimited) after the add, and a note saying the same. Its `quota_exceeded` message now says how many of how many are used and that following an already recorded player stays free.",
    ),
    "Additive. The JSON API's `POST /me/players` mirrors the tool and carries the same `slot` block.",
  ),
} satisfies ChangelogEntry;
