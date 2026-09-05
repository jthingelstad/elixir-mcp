/**
 * The contract changelog — MCP-visible (agent feedback #4, Jamie +1 in
 * #5: agents need "what changed since contract X" to discover new
 * capabilities, because client-side tool schemas cache aggressively).
 * Append an entry with every contract bump — same-commit rule as the
 * web What's-new, but version-keyed and machine-readable.
 */

export interface ChangelogEntry {
  version: string;
  date: string;
  summary: string;
  tools_added?: string[];
  breaking?: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.20.2",
    date: "2026-09-06",
    summary:
      "battles_query gains two addressing modes for the record browser (and agents): battle_id alone fetches ONE battle with both perspectives; deck_hash alone sweeps the corpus for that exact deck and returns deck_stats (battles, W-L, distinct pilots, span - deliberately no pooled win rate; battles_meta_decks has shrunk rates with sample sizes).",
  },
  {
    version: "0.20.1",
    date: "2026-09-05",
    summary:
      "Grounding affordances (agent feedback #8 - an inference-error case study, filed at the user's request): war_current now carries an explicit period block (period_index, war_day, started_observed_at, period_end_nominal, week_end_nominal) so temporal claims cite fields instead of inferring; event-type lists are framed as schema-not-news; elixir_feedback accepts category 'other' and unknown categories get the valid list back.",
  },
  {
    version: "0.20.0",
    date: "2026-09-05",
    summary:
      "Observed meta + segment trends (META-INTEL 2-3, grounded in recorded data only). battles_meta_decks and battles_meta_cards aggregate any segment - the corpus, a clan, a player, or a collection like 'pros' - with EB-shrunk win rates, distinct-pilot counts, and usage shares; evolution forms never merge. battles_trends gives weekly series for the same segments. No tier lists, no opinions: sample sizes ride every number.",
    tools_added: ["battles_meta_decks", "battles_meta_cards", "battles_trends"],
  },
  {
    version: "0.19.1",
    date: "2026-09-05",
    summary:
      "Metadata truth pass for the added-means-recorded structure: every description now matches behavior (no stale watch/claim/entitled-scope language); server instructions teach the add + notify + events_pending flow. players_search now searches the WHOLE recorded corpus (universal reads) - your players and clanmates rank first, then everyone recorded (source: claim | clanmate | corpus).",
  },
  {
    version: "0.19.0",
    date: "2026-09-05",
    summary:
      "ADDED = RECORDED. The watch/follow distinction is gone: adding a player or clan starts collection within your tier's slots, and the only per-subject setting is notify (does it feed your event pipe). elixir_add_player and elixir_add_clan replace the watch tools (actions add/remove/notify_on/notify_off); slots now count what you've ADDED; the push lane fans out only to notify-on subjects.",
    tools_added: ["elixir_add_player", "elixir_add_clan"],
    breaking:
      "elixir_watch_player and elixir_watch_clan are REMOVED (renamed to elixir_add_player/elixir_add_clan with new action semantics); claims always record.",
  },
  {
    version: "0.18.0",
    date: "2026-09-05",
    summary:
      "One entitlements system and self-serve clan watching. The ladder gains its top rung: owner (super admin, exactly one) above admin; admins see the console with day-to-day powers. elixir_watch_clan now STARTS recording directly within your tier's clan slots (action watch/follow/unwatch) - no maintainer approval; elixir_watch_player takes record:false to claim without recording. tools/list now publishes the domain tree in order (Elixir MCP, Collections, Battles, Cards, Clans, Live, Players, War).",
    breaking:
      "elixir_watch_clan no longer files a review request - it records immediately (or refuses on slots); responses changed shape (recording: active|not_requested|stopped).",
  },
  {
    version: "0.17.0",
    date: "2026-09-05",
    summary:
      "The entitlement ladder and the push lane. Roles (member/leader/family/partner/admin) set collection and call-volume quotas - roles NEVER gate visibility, universal reads stands; see the public Roles doc. elixir_events: your per-account event feed (event types - schema, not news: battles_recorded, feedback_responded, recording lifecycle, role_changed, clan_war_week_finished) with implicit subscriptions - watching something IS subscribing; meta.events_pending hints when there is something new. Tier upgrades are self-serve on the website.",
    tools_added: ["elixir_events"],
  },
  {
    version: "0.16.1",
    date: "2026-09-05",
    summary:
      "Leaderboards via live_fetch (agent feedback #6, filed unprompted): /locations/{id}/rankings/players and /locations/{id}/pathoflegend/players join the allowlist - top-100, and every ranked tag accretes into the corpus for immediate use with the player tools.",
  },
  {
    version: "0.16.0",
    date: "2026-09-05",
    summary:
      "Feedback interface round two (agent feedback #4/#5): this changelog tool; structured ship links (shipped_in, related_tools) on feedback responses; feedback_responses_pending hint in response meta when a maintainer reply awaits you; status/since filters on elixir_my_feedback; server instructions now ask agents to file friction on their own judgment.",
    tools_added: ["elixir_changelog"],
  },
  {
    version: "0.15.0",
    date: "2026-09-05",
    summary:
      "UNIVERSAL READS: all recorded game data readable by every account (the public-API posture); account data stays private. Collections: curated player/clan groupings (first: 'pros', 11 professional players).",
    tools_added: ["collections_browse", "collections_get"],
    breaking:
      "not_entitled no longer occurs on game-data reads; clan tools accept any recorded clan.",
  },
  {
    version: "0.14.0",
    date: "2026-09-05",
    summary:
      "First agent feedback actioned: whole-clan Pilot Scores in one call; name-to-tag search; include_curve flag.",
    tools_added: ["clans_pilot_scores", "players_search"],
  },
  {
    version: "0.13.0",
    date: "2026-09-05",
    summary:
      "Feedback loop closed: maintainer responses with status visible to the requester. Feedback is never actioned invisibly.",
    tools_added: ["elixir_my_feedback"],
  },
  {
    version: "0.12.0",
    date: "2026-09-05",
    summary:
      "Event modes findable: battles_performance group_by 'mode' lists every named mode played (Chaos/KHAOS drafts, Crazy Arena...); battles_query gains a game_mode substring filter.",
  },
  {
    version: "0.11.0",
    date: "2026-09-04",
    summary:
      "Level Curve + Pilot Score (wins your card levels can't explain, with monthly trend and experience cohorts) and the war Scouting Report.",
    tools_added: ["battles_levels", "war_rivals"],
  },
  {
    version: "0.10.0",
    date: "2026-09-04",
    summary: "Clan standings: ranked member win rates with clan median.",
    tools_added: ["clans_standings"],
  },
  {
    version: "0.9.0",
    date: "2026-09-04",
    summary:
      "Domain-first tool names (players_*, battles_*, war_*, elixir_*...) and four service tools.",
    tools_added: [
      "elixir_watch_player",
      "elixir_watch_clan",
      "elixir_data_insights",
      "elixir_collectors",
    ],
    breaking:
      "ALL tools renamed to domain-prefixed names; old get_* names removed with no aliases.",
  },
  {
    version: "0.8.0",
    date: "2026-09-04",
    summary:
      "Tool taxonomy: every tool classified and annotated (grouped titles, read-only hints).",
  },
  {
    version: "0.7.0",
    date: "2026-09-04",
    summary:
      "Round-3 playtest batch: war attendance counts recorded battles, opponent decks at full verbosity, ISO week_of, draws + best_deck on summaries, stricter validation (forged cursors, empty tags, bounds).",
  },
  {
    version: "0.6.0",
    date: "2026-09-04",
    summary:
      "War-tool honesty batch: null-never-false-zero attendance, in_clan flags, seasons scoping, payload-mirror notes.",
  },
];
