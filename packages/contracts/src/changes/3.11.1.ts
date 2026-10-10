import type { ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "3.11.1",
  date: "2026-09-17",
  summary:
    "players_profile's output schema declares the shapes of snapshot.path_of_legend, league_statistics and lifetime with every key nullable (a key the API omitted is served as null since the objects render from typed columns), which moves the tools fingerprint in serverInfo.version. war_current and the clan timeline take the current river race period from the record's war calendar rather than the clan's last observed anchor: a stale or missing anchor no longer blanks the day; started_observed_at is null until the recorder has seen this period open, nominal_period_elapsed is always false, and decks_today_reason is period_unknown or training_day. Every window predicate reads the participant's own battle_time (identical results, the covering indexes). No field added or removed.",
} satisfies ChangelogEntry;
