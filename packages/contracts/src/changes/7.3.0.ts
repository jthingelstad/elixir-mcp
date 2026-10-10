import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "7.3.0",
  date: "2026-09-24",
  summary: md(
    "Jamie's pre-beta follow-ups (feedback #342 and the journey r3 open questions).",
    list(
      "An incomplete Path of Legends board is re-read, not kept: a full board whose cutoff fell 40 or more below the previous snapshot's is flagged at ingest and read once more about 30 minutes later, and the re-read replaces it for every reader (the flagged snapshot is kept, marked superseded). The daily read stays at 10:00Z (#342).",
      "Every response carries `notes` and `docs`: `elixir_examples {example}` serves notes and `elixir_docs {query}` a docs pointer to the best match's page, and a tool with nothing to say serves `notes: []`. Every output schema now requires both.",
      "`cards_card` `season.forms[].players` counts each form's distinct players (it was null on a custom window).",
      "The timeline's clan activity note says why `clans_standings` counts more over the same window: per member (a friendly between two members counts on both rows), by play time, and today's members including a joiner's battles for another clan.",
      "A season finalised in the last three days is rolled again each night, so battles from its last hours that arrive late reach the season meta.",
    ),
    "Additive; `notes` and `docs` are now always present.",
  ),
} satisfies ChangelogEntry;
