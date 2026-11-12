import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.20.1",
  date: "2026-11-12",
  summary: md(
    "An edited highlight reaches a poller (Codex review of #773). Changing a highlight's words used to leave its timeline item at revision 1 and in the window it was posted in, so a reader moving its pointer never saw the new words, and a line cross-posted to Discord kept the old ones.",
    list(
      "`elixir_timeline` (`battle_highlight`): when its player's words change, the record learns the item again. A read by observation (a poller, the default) serves it in the window that holds the edit, under the same `id` and `at`, at a higher `revision`, with `observed_at` at the edit and the new `words`; its `late` is true. A read with basis `occurred` still finds it where it was posted, at its current revision. Saving the same words changes nothing.",
    ),
    "A correction: no field added or removed, schemas unchanged. A deleted highlight still simply leaves the timeline; nothing tells a reader that served it. The JSON API is unchanged.",
  ),
} satisfies ChangelogEntry;
