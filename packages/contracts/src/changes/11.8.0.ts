import { list, md, type ChangelogEntry } from "../changelog-entry.js";

export default {
  version: "11.8.0",
  date: "2026-10-11",
  summary: md(
    "elixir_timeline is publication-grade: an item's text is a time-free sentence safe to post as it stands, its time comes as fields, one story is one item, and every item says whether it may be published. Feedback #373-#376.",
    list(
      "elixir_timeline: new basis argument, occurred or observed. occurred selects items by when they happened (sort_at) and never moves a read pointer; observed selects by when the record learned them, as before. A read that names a reader, starts at the pointer (source pointer) or passes mark_read true is observed; any other read is occurred. Migration: a caller that relied on an explicit from/to read moving the pointer names a reader or passes mark_read true; basis observed restores the old selection on any read. basis occurred with mark_read true is refused.",
      "elixir_timeline: text no longer starts with a time. Each item carries sort_at (the newsfeed order), at_unix (seconds, for a renderer's own stamp such as Discord's <t:unix:f>), local (date, time, weekday, tz in the account's or the read's time zone) and late (an observed read's item that happened before from).",
      "elixir_timeline: one item per story. A story seen as several subjects' copies is merged into one item whose subjects lists every tag it is about ({tag, kind, name}); a member's standout is the clan's standout. The in-game name is in text and facts.name, your nickname for a player in nickname.",
      "elixir_timeline: every item carries visibility (public, clan, player, leaders or owner) and publishable. Account items are owner and never publishable; Elixir's own Discord and clan syndication post publishable items only.",
      "elixir_timeline: every item carries schema, <kind>/<version>; the docs' facts table lists each kind's keys and what its at means.",
      "elixir_timeline: battle_session and session_standout facts gain started_at, ended_at, duration_s, trophy_net_peak, decks and events; a standout's crossings gives each rung's value and battle, and its evidence is the whole sitting it counts. A player entry's new ranked gives league, rating and rank as the profile read them at each end when any moved, and its trophies is null when neither trophies nor best moved.",
      "elixir_timeline: week_resolved facts gain members, each member's decks used and race points for the week. A clan entry's war decks tally is null once the race finished.",
      "elixir_timeline: account items collapse a burst into one item that names the apps.",
    ),
    "Additive fields; the default selection of an ad hoc read and the text's time lead changed as above. JSON API 3.1.0 is unchanged (elixir_timeline is not an /api/v1 operation).",
  ),
} satisfies ChangelogEntry;
