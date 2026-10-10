import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "6.1.0",
  date: "2026-09-19",
  summary: md(
    "Two readings that were wrong about the fleet and the catalog (2026-09-19).",
    list(
      "`elixir_collectors`: `status` is what the collector is doing now. A collector enrolled to run (`active` or `probation`) that has not checked in for an hour reads `silent`, with `silent_since`; `lifecycle` carries the enrolment state the door acts on, `last_seen` the last check-in. `draining` is a stop on purpose and never silent. A note counts the silent collectors. (Hog Rider had been quiet forty hours under `active`.) The maintainer is now told once per silence by the hourly sweep, as quarantine already told him.",
      "`cards_catalog.fetched_at` is the GLOBAL cards poll's admission stamp. It read the last row CHANGE, which the projector moves only when a card's fields move, so an unchanged catalog confirmed every night read as unconfirmed for nine days.",
    ),
    "Additive.",
  ),
} satisfies ChangelogEntry;
