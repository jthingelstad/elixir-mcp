import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "0.19.0",
  date: "2026-09-05",
  summary:
    "ADDED = RECORDED. The watch/follow distinction is gone: adding a player or clan starts collection within your tier's slots, and the only per-subject setting is notify (does it feed your event pipe). elixir_add_player and elixir_add_clan replace the watch tools (actions add/remove/notify_on/notify_off); slots now count what you've ADDED; the push lane fans out only to notify-on subjects.",
  tools_added: ["elixir_add_player", "elixir_add_clan"],
  breaking:
    "elixir_watch_player and elixir_watch_clan are REMOVED (renamed to elixir_add_player/elixir_add_clan with new action semantics); claims always record.",
} satisfies ChangelogEntry;
