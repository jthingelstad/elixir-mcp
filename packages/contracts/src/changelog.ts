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
    version: "0.38.0",
    date: "2026-09-09",
    summary:
      'elixir_my_players now returns relationship (primary | alt | friend | watching) and your private nickname for each player, so "my alt" and "my friends" resolve from the response instead of being guessed from handles - the account owner had recorded those distinctions and only the add tool could see them. clans_roster takes summary: true, returning a clan\'s name, member count and role breakdown without the member list or events, so asking how many members are in a clan no longer costs the whole roster. Both are additive: existing fields and defaults are unchanged. Both were reported through elixir_feedback by agents that hit them.',
  },
  {
    version: "0.37.0",
    date: "2026-09-08",
    summary:
      "Your connection now identifies itself as data, not only as prose. initialize has always said who you are connected as inside the instructions - 'YOU ACT FOR POAP KINGS' - which suits the model reading it and not the program hosting it, so a client wanting to refuse to boot on the wrong token had to pattern-match English that gets reworded whenever the wording is tuned. The same facts now ride in _meta: kind (person, agent or integration) and subject (the clan an agent acts for, the player a person is, or null). Subject is always present, so an agent misconfigured with no clan is detectable at startup instead of showing up later as an empty answer. It reports the connection you hold and grants nothing; rights are still derived server-side on every call. Reported by the author of the Elixir MCP Discord app.",
  },
  {
    version: "0.36.2",
    date: "2026-09-08",
    summary:
      "Response metadata is checked against the shared contract at construction and at the tool registry boundary. The existing timezone_applied field is now declared; timestamps, optional history, source freshness, counters and receipt IDs are checked. Public response examples are generated from the same contract. Valid response shapes and tool calculations are unchanged.",
  },
  {
    version: "0.36.1",
    date: "2026-09-08",
    summary:
      "Clarify numerical precision in statistical tool notes: calculations use unrounded aggregates; rates and scores are independently rounded to three decimals. Recomputing a shrunk rate or score from displayed rates can differ in the final decimal place. Calculations themselves are unchanged.",
  },
  {
    version: "0.36.0",
    date: "2026-09-08",
    summary:
      "Statistical alignment: deck/card meta exclude draws and unresolved outcomes from decided totals, usage and shrinkage baselines; empty segments return segment_win_rate: null. Both return methodology and window_to. Card meta rejects reversed windows and excludes empty card arrays. Even-sized cohort medians average the two middle scores. Personal and clan Pilot Scores share ingest-stamped level averages and a population of exactly two opposing decided participants with known levels. battles_levels declares its existing include_curve option. Both expose methodology explaining sample floors and the legacy standard_error approximation, which is not a calibrated score confidence interval. Aggregate basis counts do not identify the fitted curve or prove why a score changed. Public methodology and earlier release claims now reflect these limits.",
  },
  {
    version: "0.35.0",
    date: "2026-09-08",
    summary:
      "Performance summaries now aggregate the entire requested window; last_n_battles remains an explicit sample. Player response metadata distinguishes the oldest relevant poll, individual source_polls, earliest stored recorded_since, and recording_active_since. war_current exposes its current-race source observation age and warns when the observed period has passed its nominal end. Coverage compares matching profile-observation intervals with recorded battles at read time, so multi-day polling and late arrivals no longer create false daily estimates. observation_intervals and incomplete_intervals replace unsupported daily precision; incomplete_days is retained as null. Oversized MCP results return valid JSON errors with the original request_id rather than sliced success bodies. Methodology now describes the shipped pooled/shrunk statistics and the limitations of Pilot Score.",
  },
  {
    version: "0.34.0",
    date: "2026-09-08",
    summary:
      "The daily clan pulse now says whether a quiet member is really quiet. 'Days quiet' has always been counted from the last battle we recorded, so for somebody we had stopped polling it measured our own blind spot rather than their inactivity - and telling the two apart cost a coverage call per name. Each quiet member now carries days_since_poll and recorded_since alongside days_quiet: if we polled them minutes ago, nine days of silence is theirs; if we have not polled them in a week, most of it is ours. A member we have never polled reports null rather than zero, because a blind spot must not read as freshness. Members with no recorded history at all are now named instead of counted, since the quiet list is built from recorded battles and structurally cannot contain them. Filed by a connected agent from a pulse it was reading.",
  },
  {
    version: "0.33.0",
    date: "2026-09-08",
    summary:
      "Players you add can finally be told apart. Relationship - primary, alt, friend, watching - shipped as a column months ago and your connected agent has been reading it the whole time, but nothing could ever set it, so every player you added was announced as 'watching'. You can set it now from Account > Overview, and your agent's opening context says what each player actually is to you. Agents also became operable: issue a replacement key without losing the agent's identity or its place in its event feed, suspend and resume one, read what it has been notified about, see who it answers for, and see how many of your daily calls it is spending. A suspended agent's key simply reads as invalid.",
  },
  {
    version: "0.32.0",
    date: "2026-09-08",
    summary:
      "The event feed now carries milestones, and it reaches agents through the clan they run. Badges, arena changes, personal-best trophies, career-win thousands, collection levels and Path of Legends promotions all nod at you now - none of them ever did before, because the player fan-out was written but never wired up. A one-off badge and a mastery level-up are separate topics, so asking for the notable ones actually gets you the notable ones. An agent hears about the players in its clan without adding fifty of them itself; an integration, which has no players of its own, hears nothing. Everything that can arrive in bulk folds into a single unread nod with a running count - the feed tells you a thing happened and where to look, and the data tools tell you what it was. 'role_changed' is now 'account_tier_changed' (both are sent for now): it means your account tier, and it sat one word away from 'member_role_changed', which means a clan promotion.",
  },
  {
    version: "0.31.0",
    date: "2026-09-08",
    summary:
      "Every tier now tracks 50 players, up from 3-25 - one comprehensive clan watch already records about that many, and recordings are shared, so a clanmate of a clan already being captured costs nothing to add. Your connection now tells you who you are. The opening instructions name your primary player, your alts, the friends and players you watch, and your clan - so 'how am I doing' needs no lookup, and omitting player_tag has always meant you. Agents, which serve many humans through one connection, can learn who is asking: pass on_behalf_of with an id from your own surface (discord:, signal:, anything) and map it once with elixir_identify. Players you add now carry a relationship - primary, alt, friend or watching.",
    tools_added: ["elixir_identify", "elixir_my_identities"],
  },
  {
    version: "0.30.0",
    date: "2026-09-08",
    summary:
      "game_clock answers what season and war day it is with no clan and no player - the calendar is a property of the game, not of anyone playing it. Connections now describe the job they are for: an agent acts for a clan and no longer sees the personal identity tools, an integration has no subject at all. Your opening instructions differ accordingly.",
    tools_added: ["game_clock"],
  },
  {
    version: "0.29.0",
    date: "2026-09-08",
    summary:
      "Every response now carries meta.request_id, naming the audit row that produced it — quote it when reporting an answer that looks wrong. Calls made with a service token are recorded against that token, not just the account behind it.",
  },
  {
    version: "0.28.0",
    date: "2026-09-07",
    summary:
      "OAuth grants now mean what the consent page says. cr:read calls every read-only tool but cannot edit collections, change recordings, update nicknames/event cursors, or file feedback; those actions require collections:write, recordings:write, account:write, or feedback:write respectively. The requested capabilities are listed before the user enters their code, persist unchanged through refresh rotation, and are enforced before rate or daily quota is spent. Tokens are also audience-bound to https://elixir.poapkings.com/mcp through the RFC 8707 resource parameter. Existing OAuth connections become cr:read-only because that is the authority their original consent granted; reconnect with the additional scopes to restore writes. Owner-issued service tokens remain explicit full-capability administrative credentials.",
    breaking:
      "OAuth clients must send resource=https://elixir.poapkings.com/mcp on authorization-code and token requests. Existing OAuth families retain reads but need fresh consent for write capabilities.",
  },
  {
    version: "0.27.0",
    date: "2026-09-07",
    summary:
      "War days now follow the 10:00 UTC POLICY reset for every clan. Clash Royale matches clans into races of five as matchmaking fills, so each clan's real period start drifts off that hour by its own amount; Elixir MCP is multi-clan and cannot honour every clan's start while still having war_day mean one comparable window. Boundaries are therefore identical across clans, and a replay assigns the same war day the live run did. war_current's period block gains period_start_nominal and observed_offset_minutes: started_observed_at is still reported, so a single-clan consumer can correct for its own clan's drift. Consequence stated rather than hidden: battles played between a clan's real start and the policy hour are attributed to the previous policy day. decks_today gains over_cap, which names anyone observed with more than four decks in a policy day - the direct measurement of that cost, which the display cap used to swallow.",
  },
  {
    version: "0.26.0",
    date: "2026-09-07",
    summary:
      "war_current: period_end_nominal and week_end_nominal were wrong whenever the ~10:00 UTC reset drifted early. A period first seen open at 09:57Z reported its end as 10:00Z that same morning - about 24 hours early, and already in the past by the time anybody read it. Both now anchor on the period's own nominal start, so the end is a full day later. decks_today was gated on that boundary and therefore vanished on a live war day; it is back. clans_pilot_scores gains a basis block (curve_pairs, curve_bins, window_from, window_to): the level curve is refit over a rolling window on every request, so a member's score can move with no new battles of their own, these counts provide volume context, but cannot establish that the fitted curve is unchanged (clarified in 0.36.0). Reported by an agent through elixir_feedback.",
  },
  {
    version: "0.25.0",
    date: "2026-09-06",
    summary:
      "players_profile now answers the player as a game entity, not just a name and a clan tag. clan gains badge_id and the player's role in it; a new attributes block carries arena_id, best_trophies, favorite_card_id, years_played and account_age_days; and a badges list carries current badge state, where YearsPlayed.progress is days played. All of it already arrived in every recorded player payload and was discarded, so a consumer wanting the clan badge, the clan role or an account age had to spend a live Clash Royale read on facts the record already held. Ids only, never icon URLs: names and art resolve through cards_catalog.",
  },
  {
    version: "0.24.0",
    date: "2026-09-06",
    summary:
      "collections_edit: curate a collection you own from an agent or a service token. add and remove adjust membership, set replaces it wholesale - the shape an external system syncing a roster wants. Everything in a collection is recorded for as long as it stays there, so adding a tag starts collecting it. Up to 500 tags per call, idempotent, and a malformed tag refuses the whole call rather than silently dropping somebody from a synced roster.",
    tools_added: ["collections_edit"],
  },
  {
    version: "0.23.0",
    date: "2026-09-06",
    summary:
      "Collections now cause recording. A player or clan named in a collection is collected for as long as it stays there - curating a list used to record nothing, so you had to add each subject to an account as well. Each collection carries how deeply to record what it names: 'comprehensive' captures battles (every member's for a clan, the player's own for a player), 'activity' captures only the surface (a clan's roster/war/standings, a player's profile). collections_browse and collections_get report that as scope. Depth is only ever deepened on a shared subject, never taken away, and removing something from a collection stops recording it unless a claim or another collection still wants it.",
  },
  {
    version: "0.22.3",
    date: "2026-09-06",
    summary:
      "elixir_events with a topics filter no longer acknowledges the events it hid. The seen-cursor is one number per account, so a topic-specific poll used to mark everything below the last returned event as seen - a war-only routine could silently clear an unread feedback reply, and normal resumed polling never showed it again. Acknowledgement now stops at the first event the filter excluded, and the response carries seen_through so you can tell when that happened. Separately, adding and removing the same player from two accounts at once can no longer leave a subscribed player unrecorded, or a recording running with no subscribers.",
  },
  {
    version: "0.22.2",
    date: "2026-09-06",
    summary:
      "Correctness fixes in adding and removing players, both of which agents hit directly. elixir_add_player with make_primary now SWITCHES the primary instead of failing on a uniqueness violation, and works on a player you have already added. elixir_remove_player, when you remove your primary while other players remain, promotes the oldest remaining one and returns it as primary_player_tag - previously the account was left with no primary at all and every default-player tool answered not_found. A shared recording now stops when its LAST subscriber removes it, in any order; it used to require the account that first added it, so the wrong order left the recording running forever. Player-slot limits are now enforced atomically, so concurrent adds cannot overshoot the cap.",
  },
  {
    version: "0.22.1",
    date: "2026-09-06",
    summary:
      "Hardening from five agent-persona test passes. Unknown enum values (mode, outcome, sort, metric, granularity) and impossible card ids now REFUSE with valid-value hints instead of returning silent empty results; players_timeline garbage dates get a structured error instead of 'failed unexpectedly'; last_n_battles: 0 refuses instead of quietly serving all-time stats; battles_query echoes limit_applied so the 50-row clamp is visible. war_history gains finished_early (a regular week that hit the 10,000-fame finish line stops earning member points - per-deck math there is invalid) and history_starts_at (the recording horizon); war_current documents that war_day is 1-based and day_in_week 0-based. member_left feed events now carry the departed member's last-known name.",
  },
  {
    version: "0.22.0",
    date: "2026-09-06",
    summary:
      "Clan Pulse: a daily clan_pulse feed event per added clan (24h battle activity, top players, members quiet >=5 recorded days, war-day deck counts, roster changes - facts, never judgments) plus a real-time war_day_open event when a new war day is first observed. war_current gains decks_today: named untouched/partial/finished lists for the current war day - the nudge list. Built for scheduled agent clan-management routines: read elixir_events from your cursor, drill with war_current and clans_roster.",
  },
  {
    version: "0.21.1",
    date: "2026-09-06",
    summary:
      "Clan notifications actually notify: member_joined, member_left, and member_role_changed now flow to the event feed for clans you've added (the only clan topic before was the WEEKLY war boundary - working as designed, but the design covered almost nothing). Also: every fresh battlelog poll is now capture-audited (was the payload's oldest battle already known?) and the 24h gap count is public on Data > Status.",
  },
  {
    version: "0.21.0",
    date: "2026-09-06",
    summary:
      "Private player nicknames: elixir_nickname stores YOUR name for a player (account-scoped, never visible to anyone else). players_search matches nicknames and ranks them first - 'tyler' resolves to the player you call Tyler; players_summary and clans_roster carry the nickname alongside the real name.",
    tools_added: ["elixir_nickname"],
  },
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
