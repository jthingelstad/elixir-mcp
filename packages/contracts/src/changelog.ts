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

/** A summary in Markdown: a lede paragraph, then one bullet per tool, then
 *  the closing line (Additive / migration). The site renders it; over the
 *  wire it reads as plain text either way. Paragraphs are joined by a
 *  blank line, bullets by one newline, so a bullet never runs into the
 *  paragraph before it. */
const md = (...paragraphs: string[]) => paragraphs.join("\n\n");
const list = (...items: string[]) => items.map((i) => `- ${i}`).join("\n");

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "7.0.0",
    date: "2026-09-23",
    summary: md(
      'The timeline is a newsfeed (Jamie, 2026-09-23: "we had the whole concept of Timeline backwards; think of it like the newsfeed in a social app"). What happened most recently comes first, everywhere the timeline is read: `elixir_timeline`, the console, and the mail built from it.',
      list(
        "`elixir_timeline` serves `timeline` newest first by `at`.",
        "A window past the 150-item cap, or past the response's size budget, keeps its NEWEST items: those the record observed after the newest item left out. The older ones are counted in `timeline_more`, not served, and `has_more` is true; a note names the instant, so a reader that wants them passes the same `from` with `to` there and `mark_read: false`. The entries still summarize the whole window.",
        "`next_cursor` is always the window's end, and `mark_read` always moves the pointer there: a reader catching up after days away lands on the present.",
        "A clan's member moments keep their newest 100 when a window holds more, and the clan entry's `roster.joined`, `roster.left` and `roster.role_changes` lists are newest first, keeping their latest twenty.",
      ),
      "No deprecation window: every client of this server is first-party (the 3.0.0, 4.0.0 and 5.0.0 precedent). A consumer that needs time order sorts by `at` itself, as the Discord preview already does.",
    ),
    breaking: list(
      "`elixir_timeline` `timeline` order is newest first; it was oldest first.",
      "`next_cursor` no longer pages forward from a cut: it is always `window.to`. Past the cap the older items are counted in `timeline_more` rather than reached by a cursor, and `mark_read` moves the pointer to the window's end, not to the cut.",
      "Clan entry roster lists (`joined`, `left`, `role_changes`) are newest first.",
    ),
  },
  {
    version: "6.36.12",
    date: "2026-09-23",
    summary: md(
      "The ranking tools, after the Elixir Gym's third run on them (feedback #208-#210).",
      list(
        "`standings_changed_at` moves only when the standings moved: a player on both reads changed rating, or a newcomer entered at or above the previous board's floor. A player leaving shifts every rank below them and pulls the next player in at the bottom, and that had stamped closed mode boards as moving today. Ingest applies the rule and migration 0162 recomputes the mode boards' stamps, so the stale note and the catalog's running-or-closed signal read true (#208).",
        '`rankings_timeline` echoes `applied.window.source` "argument" when `from`/`to` narrow a `season`, and its description says a point is written whenever the board\'s content changed (#209).',
        "Every windowed tool answers a season that has not begun with an empty window at its start and a note saying when it starts, where it had served a window ending before it began (#209).",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.36.11",
    date: "2026-09-23",
    summary: md(
      "The collection tools after the Elixir Gym's third run on them (feedback #201-#203), and the card tools after its fourth (feedback #204-#207).",
      list(
        "`years_played` null is described as what it almost always is: a read profile with no YearsPlayed badge, which the game first awards after about a year of play, so an account under a year old. It had said the profile was not read yet, which was false for every null checked (#201). `players_profile` declares the same.",
        "A clan collection passed as a segment `collection` is refused as an argument error that says it is a clan collection and gives the route (one `segment { clan_tag }` per clan), not the not_found an unknown slug gets (#202).",
        "`cards_card` on mode tournament says why `by_band` is empty (a tournament row has no trophy band) instead of claiming the rollup is not filled; `battles_meta_cards` and `battles_meta_decks` carry the band note whenever `trophy_band` meets a mode other than ladder (#204).",
        "`card.first_seen_in_catalog` says, when it holds the day Elixir began storing the catalog (2026-09-10), that it is not the card's release: every card present then carries it (#205).",
        "`cards_synergy` over one player carries the player's `freshness_seconds` and `recorded_since`, as `cards_card` does (#206).",
      ),
      "Additive; one refusal changes class from subject to input.",
    ),
  },
  {
    version: "6.36.10",
    date: "2026-09-23",
    summary: md(
      "The battles tools, after the Elixir Gym's fourth run on them (feedback #199-#200).",
      list(
        "`trophy_mode_battles` on `battles_performance` and `battles_trends` also counts any battle that reported a trophy change. Past 14,000 the seasonal Trophy Road is event content (type trail, game mode Ladder) that still moves trophies, so a capped player's `trophy_battles` had exceeded the count it is a subset of (19 against 1 for one week). The trophy note no longer says event modes carry no trophies (#199).",
        "The `mode` argument's description lists `event` beside the other groups and says where the seasonal Trophy Road past 14,000 sits.",
      ),
      "Additive; trophy_mode_battles rises for players past 14,000.",
    ),
  },
  {
    version: "6.36.9",
    date: "2026-09-23",
    summary: md(
      "The clan tools, after the Elixir Gym's third run on them (feedback #195-#198).",
      list(
        "The clan's own `pre_reset` row keeps the week's donation high-water, as the members' rows have since 6.33.0. A read that landed after the weekly reset had left `donations_per_week` at 10 for the weeks of game days 2026-09-06 and 09-13, where the clan's counter had reached 9,270 and 9,094; ingest keeps the higher value and migration 0161 repairs the stored rows (#195).",
        "`clans_standings` and `clans_participation` name the members whose battles were mostly not captured over the last seven days (below 80% of what the profile's battle counter says they played), so a member at 0 recorded battles with 38 real ones reads as a capture gap, not inactivity (#196).",
        "`clans_timeline`'s profile aggregates leave out a member who left by the clan's read that day. After the 6.36.7 carry-forward their carried profile had counted, putting `members_with_profile` at 49 over 46 members; a note names the days (#197).",
      ),
      "Additive; stored clan pre_reset donations change for weeks read after the reset.",
    ),
  },
  {
    version: "6.36.8",
    date: "2026-09-23",
    summary: md(
      "`badges_rarity` with `limit`, after the Elixir Gym's fourth run on the badge tools (feedback #193-#194).",
      list(
        'The versioned-pair note reads every badge in the population, not just the page, so a legacy identifier listed alone (Royal Tournament Rank, 1 holder on the rarest-10 page) still says how many distinct players hold the badge by either identifier (603). A page cut by `limit` says how many of the population\'s badges it lists, and the "a badge nobody here holds does not appear" note is served only on a complete list (#193).',
      ),
      "Additive.",
    ),
  },
  {
    version: "6.36.7",
    date: "2026-09-23",
    summary: md(
      "Two decisions on held Gym findings (Jamie, 2026-09-23).",
      list(
        "A clan segment on the badge tools counts the clan's current members who are recorded now, the corpus rule of 6.30.1. A player known only from a battle stub is a ghost entry and is never in a metric. The coverage note still says how many members counted (#183).",
        "`clans_timeline` and `clans_members_timeline` count a member whose profile was not read that day with their latest earlier read, so the profile-derived aggregates stop moving with the poll schedule. `members_with_profile` counts members with a profile as of the day, and the new `members_profile_carried` says how many of them were carried (#111).",
      ),
      "Additive; the profile-derived values change on days a member was not polled.",
    ),
  },
  {
    version: "6.36.6",
    date: "2026-09-23",
    summary: md(
      "The card tools, after the Elixir Gym's third run on them (feedback #191-#192).",
      list(
        "Tournament battles sit in no trophy band, as ranked ones have since 6.22.0. A tournament row's starting trophies are the player's running score in that tournament (1, 2, 3 on consecutive battles), not Trophy Road trophies, and they had filled 89.6% of `under_5000`: Witch \"at low trophies\" read 0.43, which was tournament Witch, where the ladder band holds 39 battles at 0.615. `trophy_band` on `cards_card`, `cards_synergy`, `battles_meta_cards` and `battles_meta_decks` changes for that band, the band tables are rebuilt, and the band note says so (#191).",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.36.5",
    date: "2026-09-23",
    summary: md(
      "The battles tools, after the Elixir Gym's third run on them (feedback #186-#190).",
      list(
        "`battles_trends` starts at `from` as given. It had moved `from` back to the Monday 00:00 UTC that starts its week while echoing the argument, so a `days: 7` read counted 29 battles and a net of +29 where the window held 24 and -27, and a season read pooled ten hours of the season before. The first week is marked partial and says what it covers (#186).",
        "`battles_trends` labels each week's modes with the same fold as `battles_query`'s `mode_group`, so event battles read `event`, not `casual`. The battles docs list `trail` under `event`, not `casual`, name `event` among the `mode_group` values and point at `battles_query({ game_mode })` (#187).",
        'A raw `battles_meta_decks` or `battles_meta_cards` read over a segment says how many battles were outside the meta population (`excluded.outside_meta`) and why: event battles and decks the player did not choose. A player whose week was nearly all event play had read "considered 10, no decks" with nothing saying why (#188).',
        "`players_timeline` answers a named `progress_key`; every named key had failed with `internal` (#189).",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.36.4",
    date: "2026-09-23",
    summary:
      "A clan segment on the badge tools counts the clan's current members with a profile read, as before 6.36.3. The recorded-now filter 6.36.3 added also dropped a current, covered member, and it is held for a decision. The coverage note stays: it says how many of the members are counted and that the rest are unknown.",
  },
  {
    version: "6.36.3",
    date: "2026-09-23",
    summary: md(
      "The badge tools, after the Elixir Gym's third run on them (feedback #183-#184).",
      list(
        "A clan segment counts the clan's current members who are recorded now, the corpus rule of 6.30.1, so a stale read under an old clan tag is left out. A note says how many of the clan's members that is, and that the rest are unknown, not non-holders: a clan recorded at roster level had read as \"every member holds it\" over 17 of 50 (#183).",
        "`min_level` on a one-off badge is refused with the reason; it had answered 0 holders. A badge's `kind` comes from the whole record, so an empty answer says tiered or one-off, not null (#184).",
      ),
      "Corrected values: the clan segment's population; a refusal where a wrong zero was.",
    ),
  },
  {
    version: "6.36.2",
    date: "2026-09-23",
    summary:
      "The 6.36.1 notes name other tools' fields in the tool.field form (`war_history.closed_at`, `war_history.progress_earned`, `war_rivals.mean_fame`), so a response never names a field it does not carry.",
  },
  {
    version: "6.36.1",
    date: "2026-09-23",
    summary: md(
      "The war tools, after the Elixir Gym's second run on them (feedback #179-#181).",
      list(
        "game_clock no longer says war_current carries a race's close: war_history's `closed_at` is each past week's real close, and nothing serves today's before it happens. war_current says a race closes before the 10:00Z grid, and that `observed_offset_minutes` is when the recorder saw a period open, never the close. war_history describes `finished` as the API's close where the API gave it (#179).",
        "war_history and war_rivals say a war day's fame (`progress_earned`) is paid for the clan's placement that day on points (observed 3,000 / 1,800 / 1,000 for the first three), not for the points, so fame and `mean_fame` measure placements, not effort (#180).",
        "The battles docs' war section says `clan_war_trophies` is the figure going into the race (#181).",
      ),
      "Notes and docs; no value changes.",
    ),
  },
  {
    version: "6.36.0",
    date: "2026-09-23",
    summary: md(
      "The ranking tools, after the Elixir Gym's second run on them (feedback #174-#177).",
      list(
        "`rankings_clans` on a mode board says its rating is the event's own, drops the Path of Legends note and says when a board has gone still. `rankings_timeline` on a mode board says a point is written when only names or clans change, so a closed event keeps writing points (#174).",
        "When a board's ranks and ratings have not moved since its first snapshot, the note says recording began then: when they last moved before that is unknown, and it no longer says names and clans refreshed on a board with one snapshot (#175).",
        '`board: "trophy"` refuses with the reason: the API has served the Trophy Road leaderboard empty for recent seasons. It no longer reads like an unknown location (#176).',
        "`rankings_timeline` takes `season`, as every windowed tool does (#177).",
      ),
      "Notes, a refusal and a new argument; no value changes.",
    ),
  },
  {
    version: "6.35.0",
    date: "2026-09-23",
    summary: md(
      "The player tools, after the Elixir Gym's second run on them (feedback #171-#172).",
      list(
        "`fit_for` on battles_meta_decks and battles_meta_cards carries `recent_mean_level`, the level the player fields now (their last ten decided battles, as players_collection serves it). `vs_fielded` and the upgrade targets read against it, and a note says when the player is levelling up. The 30-day mean alone had told a levelling account to upgrade to where it already plays (#171).",
        "players_summary declares both `trophy_range`s and says how they differ: `trophy_floor.trophy_range` is trophies landed on after each ladder battle, and a deck's is the trophies its battles started at. `best_deck` is declared with `top_deck`'s properties, and `last_played_at` is declared (#172). The values are unchanged.",
      ),
      "Additive fields and descriptions; the upgrade target moves to the recent level.",
    ),
  },
  {
    version: "6.34.3",
    date: "2026-09-23",
    summary:
      "game_clock says that a clan's race closes each war day before the 10:00Z grid, in the half hour before it and per race (observed 09:30 to 10:00Z). `war_day_closes_at` is the policy boundary, not the moment a race stops taking battles, and war_current carries a race's observed close. The values are unchanged (feedback #169).",
  },
  {
    version: "6.34.2",
    date: "2026-09-23",
    summary:
      "An elixir_timeline page is sized to fit the result cap as well as the 150-item cap. Items are taken in the order they were observed until the page reaches 40,000 characters, and the cut falls on the first item that would not fit: the same `observed_at` cut, so `next_cursor` pages on exactly. A 7-day compact read of a busy clan had exceeded the cap, since a standout carries the whole session shape.",
  },
  {
    version: "6.34.1",
    date: "2026-09-23",
    summary:
      "elixir_timeline holds 150 items a page, down from 200, so a compact page fits the 48,000-character result cap now that every session_standout is an item (a 7-day compact read had reached 54,766). The rest page through `next_cursor`. elixir_updates and the elixir_docs index point at the about page.",
  },
  {
    version: "6.34.0",
    date: "2026-09-23",
    summary: md(
      "elixir_timeline, after the Elixir Gym's second run on the elixir family (feedback #162-#167).",
      list(
        "A capped page is cut on `observed_at`, the instant that selects an item into a window, and `next_cursor` sits 1 ms before the first item left out. Continuing from it loses nothing at the cut and repeats nothing. Every item, sessions included, carries the instant the record learned it as `observed_at`, and the back-dating note quotes this page's longest lag (#162).",
        "`days_since_poll` counts from the last battle-log read at or before the window's end, so a past window no longer reads null because a later poll exists (#163).",
        "Every `session_standout` is an item. Five were served and the rest dropped with `has_more` false (#164).",
        "The clan summary's donations read the game week the window ends in: a window ending exactly on the Monday 10:00Z boundary is the week that just closed, not an empty new one (#165).",
        "The clan entry's `war` is the calendar's week at the window's end. Its race facts are that week's record, or null when none is recorded, never the current week's under a past day's label (#166).",
        "elixir_updates, elixir_examples and the elixir_docs index carry `docs` (#167). clans_participation's donations note states the highest-value rule of 6.33.0.",
      ),
      "Corrected values: paging, days_since_poll on past windows, standout items, the week of the clan summary's donations and war.",
    ),
  },
  {
    version: "6.33.1",
    date: "2026-09-23",
    summary:
      "`collections_get` says what `years_played` is: the account's age in whole years (the game's YearsPlayed badge level), not time in the collection, and null until a profile poll has read the badge. Its description no longer calls it tenure, or calls `open_members` an open-member count (feedback #160).",
  },
  {
    version: "6.33.0",
    date: "2026-09-23",
    summary: md(
      "The clan tools after the Elixir Gym's second run on them (feedback #157-#158), and a rule for weekly donations.",
      list(
        "`clans_standings` `mode` is event-aware on every part of the answer: the edge days' raw rows and the streak rows now use the rollup's own group rule. `casual` had counted 281 event battles, and `event` had missed 285 (#157).",
        "Weekly donations are the highest counter value the record saw in the week's game days (Monday 10:00 to Monday 10:00 UTC). The weekly counters only climb until they drop to 0 at the weekly reset, so the highest value is the week's total, however close to the reset the reads fall. The `pre_reset` row keeps its high-water mark, so a read after the reset can no longer zero it. The weeks ending 2026-09-07 and 09-14 are repaired to the best value recorded. `clans_participation` and the clan summary on `elixir_timeline` read the week's highest value (#158).",
      ),
      "Corrected values: standings by mode, and weekly donation totals.",
    ),
  },
  {
    version: "6.32.1",
    date: "2026-09-23",
    summary:
      "`cards_synergy`'s raw-window mode split uses the season rollup's mode-group rule, so a battle of an odd API type reads `casual` on both paths, not `other` on one (#154).",
  },
  {
    version: "6.32.0",
    date: "2026-09-23",
    summary: md(
      "The card tools, after the Elixir Gym's second run on them (feedback #153-#155).",
      list(
        "`cards_synergy` on a banded season read counts partners over the rollup's own population. The partner walk had kept event battles and drafted decks the anchor row leaves out, so `co_occurrence_rate` reached 4.92 and `lift` 139 (#153).",
        '`cards_card` and `cards_synergy` apply the meta population (no event content, chosen decks only) on a raw from/to window, as the season rollup does, so one window reads the same whichever way it is written. `mode: "event"` answers empty with a note saying why (#154).',
        "`cards_card` on ranked says `by_band` is empty because ranked has no trophy band, not that the rollup is unfilled. `methodology.prior_source` names what the read actually shrank toward (#155).",
      ),
      "Corrected values: raw-window card reads and banded synergy partners.",
    ),
  },
  {
    version: "6.31.1",
    date: "2026-09-23",
    summary:
      "On a raw window the meta tools apply the meta population to the battles they consider, not only to the decided ones. `excluded.considered` then equals `decided_battles` plus the excluded buckets again, as on a season read (6.31.0 had counted an event battle as considered and then in no bucket).",
  },
  {
    version: "6.31.0",
    date: "2026-09-23",
    summary: md(
      "The battle tools, after the Elixir Gym's second run on them (feedback #148-#151).",
      list(
        '`battles_meta_decks` and `battles_meta_cards` apply the meta population (no event content, only decks the player chose) on every window. Before, a custom window or a segment read raw had kept both, which disagreed with the season rollup. `mode: "event"` there answers empty with a note, not a silent zero (#148).',
        "`mode` is event-aware everywhere: `battles_trends`, `cards_synergy`, the card profile and `battles_opponents` filter event battles by their event tag, and `battles_cards` labels them `event`, not `casual` (#148).",
        "`battles_query` `deck_stats` counts the battles this call matches (its window, mode and filters), the same set as `total_count`. It had counted the deck's lifetime whatever the window said. It is now declared in the output schema (#149).",
        "A note says when rows carry no tower level (river race rows record no support cards), so their towers may have started unequal and `vs.tower_hp` is not a margin of victory (#150).",
        "A too-large refusal on a one-size tool no longer advises `compact` or quotes the verbosity, and an unknown-argument refusal lists `verbosity` among the known arguments (#151).",
      ),
      "Corrected values: deck_stats, and the meta tools on raw windows now exclude what the season rollup excluded.",
    ),
  },
  {
    version: "6.30.1",
    date: "2026-09-23",
    summary:
      "`badges_rarity` and `badges_holders` on the corpus count only the players recorded now (#145). The corpus had pooled every profile the record ever read, about twice the recorded population, with badges and clans as old as March. A note says what `players_considered` counts. The acceptance interpreter's `count_eq` also compares with a list's length.",
  },
  {
    version: "6.30.0",
    date: "2026-09-23",
    summary: md(
      "The badge tools, after the Elixir Gym's second run on them (feedback #144-#146).",
      list(
        '`badges_rarity` quotes each versioned pair (`RoyalTournamentRank` / `RoyalTournamentRank_v2`) as distinct players holding either, and how many hold both. It used to say to add the two rows, which double-counted a player who holds both. `badges_holders` names the other half of a pair and its count in the same population, so "Royal Tournament Rank" no longer reads as 0 of the top 100 when 73 hold the `_v2` (#144).',
        "On the corpus segment, a note says what `players_considered` counts: every player whose profile the record has read, not only the players recorded now. A holder's `clan_tag` is described as the clan at `observed_at` (#145).",
        'A misspelled badge label is refused with the closest badges by edit distance ("Valkyrie Mastry" suggests MasteryValkyrie), and every miss says `exactly` (#146).',
      ),
      "Notes and refusal text; no value changes.",
    ),
  },
  {
    version: "6.29.1",
    date: "2026-09-23",
    summary:
      "The 6.29.0 war-trophy timing note names only fields its response serves: `our_clan_war_trophies` on the weeks list and `clan_war_trophies` on an exact week's standings. The `war_rivals` note no longer names a `trophy_change` its rows do not carry.",
  },
  {
    version: "6.29.0",
    date: "2026-09-23",
    summary: md(
      "The war tools, after the Elixir Gym's first run on them (feedback #140-#142).",
      list(
        "`clan_war_trophies` on `war_history`, `war_current` and `war_rivals` is said to be what it is: the figure going into the race, not including the week's own `trophy_change`. After a closed week the clan stood at `clan_war_trophies + trophy_change` (#140). The values do not change.",
        'The war output schemas declare `clan_war_trophies` and `our_clan_war_trophies`, and call `clan_score` a deprecated alias instead of "the game\'s own strength number". The `war_rivals` note no longer claims the figure is null before 2026-09-17 (#141).',
        '`war_history` for a section a season does not have says the week never existed. The check uses that season\'s own count (four or five sections), not the largest any season has: 136/4 had read "not yet played" (#142).',
      ),
      "Notes and schema descriptions; no value changes.",
    ),
  },
  {
    version: "6.28.0",
    date: "2026-09-23",
    summary: md(
      "The ranking tools, after the Elixir Gym's first run on them (feedback #136-#138).",
      list(
        "`rankings_clan_ladder` says when places on the page share a score: the game lists a tie in its own order, so rank inside it, and rank against `previous_rank`, is not a standing (#136). The global clan board had 360 clans tied at the 140,000 ceiling, ranked 1 to 360.",
        "Mode boards stop carrying the Path of Legends notes, and say that their rating is the event's own. `snapshot.standings_changed_at` on a mode board, and on each row of the `location: \"list\"` catalog, says when rank or rating last moved. A snapshot is also written when only a clan changes, so a closed event's `observed_at` read as today. A note says when a board's standings have not moved in two days (#137).",
        "The notes that point at per-battle rank and rating name the fields `battles_query` serves: `global_rank`, `starting_trophies`, `trophy_change` (#138).",
        "`players_profile` points lifetime donations at the `players_timeline` `total_donations` series; the note named a `lifetime` field the profile never carried.",
      ),
      "Additive fields and notes; no value changes.",
    ),
  },
  {
    version: "6.27.0",
    date: "2026-09-23",
    summary: md(
      "The player tools, after the Elixir Gym's first run on them (feedback #129-#134).",
      list(
        "`players_search` ranks an agent's own clan's members as clanmates and a whole-name match before a partial one, and serves `total_matches` and `truncated` (#129). Before, it ranked clanmates only through a person's claimed players, so an agent never saw its clan first.",
        "Deck-level `modes` on `players_summary` and `battles_decks` are event-aware: event battles are `event`, not `casual`. `top_deck` and `best_deck` come only from decks the player chose, and `net_trophies` is Trophy Road's alone (#130).",
        "`war_day_wins` and `clan_cards_collected` are described as what they are: frozen counters of the retired Clan Wars format, not lifetime war wins or donations (#131).",
        "`top_deck` and `best_deck` carry `trophy_range` and `last_played_at`, and a note says when their ladder ranges do not overlap (#132).",
        "`players_collection` `fielded` carries `recent_mean_level` (the last ten decided battles) beside the 30-day mean, with a note when they differ by a level. It also echoes the window behind it (#133, #134).",
        "`players_summary` echoes `season` and `crosses` with the shared note, and `players_timeline` takes `season` (#134).",
      ),
      "Additive fields; corrected values (deck modes, net_trophies, clanmate ranking).",
    ),
  },
  {
    version: "6.26.0",
    date: "2026-09-23",
    summary: md(
      "The game family, after the Elixir Gym's first run on it (feedback #125-#127).",
      list(
        "`game_events` selects the events reads made inside the window's own instants, not the UTC dates around them (#125). A window holding no read returns nothing, and `timezone` now matters. `game_days_read` lists the game days a read covered, a note names the game days in the window nothing read, and `running_on_latest_day` is described (#126).",
        "The events read is anchored to the 10:00Z board-day like the daily leaderboards, instead of 24 hours after the last one (#126). It had drifted about 26h50m apart and skipped a game day about every ten days (2026-09-12, 2026-09-22).",
        "`game_clock({at: 'YYYY-MM-DD'})` means that game day: its start, 10:00Z. Before, it meant 00:00Z, which is still the day before on the game's grid, and a note now says which instant was used (#127).",
      ),
      "Additive: game_days_read; corrected: game_events' window, game_clock's date-only at.",
    ),
  },
  {
    version: "6.25.0",
    date: "2026-09-23",
    summary: md(
      "The elixir family, after the Elixir Gym's first run on it (feedback #118-#123), and every tool with an outputSchema.",
      list(
        "`elixir_timeline`'s item cap now cuts cleanly (#120). When a cap leaves items out, the page stops before the first of them, `next_cursor` continues exactly there, `has_more` is true, the read pointer moves only to the cut, and `timeline_more` counts the items still to read after the kind and section filters. Before, the newest items were dropped while the cursor pointed past them, so a reader on the pointer lost them for good.",
        "Every timeline item carries `observed_at`, when the record saw it, which is what selects it into a window, beside `at`, when it happened. A note says so when items dated before `from` are served (#118).",
        "A `quiet_crossed` moment's facts are as of the crossing: `days_quiet` is the rung. `days_since_poll` is null, not negative, when the only poll known came after the window's end (#119).",
        "The moment ledger's history is stated: profile-derived moments begin 2026-09-14T04:27Z, and steps from before the step rule carry `step: null`. A moment written twice (#48) is served once (#121).",
        "`result_too_large` gives the actual size, stops telling a compact call to use compact, and names `kinds` and `sections` where a tool takes them (#122). `elixir_my_identities` and `elixir_docs` page reads carry notes, and the page reads a `docs` pointer (#123).",
        "All 55 tools publish an `outputSchema`; 6.14.0 said so, and nine had none (#115). A test now holds it.",
      ),
      "Additive: observed_at, step null, has_more/next_cursor now honest on a capped window.",
    ),
  },
  {
    version: "6.24.2",
    date: "2026-09-23",
    summary: md(
      "clans_participation fits the result cap again at eight weeks, full.",
      list(
        "The finished-early caveat is one sentence naming every finished week. A note per week had pushed the eight-week full read past the 48,000-character cap from 6.23.0, and it was refused. `war_scoring_decks` rides windows of up to six war weeks, which the default five ISO weeks span.",
      ),
      "Wording and a window limit; no shape change.",
    ),
  },
  {
    version: "6.24.1",
    date: "2026-09-23",
    summary: md(
      "Fixes to what 6.23.0 shipped.",
      list(
        "`clans_participation` serves `war_scoring_decks` for windows of up to five war weeks. At six to eight, the full response ran past the result cap and was refused, and the note points to `war_history.scoring_decks` instead.",
        "`clans_timeline`'s general note is back to its old wording. The `members_*_plus` coverage caveat rides only on days that were not fully profiled, as the Gym's control asks.",
      ),
      "No shape change beyond when war_scoring_decks appears.",
    ),
  },
  {
    version: "6.24.0",
    date: "2026-09-23",
    summary: md(
      "The collection tools, after the Elixir Gym's first run on them (feedback #114-#116).",
      list(
        "Collections carry `synced_from`: the live board a collection's membership is re-synced from daily, or null for a curated one. A board collection says it follows the board and is not a fixed cohort, and its description says so. A collection segment on the meta tools and `cards_card` says it applies the membership as of the call (#116).",
        "`collections_get` says how its rows are ordered and what they are not: Trophy Road trophies, not a Path of Legends rating or the board's rank, with `rankings_players` / `rankings_clans` for the board's order. It also defines `open_members`, which is the clan's member count, not open places (#114, #115).",
        "`collections_browse`, `collections_get` and `collections_edit` publish their `outputSchema` (#115).",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.23.0",
    date: "2026-09-23",
    summary: md(
      "The clan tools, after the Elixir Gym's first run on them (feedback #110-#112).",
      list(
        "`clans_participation` `war_weeks[]` carries `finished_early` and `finish_war_day`, and members carry `war_scoring_decks` at full verbosity (#110). A note names every war week that finished early. Decks played after the boat crossed earn 0 points, so `war_points / war_decks` is not a rate on those weeks: 15-19% of the decks shown in the last two weeks were such decks.",
        "`clans_timeline` says that its profile-derived values, the `members_*_plus` counts included, cover only the members whose profile was polled that game day. It names the days where that was fewer than all. The game day in progress carries `partial: true` (#111).",
        "`clans_roster` keeps `notes` and `docs` at compact and serves `role_counts` at full (#112).",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.22.0",
    date: "2026-09-23",
    summary: md(
      "The card tools, after the Elixir Gym's first run on them (feedback #102-#108).",
      list(
        "`cards_archetype({cards})` answers an eight-card set, its main use, instead of timing out every time (#104). The exact-set lookup goes through the card index. A timeout hint names `from`/`to` only on tools that take them.",
        "Trophy bands are Trophy Road trophies. A ranked (Path of Legends) observation carries a rating, not trophies, and now sits in no band (#102). Before, the top-1,000 board filled `under_5000`. The season rollups were rebuilt, and a note says so wherever bands and ranked meet.",
        "A form said before a win condition keeps to that form: 'Evo Royal Hogs bridge spam' counts and filters only the Evo form's decks (#105). A bare name matches every form and says so.",
        "`cards_card` `members.played` counts the same population as `season`, so war duels are out (#103). It serves `excluded`, `prior_win_rate` and `prior_basis`, and `insufficient_sample: true` where the shrunk rate is withheld. It no longer claims a corpus prior where it shrinks toward the segment, and a player segment carries freshness (#107).",
        "`cards_card` `history` says when the mode mix moved under the series: ranked went from 18% to 92% of observations between July and September (#106). `cards_synergy` says `anchor.decks` counts observations, not deck identities (#108).",
      ),
      "Additive fields (`excluded`, `prior_win_rate`, `prior_basis`, `insufficient_sample`) and corrected values (bands without ranked, `members.played` without duels, form-scoped archetype names).",
    ),
  },
  {
    version: "6.21.1",
    date: "2026-09-23",
    summary: md(
      "Two note wordings from 6.21.0, and the duel repair done.",
      list(
        "`battles_query`'s `vs` note says again that `starting_trophies` is what matchmaking paired on ladder, and the unequal-towers note says the tower levels differ.",
        "The recorded duels are recomputed on games won: 140 duels, 280 player-days of daily totals.",
      ),
      "Wording and data; no shape change.",
    ),
  },
  {
    version: "6.21.0",
    date: "2026-09-23",
    summary: md(
      "The battle tools, after the Elixir Gym's first run on them (feedback #95-#100).",
      list(
        "A duel's `outcome` is the games won, first to two, not the summed crowns (#95). A duel won 0-3, 1-0, 1-0 had been recorded as a loss at 2 crowns to 3, and 7 of one player's 70 duels were wrong in this way, some of them as false draws. Ingest decides it from the rounds, and the duels recorded before were recomputed along with their daily rollups.",
        "A duel's `elixir.leaked` is the sum across its games, as the note and schema already said (#96). It had been the final game's counter.",
        "`me.vs` gains `tower_level`, the tower troop's level edge. A note fires when the towers started unequal, because `vs.tower_hp` then includes the starting-hitpoint gap as well as the damage. `vs` is null on boat battles (#97).",
        "On river race rows a note says `vs.starting_trophies` is not what matchmaking paired: war draws from the racing clans (#98).",
        "`battles_performance.trophy_floor.floor` is the floor the player stood on most recently, with its own counts. The new `floors[]` lists every floor the window stood on, and the note names each (#99). Before this, `floor` was the lowest floor and every free loss was put on it.",
        "`tower_hp.princess` is `[0, 0]` when both princess towers fell, as the docs promise (#100). The key had been missing.",
      ),
      "Additive fields (`vs.tower_level`, `trophy_floor.floors`); corrected values (duel outcome and leak, trophy_floor.floor on a multi-floor window).",
    ),
  },
  {
    version: "6.20.0",
    date: "2026-09-23",
    summary: md(
      "The badge tools, after the Elixir Gym's first run on them (feedback #91-#94).",
      list(
        "`badges_holders` rows gain `since`: when the record first saw the badge at this level. `observed_at` is now the last profile poll that read the badge, as everywhere else. It used to be the stored change time, so 38 of 46 clan rows read as 17 days stale when every member had been re-read within a day. `observations` on both tools is the oldest and newest profile poll among the players considered.",
        "A versioned identifier says its version in its `label`. `RoyalTournamentRank_v2` is `Royal Tournament Rank (v2)`, and the single holder of the legacy badge no longer reads as the rarest badge in the game. `badges_rarity` notes a versioned pair when it lists both. `2v2` badges read `2v2 League Rank`, not `2v 2`.",
        "`badges_holders` takes a badge's label as well as its identifier. A label two badges share is refused with both identifiers. A miss is refused about the argument, with candidates, instead of 'no recorded player holds'.",
        "`badges_holders` serves `holder_share` (holders_total / players_considered) as its notes promised, and publishes its `outputSchema`.",
      ),
      "Additive: `since`, `holder_share`; `observed_at` keeps its documented meaning.",
    ),
  },
  {
    version: "6.19.3",
    date: "2026-09-23",
    summary: md(
      "Faster level gaps and trends, and three more tools on the analytical budget. Wire shapes are unchanged.",
      list(
        "Every level gap (`mean_level_gap` on `battles_cards`, `battles_decks`, the two meta tools, `players_summary` and `clans_standings`) now reads the opponent's deck level from the battle row, not from a lookup per battle. A clan's season `battles_meta_cards` went from 8.2 s to 2.3 s, and `battles_meta_decks` from 6.7 s to 0.4 s. The values are the same.",
        "`battles_trends` no longer joins every battle back to the battle table for fields the participant row already carries.",
        "`battles_trends`, `cards_card` and `cards_synergy` join the analytical reads. They get the larger sort memory, and they return a structured `query_timeout` with a request id at the 18-second budget instead of racing the function's deadline. `war_history` was already one of these reads; the limits page now lists it.",
      ),
      "Performance; the only behaviour change is which error an over-budget read returns.",
    ),
  },
  {
    version: "6.19.2",
    date: "2026-09-23",
    summary: md(
      "One note, said in the reader's words.",
      list(
        '`war_history`\'s `finished_early` note said a week "without a standings capture" is null. Capture is our word for how the record is taken, not the reader\'s; it now says a week "whose standings were never recorded". The flag\'s `outputSchema` description gains the in-progress case 6.19.1 added to the note.',
      ),
      "Wording only.",
    ),
  },
  {
    version: "6.19.1",
    date: "2026-09-23",
    summary: md(
      "Three small honesty fixes from the Gym's open questions and the usage audit.",
      list(
        "`war_rivals` rounds `mean_fame` and `median_fame` to whole fame and never said so, so recomputing them from the standings differed by half a point (0 and 4059 give 2030, not 2029.5). The note says it now.",
        "`war_history.weeks[].finished_early` is NULL on a week still in progress. It read `false`, which is the one wrong answer the flag exists to prevent: the week has not failed to reach the line, it has not had the chance, and a consumer filtering `finished_early === false` for weeks the clan did not close out was catching the live one.",
        "`battles_query`'s `limit` description no longer implies 25 full battles is a safe page. A full row grew with tower hitpoints, elixir, the comparison block and a duel's rounds, and about ten can reach the result cap. The hard guard is unchanged on purpose - a page that fits should still be served, and the `result_too_large` refusal already prices the retry from the actual bytes.",
      ),
      "Notes and descriptions, plus one null where a false was wrong.",
    ),
  },
  {
    version: "6.19.0",
    date: "2026-09-23",
    summary: md(
      "The war family's `clan_score` is WAR TROPHIES, and now says so (feedback #88).",
      list(
        "`clan_war_trophies` joins `war_current.standings[]`, `war_history.standings[]` and `war_rivals` rows, and `weeks[].our_clan_war_trophies` joins `our_clan_score`. It is the number those surfaces always carried.",
        "The race payload spells it `clanScore`, which is the API overloading the key: a clan profile carries BOTH `clanScore` (~129,000) and `clanWarTrophies` (~1,200), and the race reports the second under the first's name. The same overload is already recorded for the war leaderboard. The docs said this field was \"the same figure a clan's profile shows\" - it is that figure divided by about 108, and the sentence invited a cross-family join that was wrong by two orders of magnitude.",
        "`clan_score` and `our_clan_score` are DEPRECATED aliases of the same number, kept so nothing breaks today and removed in 7.0.0 with the other breaking changes.",
      ),
      "Additive. Verified two ways: the API returns both keys on one clan object, and our own week series rises by exactly each week's trophy_change (980, 1000, 1020, 1040, 1060, 1160 across 135/0-136/0), which a clan score does not do.",
    ),
  },
  {
    version: "6.18.1",
    date: "2026-09-23",
    summary: md(
      "The boat note quoted its share against the wrong denominator (feedback #89).",
      list(
        "6.15.0's note names `points / scoring_decks` as the rate boat decks contaminate, then reported each member's share against `decks_used`. On a week that finished those differ: ryguy67 read \"1 of 8\" where the rate's own denominator makes it 1 of 4 - exactly double. The share is now of `scoring_decks`, and it reads \"up to N\", because `boat_attacks` is the WEEK's counter and the record cannot say which of them fell on a scoring day, so it is a ceiling on the contamination rather than a measurement of it.",
      ),
      "Note text only; no field changed.",
    ),
  },
  {
    version: "6.18.0",
    date: "2026-09-23",
    summary: md(
      "The comparisons a battle row always held both halves of, and what its signature proves about how long it ran.",
      list(
        "`me.vs` on every head-to-head row: `crowns`, `deck_level`, `starting_trophies` and `tower_hp`, each as me MINUS the one opponent. These numbers mean little alone and a caller was reaching into two nested objects to difference them - `deck_level` is the level edge in THAT battle from the cards as played, `starting_trophies` is what matchmaking paired, and `tower_hp` is remaining hitpoints on both sides, which is a margin of victory and never a tower level. Null on 2v2 and duels.",
        "`inferred.duration` on head-to-head 1v1 rows: the battle log carries no duration, but the game's clock makes the crown pair a bound. A King Tower is the only way to end before regulation, so a three-crown finish is `at_most_s` 300 with no floor; any other finish ran `at_least_s` 180; and level crowns means overtime expired and the tower-hitpoints tiebreaker resolved it, which is `exact_s` 300. `basis` says which rule fired. Absent on duels (crowns sum over up to three games) and boat battles (no overtime).",
      ),
      "Additive, full verbosity only. Nothing is measured that the record does not hold: duration is a bound the signature PROVES, never a timing.",
    ),
  },
  {
    version: "6.17.0",
    date: "2026-09-22",
    summary: md(
      "Event content is its own mode group, and it no longer informs the meta. Game modes are played as different games, and Elixir was pooling them.",
      list(
        "`event` joins the mode groups, decided by the API's own `eventTag` rather than by the battle type. `type: trail` carries one on 100% of 123,562 recorded battles and every permanent format carries one on 0%, so the tag - not the type, not the mode's name - is what marks time-bound content. `trail` used to fold into `casual`, which filed the reworked Seasonal Trophy Road as casual play and pooled a fortnight's 2v2 tournament with ordinary friendlies. `mode: 'event'` selects it; every other `mode` now excludes it.",
        "The meta population EXCLUDES event content and decks the player did not choose (`deck_selection` outside `collection` and `warDeckPick`: eventDeck, draft, draftCompetitive, pick, quadDeckPick, predefined). A Seasonal Arena II deck is floored at Level 15 - its recorded decks average 15.87 against 13.67 on Trophy Road - and a drafted deck is not a deck anyone chose, so a win rate over either measures the format. Both remain fully readable through `battles_query` and a player's own record.",
        "`event` is a FILTER, never a population: one event is not another. `trail`+`TeamVsTeam` alone has carried ten distinct event tags, and a rate over event content must key on `context.event_tag` itself.",
      ),
      "A player's own battle counts are unchanged in total; battles that used to read `casual` now read `event`. Meta and deck statistics change: they were counting populations that do not describe the meta.",
    ),
  },
  {
    version: "6.16.0",
    date: "2026-09-22",
    summary: md(
      "A duel can answer for its own rounds, and a battle says whether you met a ranked opponent.",
      list(
        "`battles_query` rows carry `rounds[]` on a duel: each GAME's own crowns, `tower_hp` and `elixir` - including a per-round `differential`, which the summed top-level counter cannot have - on the round numbers `deck.rounds[]` already used, so a round's deck and its result line up. The API has always reported these; Elixir recorded the round DECKS and discarded the round RESULTS, and said so in the docs as if it were a property of duels. 20,218 round rows across 4,362 duels were filled back from the payload archive.",
        "`global_rank` on every participant of every row: the player's global leaderboard position as the API reported it ON that battle, null unless they were ranked then. 129,162 rows carry one, range 1-500.",
      ),
      "Additive. Both ride full verbosity only; compact is unchanged.",
    ),
  },
  {
    version: "6.15.0",
    date: "2026-09-22",
    summary: md(
      "The Elixir Gym's second war run (feedback #84-#86), on the day-by-day and the exact-week path of `war_history`.",
      list(
        "`days[].standings[].progress_end_banked` (and on `war_current.days_closed[]`): the race log caps a finished boat's progressEndOfDay at the line, so the finishing day read 10000 where 6811 + 3000 + 323 = 10134 was banked and the next day's progress_start carried it - the one row in twenty where the array's own arithmetic broke, and a walk over progress_end showed +134 on a day that earned nothing. `progress_end` stays the API's value; `progress_end_banked` is the banked one on every row, equal to it wherever no cap fired; a conditional note names the clamped rows.",
        "A conditional note on `war_history.member_weeks[]` and `war_current.participants[]` whenever a row carries `boat_attacks > 0`: boat attacks are counted INSIDE `decks_used` and `scoring_decks`, a boat battle spends a war deck and scores on a different scale, so `points / scoring_decks` is not comparable between those rows and the rest (the rate the 6.11.0 note sanctions pooled the two: a member with four boat decks ranked last of 26 on it). The decks note now lists a boat battle among what consumes a deck; the docs do too.",
        "`history_starts_at` on the exact-week path as well (it was served only with `seasons`), and an empty exact week says which side of the horizon it is on: before recording began, after the latest recorded week, a section no season has (0-4), or a gap inside the span - a week before the horizon and a week that never existed answered byte-identical.",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.14.0",
    date: "2026-09-21",
    summary: md(
      "players_collection at full verbosity fits again. A mature collection's full answer was ~55k characters against the 48k result cap - every read refused, and with no limit to narrow, the refusal could not price a retry. 31k of it was the catalog repeated per card.",
      list(
        "Collection rows no longer carry `iconUrls`, `rarity`, `elixirCost`, `maxLevel` or `maxLevelRarityScale`: they are the same for every player and `cards_catalog` carries them once. A row keeps id, name, level, count, starLevel, evolutionLevel, maxEvolutionLevel, forms_available and forms_unlocked. A 126-card collection reads ~24k at full.",
      ),
      "A minor, not a major, by Jamie's call (2026-09-21): the fields removed are catalog facts, and no client could receive the full answer for a mature collection - the last week's reads were all compact. Also in this version: every tool now publishes an outputSchema in tools/list (23 more - badges_rarity, battles_cards, battles_compare, battles_opponents, battles_trends, cards_card, cards_catalog, cards_synergy, elixir_changelog, elixir_collectors, elixir_data_insights, elixir_docs, elixir_examples, elixir_updates, game_clock, game_events, players_collection, players_names, players_search, rankings_clan_ladder, rankings_clans, rankings_timeline, war_rivals), permissive below the top level as the others are.",
    ),
  },
  {
    version: "6.13.0",
    date: "2026-09-21",
    summary: md(
      "The middle rung of adoption cost (the Gym's open question after its 6.10.0 run; Jamie's call 2026-09-21: the win condition dominates the family). A player fielding Evo Royal Hogs bridge spam was shown Evo Royal Hogs cycle on the bottom rung beside Three Musketeers beatdown, because fit knew families and exact labels and nothing between.",
      list(
        "`fit.plays_win_condition` on every `battles_meta_decks` row with `fit_for`: the player already fields one of the row's win conditions, form included (Evo Royal Hogs is not Royal Hogs - the form is what is unlocked and leveled). `fit_for.plays.win_conditions[]` lists theirs as a label speaks them.",
        "The note reads adoption cost off the three booleans in order: exact shape, then the same win condition in another family (the card leveled and learned, played at a different pace), then the same family around a new win condition, then neither.",
        "`war_history.weeks[].in_progress` is on every row, true or false; it was emitted only when true, so an absent flag read as false - the shape of the finished_early defect, caught by the new acceptance suite's first run.",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.12.0",
    date: "2026-09-21",
    summary: md(
      "The corpus meta on a week's window, and a compact size for the meta tools (feedback #77-#80: every 7-day corpus read of `battles_meta_decks` and `battles_meta_cards` timed out, and four full payloads crossed a turn's ceiling).",
      list(
        "A corpus read whose window sits inside the running season without being the whole of it now answers from the season's population table (the rows the nightly rebuild aggregates, level gap on the row), filled through the nightly's cursor, which a note names; the same numbers the raw scan gave, in a second or two instead of a timeout. The table is kept for the running season and the one before it, so a window may span the roll; one that starts past the cursor or reaches an older season scans the raw rows as before.",
        "`verbosity: 'compact'` on `battles_meta_decks` and `battles_meta_cards` is a real size: a deck row keeps `deck_hash`, `archetype_label`, `card_names` (one string), the counts, `usage_share`, `win_rate`, `shrunk_win_rate`, `players`, `dominant_mode` and `fit` without its upgrade path; a card row the counts, rates and `held`; both drop `modes`, the instants, the level gap, the card and archetype objects, `methodology` and `modes_in_window`. Scalars and flags are unchanged between sizes.",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.11.0",
    date: "2026-09-21",
    summary: md(
      "The Elixir Gym's war run (feedback #81, #82): `finished_early` was documented, named in every `war_history` note and served on no row - it was computed as fame exactly 10,000, and the record keeps the boat's progress past the line (10,134, 10,305) that the live race reports where the race log caps it - and `war_current` put `points` beside `decks_used` with no word that the decks after the finish earned nothing.",
      list(
        "`war_history.weeks[].finished_early` on every row: true on a regular week whose boat reached the line, false when it did not, null on a Colosseum week (no finish line) or without a standings capture. `finish_war_day` beside it: the war day whose close carried the boat over, from the race's own day-by-day (a finish is a day close; the game banks progress then), null when the log does not hold the week.",
        "`scoring_decks` on `war_history.member_weeks[]` and `war_current.participants[]`: `decks_used` less the decks played on the war days after the finish - the denominator of a points-per-deck rate. Equal to `decks_used` on an unfinished week; null when the record cannot separate the two.",
        "`war_current.finish_war_day`, and a conditional note once the boat has finished naming the instant, the day and the count of decks played since for 0 clan points.",
        "`war_rivals.finished_races` on every row: the count the fame statistics were taken over (`races_observed` includes the week in progress and is not their denominator); a rival with no finished shared race reads null, not zero. The latest recorded week counts as finished once the recorder has seen it close, rather than as in progress until the next week starts.",
      ),
      "Additive. The weekly clan email's fame line reads 'crossed the line early' again; it had read 'boat fame' on every live-polled finished week.",
    ),
  },
  {
    version: "6.10.0",
    date: "2026-09-20",
    summary: md(
      "A card that names a deck without being its win condition (the Rune Giant read). Some decks have no building-targeter at all - the tower damage is chip from enchanted or support troops behind a tank - and the deck sites lead the name with the tank: 'Rune Giant beatdown'. The wiki says exactly that of Rune Giant and the guides say it is not a win condition; both are now true in the data.",
      list(
        '`archetype.named_by` on every deck object and on `cards_archetype`: with no win condition in the deck, the card the label leads with (`{ id, name, form }`), null otherwise. `win_conditions` stays empty on such a deck - the card is not one and never anchors over one. The stamp carries the naming card, so `archetype: "rune giant beatdown"` filters and `group_by` folds it like any other label.',
        "Vocabulary: `names_deck` (cr-agent-api-docs `7bd537b`), Rune Giant the only entry; the reference's validator refuses a card that is both a win condition and a namer. The unattested queue no longer counts a named deck as nameless.",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.9.0",
    date: "2026-09-20",
    summary: md(
      "The debug pass: a few hundred recorded decks read beside their labels (the `{archetype_sample}` operator read), and what it changed.",
      list(
        "`archetype.secondary_win_conditions[]` on every deck object and on `cards_archetype`: every other attested win condition in the deck, by priority - what the label leaves out, so an agent can say 'Miner control, with Goblin Barrel and Boss Bandit' without reading the cards.",
        "Vocabulary (cr-agent-api-docs `130a770`): Minion Giant (a building-targeting win condition; the most-played nameless deck of the season was 2.6 Hog's eight with Minion Giant in the Hog slot) and Goblinstein (a win condition below the classic chip cards) are attested from public sources; Giant pairs with Sparky ('Giant Sparky'); Wall Breakers is cycle only at cycle cost; Ronin, Boss Bandit and Elite Barbarians are bridge spam only with a bridge partner beside them, else control; the chip and bridge win conditions are ordered within their tier rather than tied by card id; Rune Giant is declined with its public reason. Aliases: Giant Sparky, Mortar Bait.",
        "Labels moved on re-stamp accordingly; a deck's history is relabelled on purpose.",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.8.0",
    date: "2026-09-20",
    summary: md(
      "The resolver (design §5.2; Jamie, 2026-09-20: the product is still evolving, the tool-list weight is not the constraint).",
      list(
        "`cards_archetype`, three shapes, no population attached. `{ name }`: a family, a composed label or a community name to its family, win conditions, the aliases for that shape, a label, and `this_season` - how many recorded decks, battles and players carry that shape by the stamp. `{ cards }`: up to eight cards (ids or names; `Evo ` / `Hero ` prefixes set the form; tower troops ignored) to their archetype, pure - no record needed - with `in_the_record`: how many recorded identities have exactly that card set and their season. Neither: the vocabulary - families with definitions, the win conditions with tiers and families, bait units, bridge partners, aliases, and the grammar and vocabulary versions with the bounds in force.",
        "An unknown name is refused with the vocabulary in the hint; a card that is not in the catalog is refused by name.",
      ),
      "Additive.",
    ),
    tools_added: ["cards_archetype"],
  },
  {
    version: "6.7.0",
    date: "2026-09-20",
    summary: md(
      "Deck archetypes, the last of the arc (design §5.1, §12.4).",
      list(
        "`cards_card` takes `archetype`: the decks carrying the card narrowed to a family, a composed label or a community name, by their stamp, before the top five are cut; `applied.archetype` echoes the resolution.",
        "Admin ▸ Cards on the console (`GET /api/admin/cards`, admins only, read-only): the catalog with each card's archetype role and its public source, the vocabulary version in force and the cr-agent-api-docs commit it was imported from, and the unattested queue - cards with no role that are the defining card of a deck named by cost alone this season. Nothing edits here; the file lives in the reference repository.",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.6.0",
    date: "2026-09-20",
    summary: md(
      "Deck archetypes, phase 2 (design §6, §7, §12.2): the archetype is stamped on every deck, so a whole population can be folded or filtered by name, and the fit reader says which shapes a player already fields.",
      list(
        '`battles_meta_decks { group_by: "archetype" | "family" }`: the population\'s decks folded by stamped label ("Royal Hogs bridge spam") or by family, one row each with `decks`, `battles`, `wins`, `losses`, `win_rate`, `players` and `share`; on a clan, player or collection segment each row carries `members[]` - who plays the shape, with battles, wins and their most-played deck of it - and `players` is exact. Sorted by players then battles: who plays what, never a tier list (`shrunk_win_rate` is deliberately absent). `decks[]` is empty with `group_by`. This is Elixir Clan\'s "what decks do our players use?" in one call.',
        "The `archetype` filter now runs over the stamp for every deck over `min_battles` (the 2,000-row bound of 6.5.0 is gone).",
        "`fit_for` on `battles_meta_decks`: `fit_for.plays` lists the families and labels the player fielded in the window, and every row's `fit` carries `plays_family` and `plays_archetype`, with a note ranking adoption cost - a row in a family they play costs the least, the same family with a different win condition is the usual next step, a new family is a new deck to learn as well as levels to buy.",
        "The stamp (migration 0148: `deck.archetype_family / archetype_label / archetype_win_conditions / archetype_version`) is written at deck insert and caught up nightly for every row behind the current grammar + vocabulary version; `{archetype_stamp}` on the migrate Lambda runs the same on demand. A vocabulary import or a rule change reaches history by the next morning.",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.5.0",
    date: "2026-09-20",
    summary: md(
      'Deck archetypes (docs/reviews/2026-09-20-DECK-ARCHETYPES-DESIGN.md; Jamie, 2026-09-20: players talk about decks by name, and Elixir has to name a deck and know what a name means). Every deck object now carries `archetype` - the deck\'s family (beatdown, control, cycle, bait, bridge_spam, siege; unclassified when no card carries a cost), its win condition(s) with form, a descriptive label composed as `<win condition(s)> <family>` ("Evo Royal Hogs bridge spam", "Hog Rider cycle", "Lava Hound Balloon beatdown"; the bare family when no attested win condition is in the deck), the average elixir, the basis, and two versions: the grammar\'s and the vocabulary\'s. A label is a noun, never a verdict: no matchup, no expected advantage, no quality claim, and none coming.',
      list(
        "`archetype` rides `battles_query` (every rendered deck and duel round), `battles_decks`, `battles_meta_decks` (`decks[]` and `unfieldable[]`), `cards_card.decks` and `players_summary` (`top_deck`, `best_deck`), with one note per response saying what a label is and is not.",
        "`battles_meta_decks` and `battles_decks` take `archetype`: a family, a composed label, or a community name (LavaLoon, Log Bait, 2.6 Hog, Hog EQ, Splashyard, PEKKA Bridge Spam...). Resolved alias first, then family, then label (card names as typed, `pekka` included; an evo/hero prefix ignored); `applied.archetype` echoes the resolution and a note names it; an unknown name is refused with the vocabulary in the hint. Applied over the rows the call would return (the meta reader labels its top 2,000 by the sort), denominators unchanged.",
        "Grammar in code, vocabulary in data: the rules are in the contract package (`classifyDeck`, `resolveArchetypeName`, `GRAMMAR_VERSION`, `CYCLE_MAX`); which cards are win conditions, bait units and bridge partners is cr-agent-api-docs `data/card-roles.json` and `data/deck-aliases.json`, one public source per entry, imported at deploy (`card_role`, `deck_alias`, `card_role_version`; migration 0147) and versioned by the file's commit time. A card absent from the file is not a win condition; the docs page names the unattested cards and the domain's research agent keeps the file. Not bound to the season: history is relabelled when the vocabulary improves.",
        "The docs page `archetypes` carries the families with their sources, the grammar, the cycle bound and how it is measured, and the resolution rules; the `archetype_census` operator read runs the grammar over every recorded deck (family distribution, the unclassified share, the top labels, the average-elixir histogram per win condition, the unattested queue).",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.4.0",
    date: "2026-09-20",
    summary: md(
      "The population's decks against what one player holds (feedback #70, 2026-09-20). A corpus deck sorted by win rate reads as advice, and the payload carried nothing about the caller's collection: an agent recommended a deck the player could not field - two of the top four rows ran a card he did not own, the top row cost him two mean levels at his own card levels. Jamie's call: recommendations come from the player's collection, and the agent must be free to say what a few upgrades would open.",
      list(
        "`battles_meta_decks` takes `fit_for` (a player tag with a recorded collection). Every returned row's cards carry `held_level`; every row carries `fit`: `fieldable`, `missing` (each unowned card or locked form with its reason), `own_mean_level` (the deck at the player's levels), `vs_fielded` (against `fit_for.fielded_mean_level`, the mean level of the decks the player actually played in the window and mode), `upgrades` (each held card below the fielded level, largest deficit first, with the levels needed) and `mean_level_after_upgrades`. A row the player cannot field leaves `decks[]` for `unfieldable[]`, after sort and limit, so the population's ranking is unchanged and an agent cannot recommend what is not in the array. A `fit_for` block says whose collection, as of when, and the benchmark. An unrecorded collection is refused (`not_recorded`) rather than read as owning nothing.",
        "`battles_meta_cards` takes `fit_for` too: each row carries `held` (level, forms_unlocked, has_form) or null when the card is not owned.",
        "Without `fit_for`, both tools open their notes with the sentence that the rows are the population's and check nothing about any one player, and that a recommendation to a person should pass `fit_for`. With it, the note says what `mean_level_gap` is on a meta row - the population's edge, never the caller's - since the same name means the caller's on `battles_decks`.",
        "`players_collection` carries `fielded` - `{ days: 30, mean_level, battles }`, the mean card level of the decks the player actually played in the last thirty days - so 128 held levels have a benchmark without a second call.",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.3.0",
    date: "2026-09-20",
    summary: md(
      "A name beside every tag the console had been showing bare. Three envelopes gain a last-observed name so a reader need not make a second call to say who a record is about.",
      list(
        "`battles_query`: top-level `name` beside `player_tag` when the call named one subject (the page's rows carry it; an empty page still names who), and `me.name` beside `me.player_tag` on each row when it did not (a battle by id, a deck across the corpus). Null when the record has no name for the tag.",
        "`battles_decks`: top-level `name` beside `player_tag`.",
        "`war_history`: top-level `name` beside `clan_tag`.",
        "`players_search`: each match carries `clan_name` beside `clan_tag` (null when the clan is unnamed or the player is in none).",
      ),
      "Additive.",
    ),
  },
  {
    version: "6.2.0",
    date: "2026-09-20",
    summary: md(
      "The rankings family, after the Elixir Gym's regression run (feedback #71-#74 and #76, 2026-09-20). The material one is a label: the live Path of Legends board is the API's top 1,000 (probed: limit=5 returns a cursor, limit=1000 and 2000 return 1,000 rows with none, and a cursor at position 1000 returns an empty page) and every surface that served it described a rating floor. The recorder stores exactly what the API returns (Iceland's board is two rows); nothing was dropped, and the cutoff rising through a season is correct - the word was wrong.",
      list(
        "`snapshot.depth` (1,000 on a live board, 9,999 on a season final) and `snapshot.full` on `rankings_players`, `rankings_clans` and `rankings_clan_ladder`; `snapshot.floor_rating` (the last place's rating) on the player boards. A full board carries a note saying whose cut it is (`truncated: false` there means the API served nothing past depth) and that `floor_rating` is a cutoff that moves, not a qualification threshold: a player or clan can leave the board without losing rating. The standing floor note describes both regimes, and the two 'rated_players rises through a season' clauses are gone - it moves with the cutoff as well as with play, and can fall while every one of a clan's players improves.",
        "`rankings_timeline`: the board curve's points carry `depth`, `full` and `floor_delta` (the cutoff's move since the previous point); a clan's points carry `board_full` and `board_floor_rating` beside `rated_players`; a note counts the points at depth. A season final is described as the API's 9,999 places, cut mid-tie (S135 ends in a nine-way tie at #9999), not 'full depth'.",
        "`rankings_timeline` names the recording horizon (feedback #72): `meta.recorded_since` on every rankings read, and a window that starts a day or more before the board's first snapshot echoes `applied.window.partial: true` with `covers` (the recorded span, or null when none of the window is) and a note - 'unrecorded for the window, not unchanged' when the series is empty, 'covers 2026-09-11 onward' when it is clipped. `rankings_players` and `rankings_clans` read the horizon from the table on an `as_of` before it, instead of a date in the code; `rankings_clans` gains the as_of sentence it lacked.",
        "`pol_final` (feedback #73): `applied.season` is always echoed (the resolved ordinal, or null) with `season_requested` beside it, and a miss says which of four things it is - a season that has not happened (naming the current one), the season in progress (naming when its final is fetched), a season before the ranked ladder began at S89 (the number a player reads off the in-game Pass, with the pointer to game_clock), or a settled season the schedule has not fetched yet. No `pol_final` note offers `live: true`, which the tool refuses.",
        "Every published input schema declares `verbosity` (feedback #74): the eleven two-size tools in their own words, the rest as accepted-and-ignored. 6.0.0 accepted the argument server-side while the schemas still said `additionalProperties: false` without it, so a client that validates arguments before dispatch refused the call locally and never saw the note.",
      ),
      "Additive.",
    ),
  },
  {
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
  },
  {
    version: "6.0.0",
    date: "2026-09-19",
    summary: md(
      "The leaked-elixir counter travels as one object with its caveat on the value (feedback #65 and #66, 2026-09-19). The 3.13.0 note beside the row was served, read and overridden by a consuming agent the morning it shipped, because the number sat beside crowns and trophy_change as if it were an outcome fact; and the differential was populated on duel rows where the shipped spec said null, which supplied the exact number that agent misused. Jamie's call: keep the fields, move them under one object that carries the caveat itself.",
      list(
        "`battles_query` full verbosity: `me.elixir` and every teammate's and opponent's `elixir` is `{ leaked, opponent_leaked, differential, rounds, caveat }` or `null` when the game did not report it. `leaked` is the side's own counter; `opponent_leaked` the one opponent's on `me` of a head-to-head row (null on 2v2 and always null on teammates and opponents); `differential` is `leaked` minus `opponent_leaked` on a single-game head-to-head row and NULL on every duel (each side's counter sums two or three games played on different decks); `rounds` is how many games the counters sum over (null on a duel whose rounds the record never held); `caveat` says why none of it is a skill measure.",
        "The duel note names the field: `elixir.leaked` sums across rounds for both sides.",
        '`verbosity` is accepted on every tool. The instructions call it the one size control without listing tools, so agents sent it everywhere and forty-three tools refused it. A tool with one size now accepts `full` or `compact`, answers in full, echoes `applied.verbosity: "full"` and, when `compact` was asked, says in a note that it had nothing to drop. The eleven tools that declare it are unchanged.',
        "`elixir_send_feedback.message` takes 8,000 characters (was 4,000), and every string-length refusal says how long the value was (`must be at most 8000 characters; it is 9,214`), so nobody trims blind (feedback #64).",
      ),
      "No deprecation window (first-party clients; the 3.0.0, 4.0.0 and 5.0.0 precedent). This is the last major before the adoption freeze: additive minors only from here.",
    ),
    breaking: list(
      "`battles_query`: `me.elixir_leaked` and `me.elixir_leaked_differential` are gone; read `me.elixir.leaked` and `me.elixir.differential`. Teammate and opponent objects' `elixir_leaked` is gone; read `elixir.leaked`. `me.elixir.differential` is null on `riverRaceDuel*` rows where it used to carry the difference of two multi-round sums.",
    ),
  },
  {
    version: "5.0.0",
    date: "2026-09-19",
    summary: md(
      "Pilot Score is gone (Jamie, 2026-09-19: a mirage). Three reviews on the year of the record (docs/reviews/2026-09-19-PILOT-SCORE-ASSESSMENT.md, -PILOT-SCORE-EVOLUTION.md, -ELIXIR-LIFT-TWO-POPULATIONS.md) found that 70-76% of the observations it scored carried no level adjustment at all (Ranked and casual equalize card levels), that between players the adjustment was nearly orthogonal to outcomes (r = 0.09), that a raw win rate was as reliable as the score, and that in Ranked the score was the win rate and the win rate a weekly coin toss. Elixir records and makes the record available; it does not score players against an expected win rate, and will not carry a branded metric of any kind. The card-level fact stays where it always was: `mean_level_gap`, `level_gap_battles` and `comparable` on the deck, card, summary and standings readers.",
      "The same release fills out the card noun (docs/reviews/2026-09-19-CARDS-REVIEW.md): `cards_catalog` carries `type` (troop, building, spell, tower_troop, from the id range the API does not spell out) and `fetched_at` beside `as_of` (which is the catalog's last CHANGE, and now says so); `battles_meta_cards` takes `cards: [ids]` and `battles_meta_decks` takes `containing: [ids]` (decks with ALL the cards, any form), both applied after aggregation so `usage_share` and `decided_battles` stay the population's.",
      "No deprecation window: every client of this server is first-party (the 3.0.0 and 4.0.0 precedent). The first call after reconnecting should re-fetch `tools/list`.",
    ),
    tools_added: ["cards_card"],
    breaking: list(
      'Every card object carries `form: "base" | "evolution" | "hero"` and the integer `evolution` key is gone: deck cards on `battles_query`, `battles_decks`, `battles_meta_decks` and `players_summary` (which once dropped the form), rows of `battles_cards` and `battles_meta_cards`, and `cards_synergy` partners (which carried both spellings). `forms_available` / `forms_unlocked` on the catalog and collections are unchanged (they are sets). `elixir_timeline` facts are unchanged.',
      "`battles_levels` removed: the Level Curve and the per-player Pilot Score, monthly trend, experience cohort and population changes. No replacement; `mean_level_gap` on `players_summary`, `battles_decks`, `battles_cards`, `battles_meta_decks`, `battles_meta_cards` and `clans_standings` is the record's statement about card levels.",
      "`clans_pilot_scores` removed. No replacement.",
      "The meta readers' comparability note no longer points at `battles_levels` for a level-expected rate; it says the record describes the gap and does not adjust for it.",
    ),
  },
  {
    version: "4.2.0",
    date: "2026-09-19",
    summary: md(
      "Badges as a player says them (Jamie, 2026-09-19: the milestone mail read 'MasterySkeletonWarriors (level 5)'; it is Guards Mastery). The API names a badge by Supercell's internal identifier and carries no display name, so every surface that says a badge now carries a label beside the identifier.",
      list(
        '`elixir_timeline`: the `badge_earned` and `legendary_badge_earned` items gain `facts.badge_label` (`facts.badge` stays the identifier `badges_holders` matches on), and their text reads "took Guards Mastery to level 5" or "earned Beating Death".',
        "`players_profile.badges[]` gains `label`; `badges_rarity.badges[]` and `badges_holders` gain `label`.",
        "Mastery badges resolve the card's internal codename to its shown name (`AxeMan` is Executioner, `RageBarbarian` is Lumberjack, `SkeletonWarriors` is Guards); dated badges say the month (`SeasonalBadge_202509` is Season September 2025).",
      ),
      "Additive.",
    ),
  },
  {
    version: "4.1.0",
    date: "2026-09-19",
    summary: md(
      "The 3.13.0 guards, landed on the field that needed them (feedback #61, #62, #63, the 2026-09-19 regression run: every 3.13.0 item held, and three new defects were a guard sitting beside the number rather than on it).",
      list(
        "`battles_performance` (`group_by: week`) and `battles_trends` weeks carry `trophy_mode_battles` (the Trophy Road and Path of Legends battles played) beside `trophy_battles`, which counts only the ones the game reported a trophy delta for. A loss standing on an arena floor reports none, so `trophy_battles` was lower than the ladder games played, only losses dropped out, and a rate over it flattered exactly the floored player the response had already named. The docs now list it among the denominators, and a note names the weeks where the two counts differ.",
        "`battles_levels` lists EVERY step of `monthly_trend` where the modal arena changes or the mean starting trophies move by 200 or more under `player.population_changes[]` (`{from_month, to_month, arena_changed, from_arena, to_arena, from_trophies, to_trophies, trophy_delta}`; empty when the population held), and the note names all of them. It named the earliest step only and stayed quiet on a later arena crossing, the harder confound and the one #55 was filed for.",
        "`battles_decks` carries `excluded {duels, no_deck}`: a duel has no single deck and was silently outside `total_battles_in_window` and every `share_of_battles` (the docs listed the duel-excluding tools and left this one out). The identity `total_battles_in_window + excluded.duels + excluded.no_deck = battles_performance.battles` now holds over the same window, `total_battles_in_window` is summed over every deck-bearing battle rather than the first hundred decks, and a note says what sits outside the rows whenever the window held a duel.",
      ),
      "Additive; no migration.",
    ),
  },
  {
    version: "4.0.0",
    date: "2026-09-19",
    summary: md(
      "The batched major (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 5.3, Phase 6): the names and shapes the additive releases 3.14.0 to 3.18.0 doubled are settled to one, with no deprecation window (every client of this server is first-party and was updated in the same pass).",
      "Nothing new is served; every retired name has its replacement under breaking. The first call after reconnecting should re-fetch `tools/list`: `elixir_feedback` is `elixir_send_feedback`, and the six segment tools refuse a call without `segment`.",
    ),
    breaking: list(
      "`players_timeline.series[].date` removed (`day`, the same YYYY-MM-DD game day, 3.17.0).",
      "`battles_query.battles[].arena` is `{id, name}` (was the name string; `arena_id` folded in).",
      "`players_profile.snapshot.lifetime` carries the snake_case keys only (`battle_count`, `wins`, `losses`, `three_crown_wins`, `star_points`, `exp_points`, `collection_level`, ...); the camelCase twins `battleCount`, `bestTrophies`, `threeCrownWins`, `starPoints`, `expPoints`, `collectionLevel` are gone. One shape with `clans_roster` and `players_timeline`.",
      "`battles_performance` `group_by: 'mode'` removed (`game_mode` is the named game mode; `week` unchanged).",
      "`clans_standings.members[].trophy_net` removed (`net_trophies`, the name `battles_performance` uses).",
      "The series' `pol_league` metric (`players_timeline`, `clans_members_timeline`) is `league_number`, the battle row's name: the `metrics` argument accepts `league_number` and refuses `pol_league`, and the point carries `league_number` (the profile's `path_of_legend` object keeps the API's own `leagueNumber`).",
      "`clans_participation.weeks[].complete` removed (`partial`, true on the current week, the shape the weekly and monthly buckets use).",
      "`elixir_coverage.completeness_last_7_days.average_ratio` is a number (was a three-decimal string) and `incomplete_days` (always null) removed.",
      "`war_current.nominal_period_elapsed` removed (`period.started_at` and `day_ends_at` say the same).",
      "`game_events.events[].days_seen` removed (`game_days_seen`, 3.17.0).",
      "`clans_roster.members[].lifetime.as_of` removed (`profile_observed_at`, the same instant).",
      "`segment` is REQUIRED on `battles_meta_decks`, `battles_meta_cards`, `battles_trends`, `cards_synergy`, `badges_rarity` and `badges_holders`: a call without it is `bad_request` (class `input`) with a hint naming `'mine'`, `'corpus'` and the object; the omitted-segment note is gone with the default.",
      "`elixir_feedback` is `elixir_send_feedback` (the write-tool naming rule; `elixir_my_feedback` unchanged).",
    ),
  },
  {
    version: "3.18.0",
    date: "2026-09-19",
    summary: md(
      "The seam (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 3.2, 6 and 7, Phase 5).",
      list(
        "`elixir_timeline` takes `reader` (a short name for this consumer's read pointer): an omitted `from` reads since that reader's pointer, `mark_read` moves it, `read_to` reports it, and other readers on the account and the account's own unnamed pointer are untouched. `meta.timeline_pending` counts admissions since the OLDEST named pointer when any reader has marked, so a consumer that names itself sees it fall to 0 after its read.",
        "An empty timeline window is cheap: one probe off the battle `created_at` index says whether the clan learned a battle in the window before the day-wide member scans run.",
        "Every error body carries `class` (`retry` | `input` | `subject` | `server` | `budget`; `ERROR_CLASS` in the contracts package): `live_pending` and `query_timeout` are `retry`, `internal` and `live_unavailable` are `server`, `quota_exceeded` is `budget`, the rest `input` or `subject`.",
        "The subject tools take `display_name` beside `on_behalf_of`, and an unmapped id's `no_subject` carries `candidates[]` (the clan members whose whole name matches; `player_tag`, `name`, `clan_tag`, `role`) with a hint that names the one `elixir_identify` call.",
        "`elixir_feedback` takes `request_ids[]` beside `request_id`.",
        "`outputSchema` declared on `elixir_my_feedback`, `rankings_players`, `war_history`, `battles_meta_decks`, `battles_meta_cards`, `battles_levels` and `clans_participation` (`tools/list` and the tool reference render them; the registry validates against them).",
        "A person's omitted `clan_tag` is the primary player's clan and nothing else: when that clan is not recorded the call is `not_recorded` naming it, where it used to slide to an alt's recorded clan.",
      ),
      "Additive; migration 0136 adds `timeline_reader`.",
    ),
  },
  {
    version: "3.17.0",
    date: "2026-09-19",
    summary: md(
      "One grammar, one vocabulary (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 2, Phase 4).",
      list(
        "Every windowed tool's `applied.window` says its season: `season` (the season the window starts in; null on an unbounded window), `crosses` (every season roll inside it, empty when clean) and `season_age_days`, on `battles_query`, `battles_performance`, `battles_decks`, `battles_cards`, `battles_opponents`, `battles_compare`, `clans_standings`, `battles_levels`, `clans_pilot_scores`, `clans_participation`, `rankings_timeline`, `game_events` and `elixir_timeline`, as the meta and series tools already carried them. The crossing note fires only when `crosses` is non-empty.",
        "The player battle tools and `clans_standings` take `season` (`'current'`, `'previous'`, `2026-08` or `135`), so \"this season\" is one argument on every tool that has a window; their default is unchanged.",
        "The series tools (`players_timeline`, `clans_timeline`, `clans_members_timeline`) accept an instant for `from`/`to` and floor it to its game day (10:00Z grid), echoing the instant under `applied.window.floored` with a note, where they refused it; `days: N` is N game days, today included.",
        "The one point vocabulary: `players_timeline` points carry `day` beside `date`; `rankings_timeline` points carry `day` (the snapshot's game day); `battles_levels.monthly_trend` marks the window's clipped months with `partial: true` and `covers {from, to}`, the weekly shape; `clans_participation` echoes `applied.window.source: 'default'` when `weeks` was defaulted and its notes say `war_points` is the period points figure; `game_events` carries `game_days_seen` beside `days_seen` (the same sightings on the game day grid; `days_seen` retires at 4.0.0), its `running_on_latest_day` is a fact of the table rather than of the window, and a date-only `to` no longer reaches one day past itself; `clans_roster.lifetime` carries `profile_observed_at` beside `as_of` (`as_of` retires at 4.0.0).",
        "`clans_pilot_scores` and `battles_levels.monthly_trend` take `mean_starting_trophies` over ladder battles only (a Path of Legends figure is a league rating on another scale; null with none), and say so.",
        "`players_summary.top_deck` and `best_deck` carry `mean_level_gap`, so the comparability note names real gaps.",
        "Descriptions: `players_timeline.metrics` names its four groups and the default; `battles_performance.group_by` says `mode` is the named game mode, not the group; `clans_members_timeline.limit` says the order and how to choose; `rankings_players` says `rating` is the profile's `pol_trophies`, verified equal on the live API.",
      ),
      "Additive; no migration.",
    ),
  },
  {
    version: "3.16.0",
    date: "2026-09-19",
    summary: md(
      "The control next to every number (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 4, Phase 3): every tool that serves a rate, trend, rank or sum carries the control the 3.13.0 principle names, and a note fires only on a detected confound.",
      list(
        "`players_summary`: `last_30_days.modes` (the window's battles by mode group); `top_deck` and `best_deck` carry `modes` and `dominant_mode`; `trophy_floor` when the window holds ladder battles; the deck comparability note and the floor note.",
        "`clans_standings` members carry `modes`, `ladder_battles`, `mean_level_gap` and `level_gap_battles`, `log_recorded` and `recorded_since`; the response carries `comparable` (false when two ranked members' dominant modes differ or their gaps are half a level apart, the note naming them) and `basis` (`recorded` | `roster_and_war_only`). `trophy_net` reads null when `ladder_battles` is 0, where it read an ambiguous 0 before (a field the docs never defined as a sum-or-zero).",
        "`battles_trends` weeks carry `modes` (the week's battles by mode group) and, when the window clips a week, `partial: true` with `covers {from, to}` and a note; a pooled-modes note fires when `mode` was omitted and a week holds more than one group.",
        "`battles_meta_decks` and `battles_meta_cards` rows carry `modes` and `mean_level_gap` (deck rows `level_gap_battles` and `dominant_mode` too); the response carries `comparable`, `modes_in_window` when `mode` was omitted, the pooled-modes note, and on a segment read a note when every returned row is one player's.",
        "The three meta tools take `trophy_band` (`under_5000`, `5000_8000`, `8000_11000`, `11000_13000`, `13000_plus`: the observation's own player's starting trophies), answered from a banded season rollup once the nightly rebuild has filled it and from the raw rows with a note before; `cards_synergy`'s anchor carries `modes`.",
        "`clans_pilot_scores` members carry `mean_starting_trophies`, `modal_arena {id, name}` (the population they were scored in) and `current_arena`, with a note naming the members whose modal arena inside the window differs from their current one.",
        "`clans_participation` members carry `log_recorded`, `recorded_since`, `last_battle_time_in_clan` and `war_days_battled` (per war week, null without coverage); the response carries `basis` (`recorded` | `roster_and_war_only`) and the activity-scope note.",
        "`clans_timeline` gains the `members_with_profile` aggregate (the denominator of the profile-derived ones); `war_rivals` rows carry `colosseum_races` with a note when any; `rankings_timeline` notes when `rated_players` is 0 at every point (an empty field, not a flat one); `rankings_clans` carries `field_size` (the placed players the counts were taken over).",
        "The population is named (product call 5): on the six segment tools (`battles_meta_decks`, `battles_meta_cards`, `battles_trends`, `cards_synergy`, `badges_rarity`, `badges_holders`) `segment` also accepts the strings `'mine'` (the caller's clan; `no_subject` when there is none) and `'corpus'` (the whole recorded corpus, explicitly). The corpus is one population among the others, never a default: a read that omits `segment` still answers it, carries a note saying so (that note only), and a corpus read carries `population {recorded_clans, recorded_players, players_in_window}`. 4.0.0 makes `segment` required.",
      ),
      "Additive; migration 0135 adds the band tables and the level-gap columns, empty, filled nightly.",
    ),
  },
  {
    version: "3.15.1",
    date: "2026-09-19",
    summary: md(
      "Three things the Phase 2 acceptance read surfaced.",
      list(
        "`finish_time` on `war_current.standings[]`, the exact week's `war_history.standings[]` and `race_finished_at` is null for a clan that did not finish: the API marks those with epoch zero (`1969-12-31T23:59:59Z`) and the sentinel was served as a time.",
        "Each day's standings on `war_history.days[]` and `war_current.days_closed[]` carry `rank` (1-based, null while unranked) beside `end_of_day_rank` (the API's 0-based value, -1 unranked).",
        "The recorder now keeps a section's fourth war day, which is first reported in the next section's polls and was dropped: `days[]` carries four entries on a full week once the archive re-walk has run.",
      ),
      "Additive; the added field is `rank`.",
    ),
  },
  {
    version: "3.15.0",
    date: "2026-09-19",
    summary: md(
      "The record reaches the wire (docs/reviews/2026-09-19-INTERFACE-REVIEW.md Part 1.3, Phase 2): every collected column an agent would ask about is served on the tool that owns the question, no migration.",
      list(
        "`battles_query` rows carry `mode_group` (the contract's fold of `type`) and, at full verbosity, `context {event_tag, tournament_tag, ladder_tournament, hosted, deck_selection}` and on a `boatBattle` row `boat {side, towers_before, towers_after, remaining}`; compact carries `deck_selection` at the top level.",
        "`war_history` with `season_id` and `section_index` carries `days[]` (the race's own day-by-day from the API's `periodLogs`: per closed war day every clan's `points_earned`, `progress_start`, `progress_end`, `progress_earned`, `end_of_day_rank`, `defenses_remaining`, `progress_from_defenses`) and `standings[]` (every clan in the bracket with `clan_score` and `repair_points`); `weeks[]` carry `closed_at` (the API's own close instant) beside `finished`, plus `our_clan_score` and `our_repair_points`; `member_weeks[]` carry `repair_points`.",
        "`war_current` carries `days_closed[]` in the same shape (full verbosity), `clan_score` and `repair_points` on `standings[]`, `repair_points` per participant, and `period.api_period_type` (the API's own word for the day). `war_rivals` rows carry `clan_score`, latest observed.",
        "`players_profile.snapshot.path_of_legend.seasons[]` lists the last twelve season finals the record kept (`{season_month, league, trophies, rank}`, newest first); `players_profile.attributes` and `clans_roster.lifetime` carry `war_day_wins`, `clan_cards_collected` and `legacy_trophy_road_high_score`.",
        "`clans_roster` carries the clan's `type`, `location_id` and `description` at both verbosities; `clans_timeline`'s `metrics` enum gains `type` and `location_id` (asked for, never default).",
      ),
      "Additive.",
    ),
  },
  {
    version: "3.14.0",
    date: "2026-09-19",
    summary: md(
      "The fourteen verified defects of the interface review (docs/reviews/2026-09-19-INTERFACE-REVIEW.md), Phase 1.",
      list(
        "`war_history` with `season_id` and `section_index` answers the whole week's roster (up to 60 `member_weeks`) in one pass instead of timing out the Lambda; it is under the analytical query budget, and every read-only tool now races the Lambda's own deadline, so a call that would have died as a bare HTTP 500 answers `query_timeout` with `meta.request_id` and an audit row.",
        "`war_current.next_war_day_opens_at` (top level and in `period`) is the next war day to open after the current period on war days too, equal to `game_clock`'s at the same instant; it was null on every war day.",
        "`war_history.history_starts_at` is the oldest war week the record holds for the clan whatever window was asked for (it was the window's own oldest row).",
        "`battles_query` rows carry `arena_id` beside `arena` (the name; the docs said id), null on a row the 0131 backfill never reached.",
        "`clans_standings` ranked members carry `percentile` (`1 - (rank - 1) / ranked_members`, the formula the note always stated).",
        "`players_profile.snapshot.lifetime` carries the snake_case keys (`battle_count`, `three_crown_wins`, `star_points`, `exp_points`, `collection_level`) beside the camelCase ones with equal values: one lifetime shape with `clans_roster` and `players_timeline`; the camelCase set is retired at 4.0.0.",
        "A `live_pending` refusal carries `error.retry_after_s` as an integer beside the hint (a consumer regexed the seconds out of the English).",
        "`clans_timeline`'s `members_seen` note says the count includes members who left that day and can read above `members`.",
        "`meta.completeness_note` fires: on a player subject whose window ends inside the last seven days, when the newest profile interval (the two latest profile polls and the recorded battles between them) reads under 0.9, or is not comparable with more than 48 hours since the last profile poll; it names the counts and points at `elixir_coverage`. It was promised by the instructions and the docs and set by nothing.",
        "`rankings_timeline`'s description says one snapshot a day since the afternoon of 2026-09-11 (that day holds sixteen).",
        "Six descriptions over the 600-character convention (`elixir_timeline`, `players_timeline`, `clans_roster`, `war_current`, `clans_participation`, `battles_query`) are trimmed to what they are, their default, what compact drops and the one caveat; what moved is on the docs page each tool's docs pointer names, and the registry test now holds the line at 600.",
        "`elixir_coverage.completeness_last_7_days.average_ratio` is documented as the string it is (three decimals) until 4.0.0 makes it a number.",
      ),
      "Additive.",
    ),
  },
  {
    version: "3.13.0",
    date: "2026-09-18",
    summary: md(
      "Every aggregate ships the control next to the number (feedback #54, #55, #56, #58, #59, #60: six wrong conclusions from correct data in one agent session).",
      list(
        "`battles_decks` rows carry `modes` (battles, wins, losses per mode group), `dominant_mode` and `dominant_mode_share`, `mean_level_gap`, `own_mean_level`, `opponent_mean_level` and `level_gap_battles`; the response carries `comparable`, false when the rows were played in different modes or at level gaps half a level apart, and a note then names the rows that clash.",
        "`battles_cards` rows carry `modes` (a count per mode group) and `mean_level_gap`; the response carries `modes_in_window` (battles and mean level gap per mode group) and `comparable`, with a note when modes with different matchmaking were pooled.",
        "`battles_levels.monthly_trend` points carry `actual_win_rate`, `expected_from_levels`, `mean_gap`, `opponent_mean_level`, `mean_starting_trophies` and `modal_arena {id, name}`; a note fires when the modal arena or the mean starting trophies moved between two points; a new `arena_id` argument holds the pool fixed; `methodology.n` says what n counts (the scored player's battles, once) and `methodology.adjusts_for` says the score adjusts for card levels, never opponent skill.",
        "`battles_performance` carries `trophy_floor` (`floor`, `arena`, `source`, `floored`, `on_floor_losses`, `losses_landing_on_floor`, `ladder_battles`, `trophy_range`) when the window holds ladder battles and the arena's floor is known, with a note when a loss touched it; `group_by: week` rows a window clips carry `partial: true` and `covers {from, to}`, with a note naming them.",
        "`battles_query` full verbosity: `elixir_leaked` on every teammate and opponent, `elixir_leaked_differential` on `me` (me minus the one opponent, null on duels, 2v2 and unreported sides), a note that neither is a skill measure, and a note when ladder losses carry `trophy_change` null (a loss ON the arena's floor).",
        "`war_current` and `war_history` say `decks_used` is the race week's cumulative count and a duel consumes one deck per round played.",
        "New error code `internal` for a server failure (it was reported as `bad_request`); a `result_too_large` hint says which limit would have fit.",
        "`battles_opponents` with any window failed since 3.11.1 (a SQL alias) and answers again.",
      ),
      "Additive.",
    ),
  },
  {
    version: "3.12.0",
    date: "2026-09-18",
    tools_added: ["clans_timeline", "clans_members_timeline"],
    summary: md(
      "The daily series as readers (docs/reviews/2026-09-18-TIME-SERIES.md Part 7). Every daily series is keyed by the GAME day (10:00 UTC to 10:00 UTC, named for the date it starts on; docs: clocks#the-game-day), and every point carries its stamps: `observed_at`, `profile_observed_at` (null on a roster-only day), `roster_observed_at` (null when the roster never touched the row), `source` (`api` | `elixir-bot`) and `kind`.",
      list(
        "`players_timeline`: `metrics` grows to every column of the day row (`best_trophies`, `donations_received`, the lifetime block with `king_tower_level`, `total_donations` and the challenge and tournament counters, the Path of Legends standing, the seasonal trophies, `arena_id`, `clan_tag`, `clan_rank`, `previous_clan_rank`, `game_last_seen_at`); `kind`: `daily` | `pre_reset` | `season_roll`; `progress_key` (a `Player.progress` key or `'all'`) adds `progress[]`; `applied.window` carries the season fields; `docs` points at recording#daily-series.",
        "NEW TOOL `clans_timeline`: a clan's day series (`clan_score`, `clan_war_trophies`, `members`, `donations_per_week`, `required_trophies`) with the aggregates over that day's member rows (`total_member_trophies`, `avg_member_trophies`, `members_seen`) and, on request, the profile-derived ones (`avg_member_wins`, `avg_member_collection_level`, `members_12000_plus`, `members_14000_plus`, `members_6_years_plus`, `members_collection_1000_plus`); `series_available_from`; verbosity compact keeps the five clan metrics.",
        "NEW TOOL `clans_members_timeline`: every member the roster placed in the clan in the window (or `player_tags`, up to 50), one point per game day with the roster's metrics and any profile metric; `limit` on members with a maximum of 50; verbosity compact keeps each member's first and last point and the delta.",
        "`clans_roster` full verbosity gains per member `years_played`, `account_age_days`, `badge_count` and `lifetime {as_of, best_trophies, battle_count, wins, losses, three_crown_wins, collection_level, king_tower_level, total_donations}` from the latest profile poll, null for a member whose profile is not recorded.",
        "`rankings_timeline`'s description says what the record holds: one snapshot a day since 2026-09-11 and only when the board moved.",
        "`elixir_data_insights.players_with_snapshot` counts players with a profile snapshot.",
      ),
      "Additive.",
    ),
  },
  {
    version: "3.11.1",
    date: "2026-09-17",
    summary:
      "players_profile's output schema declares the shapes of snapshot.path_of_legend, league_statistics and lifetime with every key nullable (a key the API omitted is served as null since the objects render from typed columns), which moves the tools fingerprint in serverInfo.version. war_current and the clan timeline take the current river race period from the record's war calendar rather than the clan's last observed anchor: a stale or missing anchor no longer blanks the day; started_observed_at is null until the recorder has seen this period open, nominal_period_elapsed is always false, and decks_today_reason is period_unknown or training_day. Every window predicate reads the participant's own battle_time (identical results, the covering indexes). No field added or removed.",
  },
  {
    version: "3.11.0",
    date: "2026-09-17",
    summary:
      "battles_meta_decks, battles_meta_cards and cards_synergy answer a corpus-wide season read (the default window, or season) from the season's rollup instead of a scan of every battle: the same population and the same fields, with players_as_of (when the distinct-player counts were last rebuilt, nightly) and a note saying the counters are hourly. A deck or card first seen since the last rebuild carries players: null until the next one. Segment reads and explicit from/to windows are unchanged and exact to the instant. Additive.",
  },
  {
    version: "3.10.0",
    date: "2026-09-17",
    summary:
      "The season is a row and the meta tools read by it (docs/reviews/2026-09-16-SCHEMA-REVIEW.md 1.1). battles_meta_decks, battles_meta_cards and cards_synergy default to the CURRENT SEASON TO DATE (applied.window.source: 'season') instead of a rolling 28 days, which mixed two seasons on most days of the month; balance changes land on the season roll, so a season is the window that honours them. A season argument on those three and on battles_trends bounds one season: 'current', 'previous', the month the API names it by (2026-08) or the river race season number (135); from/to/days/weeks given still win. applied.window gains season {month, war, starts_at, ends_at} (the season the window starts in), crosses[] (every season roll inside the window, empty when clean) and season_age_days; a window across a roll carries a note saying so, and a thin new season names season:'previous' as the settled comparison rather than widening. battles_trends rows carry season_month. Balance changes and the in-game Pass season are not modelled. Additive.",
  },
  {
    version: "3.9.0",
    date: "2026-09-16",
    summary:
      "The timeline as a trigger for a clan bot (docs/reviews/2026-09-16-TIMELINE-FOR-PROACTIVE.md). elixir_timeline: a member's session that crosses a disclosed rung (5/10/20 wins in a row, 150/300/500 ladder trophies net, 20/40 battles in one sitting) is a session_standout item on the clan's timeline, at the crossing battle's instant, once per rung and never re-reported; the clan entry's standouts gain sessions (capped at five) and session_rungs. bracket_observed (section war) names a new war week's four rivals with recorded: true|false on the record's first sight of them; the week's start time stays the clock's. kinds filters items by kind. On badge_earned, legendary_badge_earned and card_unlocked items the badge's or card's name is facts.badge / facts.card and facts.name is the member (it was the badge's, so a clan timeline read 'Lava Hound unlocked Lava Hound'); badge_earned items appear only at a badge's final level or a multiple of five, the entry still counts every level-up; badge_earned payloads carry max_level. collection_level_step widens with the level (every 5 below 100, 50 to 1,000, 100 above) and carries step. clans_standings: trophy_net and current_streak per member. Additive, except facts.name on the three item kinds, which now means the member.",
  },
  {
    version: "3.8.0",
    date: "2026-09-15",
    summary:
      "elixir_my_feedback returns lossless bounded pages: pass next_offset as offset until null; total counts the filtered ledger. A page may contain fewer rows than limit when full feedback and maintainer text would exceed the delivery cap. Only responses actually delivered on that page are marked seen, so an oversized or limited read can no longer clear feedback_responses_pending for replies the caller did not receive. Additive.",
  },
  {
    version: "3.7.0",
    date: "2026-09-15",
    summary:
      "days and weeks are accepted on every windowed tool, as the server instructions have said since 1.0.0: battles_query, battles_performance, battles_cards, battles_decks, battles_meta_decks, battles_meta_cards, battles_compare, battles_opponents, cards_synergy, elixir_timeline, rankings_timeline, game_events and players_timeline (there as N days of snapshots, today included) join the five that already took them. Sugar for from, ending now; from/to given win. Until now the other tools refused them with bad_request (a routine lost three battles_performance calls to it on 2026-09-15). Additive.",
  },
  {
    version: "3.6.0",
    date: "2026-09-15",
    summary:
      "elixir_timeline: ranked_promotion carries facts.promoted_by (the last win played in the league below - a ranked battle is stamped with the league it started in); best_trophies_band carries facts.band and facts.crossed_by (the Trophy Road win whose result first reached the band); career_wins_step carries facts.step and facts.crossed_by (the 1,000th win itself, only when the window's wins reconcile with the lifetime counter). One battle shape everywhere: battle_id, battle_time, type, opponent {player_tag, name, starting_trophies} or opponents[] for a team battle, crowns, crowns_against, trophy_change, trophies_after when carried; the arena moment's promoted_by gains type. Each such item's at is the battle's instant. Clan standouts.ranked_promotions gain over and score. Additive.",
  },
  {
    version: "3.5.0",
    date: "2026-09-15",
    summary:
      "elixir_timeline: arena_changed items carry facts.promoted_by when the record holds the crossing - the win whose result first reached the new arena's floor: opponent {player_tag, name, starting_trophies}, crowns, crowns_against, trophy_change, trophies_after, arena_floor - and the item's at is that battle's instant (timing exact) rather than the profile poll's. Absent means the record does not hold the crossing; never a guess. Clan standouts.arena_promotions gain over and score alongside arena. Additive; no other tool changes shape.",
  },
  {
    version: "3.4.2",
    date: "2026-09-15",
    summary:
      "elixir_timeline: an arena move is polled for as soon as the player's own Trophy Road battles vouch for it (a battle entered with at least the opponent's trophies, since a battle's arena is the higher side's), so arena_changed lands within the battle log's cadence instead of the profile's eight hours. Profile-derived moments (arena_changed, ranked_promotion, best_trophies_band, collection_level_step, career_wins_step, card_unlocked, badges) and donation_reset are now diffed against the latest snapshot observation and written once; they were re-emitted by every later poll the same day. No tool changes shape.",
  },
  {
    version: "3.4.1",
    date: "2026-09-15",
    summary:
      "battles_query renders each participant's deck from the recorded card rows: the same {cards:[{id, name, level, evolutionLevel?, starLevel?}], supportCards?} shape, or {rounds:[{cards}]} for a duel, with names from the catalog; the storage-only norm marker is gone. The stored deck JSON left the record with it. No other tool changes shape.",
  },
  {
    version: "3.4.0",
    date: "2026-09-15",
    summary:
      "Cards played are recorded as rows (deck, deck_card, battle_participant_card), so every card question is an indexed lookup instead of a scan of every deck's JSON. battles_query gains with_cards (several ids, all present in your deck); with_card and against_card use the same rows. battles_cards, battles_meta_cards and cards_synergy count from the rows with unchanged denominators; battles_decks, battles_meta_decks and players_summary render a deck's cards from its identity (ordered by card id, named from the catalog) rather than from one player's copy, so the cards list no longer carries per-battle levels or a norm marker. Card filters match the deck's cards, not the tower troop or a duel's separate rounds. An empty cards list has no deck_hash.",
  },
  {
    version: "3.3.0",
    date: "2026-09-15",
    summary:
      "game_events now carries first_sighting_day and its horizon note reads the table rather than a date in the code: the elixir-bot backfill placed sightings from 2026-06-13 before the daily reads that began 2026-09-11. Same backfill, no shape change elsewhere: POAP KINGS battles from January, snapshots from March 7, war weeks from season 129 with per-day attendance from March, and first_observed_in_clan from the clan's earliest recorded roster read (2026-03-12) instead of this record's start.",
  },
  {
    version: "3.2.1",
    date: "2026-09-14",
    summary:
      "Deck meta no longer aggregates every full deck JSON before applying the result limit. It keeps the latest qualifying observation's participant key per deck, then reads the returned decks through that primary key. Counts, unrounded rates, shrinkage, scope, and the latest-observation exemplar are unchanged; full-corpus reads retain the 18-second cancellable query budget.",
  },
  {
    version: "3.2.0",
    date: "2026-09-14",
    summary:
      "Heavy MCP reads (battles_meta_decks, battles_meta_cards and clans_standings) now share an 18-second query budget, shortened when Lambda has less time left. PostgreSQL cancels over-budget work and returns query_timeout with an executable retry and meta.request_id instead of losing the connection at Lambda's 25-second limit; failed calls remain audited. Corpus meta reuses its population scan for the same unrounded shrinkage prior, avoiding a redundant corpus pass without changing denominators. clans_roster not_recorded names the exact live:true retry and explains that it does not start an ongoing watch. clans_standings discovery explicitly names the one-call 24-hour member scan and the existing trophy/streak boundary.",
  },
  {
    version: "3.1.0",
    date: "2026-09-14",
    summary:
      "Mode-board discovery now works: rankings_players({board: 'mode', location: 'list'}) returns the recorded leaderboard ids, names and enabled state, and an unknown mode points back to that executable discovery call. elixir_changelog now delivers complete history in bounded pages: limit (1..20, default 20), offset and next_offset (null at the end), with total and the unchanged exclusive since filter. Follow next_offset with the same since to reach every release. The live-quota guide derives its tool names from the registry; timeline documentation distinguishes player notables from clan standouts and removes the retired feed retention promise.",
  },
  {
    version: "3.0.0",
    date: "2026-09-13",
    summary:
      "elixir_events is now elixir_timeline. The response carries the TIMELINE: items in order, each with an instant, a subject, a kind, a section, a sentence and its facts. Battles appear as sessions (a gap of 30 minutes breaks a session), never one by one; badges, arena and ranked moves, new bests and card unlocks are named from the ledger; joins, departures, role changes, the boat crossing the line and a week resolving are the clan's moments; quiet rungs crossed and returns are derived; your own account events ride beside them. The per-subject entries are unchanged in shape and gain sessions counts. mark_read replaces mark_seen and moves the read pointer to the window end; read_to reports the pointer after the call. meta.timeline_pending replaces meta.events_pending.",
    tools_added: ["elixir_timeline"],
    breaking:
      "elixir_events is removed; mark_seen is now mark_read; meta.events_pending is now meta.timeline_pending. The per-account event feed table and its cursor are gone from the record.",
  },
  {
    version: "2.0.0",
    date: "2026-09-13",
    summary:
      "elixir_events is an activity feed of ENTRIES, synthesized at read time: one per subject since your bookmark, each with a summary sentence a person can read, always-present sections (a player's battles, trophies, arena, ranked, collection, badges, clan, war, presence; a clan's activity, roster, war, presence, standouts, donations) and named notables. A person's subjects are the players they track and the clans they added; an agent's is its clan, with members inside the clan entry. Tracked players with nothing in the window are listed under quiet. from/to are instants (or local dates), next_cursor is the window end, mark_seen moves an instant bookmark, sections and verbosity trim the wire. meta.events_pending now counts subjects of yours with admissions since your bookmark. Facts with their windows, never advice, and nothing in the feed announces the time: schedule from game_clock.",
    tools_added: [],
    breaking:
      "The topic rows are gone: no events[], no topics argument, no integer event_id cursor, no coalesced {count} payloads, no war_day_open or clan_pulse rows. Read entries[] and quiet[] instead; a second consumer keeps its own from and passes mark_seen false, as before.",
  },
  {
    version: "1.10.0",
    date: "2026-09-13",
    summary:
      "Feed payloads now carry what the Events page always promised: member_role_changed has prev_role, new_role and direction (promoted | demoted), and member_left has the departing role. war_current and the clan pulse's decks_today gain race_finished_at (also top-level on war_current): once your boat has crossed the line, the lists still say who played today but no longer mean who owes the race anything. game_clock gains the next boundaries a routine needs to schedule itself: war_day_closes_at, next_war_day_opens_at, next_training_starts_at and week_ends_at. war_day_open is deprecated: it is a clock fact, and game_clock is where the clock lives; it keeps firing through the deprecation window.",
    tools_added: [],
  },
  {
    version: "1.9.0",
    date: "2026-09-12",
    summary:
      "NEW TOOL clans_participation: every open member's participation week by week in one call. Per member, columns aligned to the top-level weeks (ISO, 1 to 8, default 5, current week partial): battles, ranked_battles, donations (the weekly counter at week end, null with no snapshot); and columns aligned to the top-level war_weeks: war_decks, war_points, war_decks_by_day (war days 1-4, null where not polled) and war_battles_by_day; verbosity compact keeps war_decks only. Per member: joined_observed_at, tenure_known (false when present at the first roster poll), days_in_clan_observed, last_battle_time, days_since_battle. Per clan: recording_active_since and first_roster_observed_at. Facts and windows only; nothing here scores, ranks or judges.",
    tools_added: ["clans_participation"],
  },
  {
    version: "1.8.0",
    date: "2026-09-12",
    summary:
      "OAuth gains account:email and GET /oauth/userinfo, for web products in the Elixir family that sign a person in with Elixir. The scope is granted only to a client that names it: it is not part of the default grant, is never offered ticked on the consent page, cannot be widened into from a checkbox or from Account -> Connections, and is not advertised in a 401 challenge. userinfo answers { sub, email, email_verified: true, kind } for a live personal-door token holding it and nothing else. No tool changed; scopes_supported in both discovery documents now lists six.",
    tools_added: [],
  },
  {
    version: "1.7.1",
    date: "2026-09-11",
    summary:
      "Scoped battle intelligence now uses the participant-time index for player, clan and collection windows instead of filtering time only after joining back to battles. battles_meta_cards also derives its denominator from the same card expansion rather than scanning the scoped observations a second time. This fixes an observed burst where four concurrent clan/collection card-meta calls exhausted the MCP Lambda's 25-second limit. Response meta now includes events_pending: 0 and feedback_responses_pending: 0 when each queue is empty, restoring the EVERY-response promise made in 1.0.0 and letting scheduled consumers skip empty ledger reads.",
    tools_added: [],
  },
  {
    version: "1.7.0",
    date: "2026-09-11",
    summary:
      "live: true is asynchronous. It means: answer from a read of the game no older than the API's own cache (60 s for players, battle logs and boards; 120 s for clans and the river race) if one is in hand; otherwise queue one priority fetch and answer NOW from the record with live_status: { state: 'pending', retry_after_s } - call again after that and the fresh view is there. Nothing waits on a collector inside a call any more. A subject with no record at all answers live_pending (NEW error code) with the same retry_after_s. live_fetch, the raw path, answers live_pending until the payload is in hand. A queued live fetch is charged once, when it is minted; the fresh read and the follow-up calls are not. Every collector in the fleet picks up priority work - there is no live channel.",
    tools_added: [],
  },
  {
    version: "1.6.0",
    date: "2026-09-11",
    summary:
      "The card collection is recorded. players_collection reads a player's cards and tower troops from the record (levels on the 1-16 scale, counts, forms), not from a payload cache that went empty two hours after each profile poll - since 0071 it had answered cards: [] for most players most of the day. cards_catalog and cards_synergy read the same recorded catalog. TWO NEW FEED TOPICS on the player stream, coalesced like the badge topics: card_unlocked (a card the player did not have appeared) and card_leveled (a level went up); counts ticking toward the next level are recorded but never announced, and a player's first observed collection is silent. Collections fill as profiles are polled; nothing is backfilled.",
    tools_added: [],
  },
  {
    version: "1.5.0",
    date: "2026-09-11",
    summary:
      "The season finals were filed under the wrong season numbers, and eight were missing. 1.4.0 fetched a final by a bare number and took that number for the season game_clock counts (S136 = September 2026); it is the position in the API's own seasons list, eight higher - what was labelled S135 was the December 2025 final, and January through August 2026 were never fetched. Every held final is relabelled (S97..S135 became S89..S127), the missing eight are on the schedule, and the finals are fetched by the API's own name for a season from now on. NEW: rankings_players and rankings_clans with board pol_final accept season as that name too - the month the season started in, 2026-08 - beside the number; the snapshot block carries season_month so both spellings come back, and game_clock says season_month beside season_id. The three season namespaces, for the record: game_clock's number (S136 now), the in-game Pass number (Season 87, which the API does not know), and the API's YYYY-MM.",
  },
  {
    version: "1.4.0",
    date: "2026-09-11",
    summary:
      "Everything else the API forgets about a season. FINALS: rankings_players and rankings_clans take board: pol_final with a season id - every Path of Legends season's final standing at full depth (9,999 places) since S97, backfilled, and each season's final fetched the day after it rolls. GAME-MODE BOARDS: board: mode with the leaderboard id as location (Merge Tactics, Touchdown, 2v2 League...), enumerated from the API daily so a rotating board is followed, never named. CLAN LADDERS: rankings_clan_ladder reads the clans (clan score) and clanwars (clan war trophies) boards by location, 1,000 places, daily. MOVEMENT: rankings_timeline is a player's rank and rating, a clan's rated players and best rank, or the board's own floor, summit and field size at every snapshot across a window - the season story at hourly resolution. WHAT WAS ON: game_events is the in-game events the API listed as running, recorded daily with the days each was seen, since the API gives no dates. FIX: every board's freshness is now stamped on admission; from 0068's deploy until this one the boards were re-planned every fifteen minutes as starved (~1,500 fetches an hour), which this ends.",
    tools_added: ["rankings_clan_ladder", "rankings_timeline", "game_events"],
  },
  {
    version: "1.3.0",
    date: "2026-09-11",
    summary:
      "The leaderboards are recorded. rankings_players reads a board - the global Path of Legends board by default, any of the 262 locations by id or country code - as of the latest snapshot or any earlier instant (as_of), paged with limit and offset, verbosity compact for rank/tag/rating only. rankings_clans aggregates a board into the clans with the most rated players, ties broken by the clan's best-placed player, counted over everyone above the rating floor rather than a top-100 slice. The global board is recorded hourly and every location daily; live: true on either reads the game first and records what it read. A top-200 appearance on the global board now RECORDS the player at comprehensive scope until the next season roll plus three days (a new recording reason, 'ranked', beside claims, clan watches and collections). live_fetch on a rankings path now returns up to 1000 places instead of 100.",
    tools_added: ["rankings_players", "rankings_clans"],
  },
  {
    version: "1.2.0",
    date: "2026-09-10",
    summary:
      "Three player-reported gaps closed together. WAR CURRENT: standings add period_points, the current war day's score, beside fame, the cumulative boat score banked at the day close; the note says why fame can still be zero while members have points. WAR HISTORY: season_id plus section_index selects one exact week and returns every recorded participant in member_weeks, including player_tag, name, points, decks, boat attacks, war_days_battled and the actual war_days indices; player_tag can still focus one. COVERAGE: completeness_last_7_days adds unmeasured_tail_hours, the explicit age of the unbracketed tail after the latest profile snapshot. Directly tracked players' profile cadence is capped at eight hours even when dormant; clan-wide members nobody tracks directly keep the yield cadence.",
    tools_added: [],
  },
  {
    version: "1.1.0",
    date: "2026-09-10",
    summary:
      "elixir_feedback takes request_id: the meta.request_id of the call the feedback is about. Every response already carries one, and attaching it hands the maintainer the exact request, its arguments and its answer beside your words - the console has had a Report this call button for a while and an agent, which is the thing that actually SAW the answer go wrong, had no way to say which call it meant. context stays for naming a tool or a question; request_id is the call itself. A malformed id drops the attachment and keeps the report.",
    tools_added: [],
  },
  {
    version: "1.0.0",
    date: "2026-09-10",
    summary:
      "The 1.0 contract: one set of conventions across every tool, from the review of the whole surface (docs/REVIEW-2026-09-10). NAMES: elixir_add_player and elixir_add_clan are elixir_track_player and elixir_track_clan (the console's word; an 'add' tool that removed was the smell), with the same actions and no make_primary (relationship: 'primary' is the one spelling). collections_get and collections_edit take `collection`, the same name every segment tool uses. GROUPS: the Elixir MCP bucket is Account, Feed, Help and Service; elixir_coverage sits with Players. Titles carry the group, names are unchanged. WINDOWS: every windowed tool accepts from/to; days, weeks and seasons stay as sugar; every windowed response echoes `applied.window` with its bounds and whether they were given or defaulted, and battles_decks no longer returns all-time with no bounds echoed. `applied` is the one echo block (limit, sort, mode, min_battles, segment, verbosity) replacing filters_applied, window_from/window_to, window_days and limit_applied. SEGMENTS: battles_meta_decks, battles_meta_cards, battles_trends, cards_synergy, badges_rarity and badges_holders take a nested `segment: { player_tag | clan_tag | collection }`; omitted means the whole recorded corpus, which the flat arguments never said. SIZE: `verbosity: full | compact` is the one size control - on battles_query as before, and now on war_current (compact = standings, period, counts and the nudge lists as name + tag), clans_roster (replacing summary: true), battles_levels (replacing include_curve), players_collection and cards_catalog; cards_catalog also takes ids and query. LIVE: clans_roster and war_current take live: true for any clan, recorded or not, the way players_profile does; battles_query takes live: true to poll a player's battle log once before answering; live_fetch refuses /players/{tag}/battlelog before spending the lane, because a raw log cannot fit the delivery cap. TIMEZONE: every windowed tool takes an optional IANA timezone for that call. PROSE: every response's caveats are `notes: string[]`, one sentence each, with `docs: 'page#section'` pointing at the page that carries the formulas; methodology objects stay; the fifteen *_note keys are gone and the formula paragraphs live in the documentation, which the door serves. EVENTS: rows carry created_at, as every other timestamp does. ERRORS: two codes join the closed set - no_subject (nothing to answer about: no default player, an unmapped on_behalf_of, a clanless agent) and result_too_large (the request was fine; narrow the arguments) - so an agent stops having to read the message to know which. ENVELOPE: events_pending and feedback_responses_pending ride EVERY response, including elixir_events and game_clock. ANNOTATIONS: destructiveHint is true on the three tools with a removing action; elixir_events is read-only; the four tools with a live flag are open-world. SCOPES: a client that asks for no scope in particular is offered every capability, ticked, on the consent page. PROTOCOL: resources (the documentation, examples, changelog, updates and the card catalog as elixir:// URIs) and prompts (the eleven examples) are declared beside tools; every tool result also carries structuredContent, and the ten most-called tools declare an outputSchema.",
    tools_added: ["elixir_track_player", "elixir_track_clan"],
    breaking:
      "elixir_add_player -> elixir_track_player and elixir_add_clan -> elixir_track_clan (make_primary removed; use relationship: 'primary'). collections_get/collections_edit: slug -> collection. Segment tools: player_tag/clan_tag/collection move under a nested `segment` object. clans_roster: summary -> verbosity: 'compact'. battles_levels: include_curve: false -> verbosity: 'compact'. elixir_events rows: at -> created_at. Response keys: filters_applied, window_from, window_to, window_days, limit_applied -> applied; note, denominators_note, as_observed_note, member_note, deck_note, weekly_note, mode_note, scale_note, forms_note, range_note, card_legend -> notes[] (+ docs). Error code for a missing default subject: not_found -> no_subject; for an oversized result: bad_request -> result_too_large.",
  },
  {
    version: "0.43.0",
    date: "2026-09-10",
    summary:
      "The service documents itself over MCP. elixir_docs returns the documentation index (every page with its section and lede), one page as Markdown by slug, or the pages matching a query with an excerpt around the first hit; elixir_examples returns the eleven worked examples - the question somebody asks, the answer, what it reads, the tools it calls and how to set it up - as an index or one by slug; elixir_updates returns what shipped, newest first, optionally since a date. All three read the same sources the public site renders from, built into the door at deploy, so an agent asked how to use Elixir MCP answers from the same text a person reads at elixir.poapkings.com/docs. Read-only, cr:read, no account data.",
    tools_added: ["elixir_docs", "elixir_examples", "elixir_updates"],
  },
  {
    version: "0.42.0",
    date: "2026-09-09",
    summary:
      "The game's own lastSeen is captured and served instead of discarded. Clash Royale exposes it only inside a clan's memberList - /players/{tag} does not carry it - so it was obtainable on every roster poll and thrown away, and every un-stored poll was gone for good. players_profile now returns last_seen_in_game and clans_roster returns it per member, both null until a polled clan roster carried that player. Read it as when the PLAYER was last active, which is a different fact from last_recorded_battle (only moves when a battle was captured) and from this recorder's own poll times. It is also the predicate the game itself uses: verified against a live payload, the members missing from a clan's currentriverrace participants were exactly those whose lastSeen predated the race start, while joining late did not exclude anyone and neither did not battling - so a member absent from war_current.participants with a stale last_seen_in_game is dormant rather than dropped. Backfill is not possible; the column fills from the next roster poll onward.",
  },
  {
    version: "0.41.0",
    date: "2026-09-09",
    summary:
      "war_current reconciles the race roster against the clan roster: participants_count, member_count and members_not_in_race[] name the current members this week's race leaves out, each with reason not_in_race_roster. Verified against the live API rather than assumed - its own currentriverrace clan.participants returns the same shortfall, so participants was always faithful and the gap is upstream. The API gives no reason for the omission and neither does this, so nothing is invented; the finding is written up in the public Clash Royale API reference. Treat participants.length as the race roster, never as a member count.",
  },
  {
    version: "0.40.0",
    date: "2026-09-09",
    summary:
      "A round of agent playtesting, fixed together. ERRORS: every refusal now carries the same envelope a success does. A database the door cannot reach answers 503 with {error:{code,message,hint}} plus meta.request_id and Retry-After, instead of a bare Internal Server Error that escaped the handler entirely; the hourly rate limit answers 429 the same way with quota_exceeded, naming the ceiling that actually applied and sending Retry-After computed from the hour-aligned window. If you parsed the 429 body's error as a STRING, it is now an object like every other refusal. An opaque failure does not merely withhold information: in testing it manufactured confident wrong diagnoses, because a random failure pattern reads as a structural one. NUMBERS THAT MOVE: three_crown_rate counted a duel that summed three crowns across its rounds - possibly a LOSS - as a three-crown victory, and divided by every recorded battle. Numerator and denominator now both exclude duels and boat attacks, and head_to_head_battles is returned so the division can be checked. battles_performance also returns decided_wins and decided_losses, because denominators_note said win_rate = wins / decided_battles while the wins field includes boat wins - the rate was right and unverifiable. DECKS: battles_decks and battles_meta_decks render each card's evolution form and the deck's tower_troop, the discriminators deck_hash is actually built from, so two decks with identical-looking cards no longer differ by hash for no visible reason; battles_cards splits forms into separate rows as battles_meta_cards already did, so a card played in two forms returns two records and a form below the three-battle floor is dropped even when the merged card cleared it. WAR: war_current carries day_kind, war_day and next_war_day_opens_at beside season_id, mirroring game_clock, and decks_today is an explicit null with a decks_today_reason off a war day rather than an absent key - a training day returns a roster of zeroes otherwise shaped exactly like a clan that no-showed. war_history documents war_days_battled only when player_tag was supplied and it can actually return it. COVERAGE: elixir_coverage reports measured_span and measured_hours, so a completeness ratio of 1.000 over two days no longer reads as a fully captured week. IDENTITY: the clan named in your connection instructions is the PRIMARY player's, and any others are named too; on an account with players in two clans an omitted clan_tag now resolves to that same clan rather than an arbitrary one. ARGUMENTS: every window bound is described, including that a date-only to covers the whole named local day while an ISO instant is used as given. CAPABILITIES: the consent page lists every capability your client did not request as a checkbox you can tick, and Account -> Connections edits the capabilities of a live connection - personal, agent or integration - taking effect on its next call without a reconnect.",
    breaking:
      "The 429 rate-limit body's `error` changed from a bare string to the standard {code,message,hint} object. battles_cards returns one row per card FORM, so a card played as both base and Evolution now returns two rows. three_crown_rate changes value for anyone with recorded duels or boat battles.",
  },
  {
    version: "0.39.2",
    date: "2026-09-09",
    summary:
      "Arguments are validated against each tool's declared inputSchema before the handler runs: an unknown property, a wrong type, a value outside enum/minimum/maximum/length bounds, or a missing required argument is refused with bad_request naming the argument, never silently ignored or clamped (a limit above the declared maximum is now refused rather than reduced; limit_applied still echoes an in-range value). players_search treats %, _ and \\ in the query literally. The website's explorer bridge is metered like the MCP door (hourly rate limit, daily quota, result cap) and serves read-only tools.",
  },
  {
    version: "0.39.1",
    date: "2026-09-09",
    summary:
      "An agent's live fetches (live_fetch, players_profile live: true) are charged to its OWNER's daily live budget, matching how its tool calls were already charged, so every agent on one account shares one live allowance and meta.quota.live reads the same balance on each; previously each agent spent a live budget of its own. Roles gain a per-account agent count (member 3, leader 5, family 10, partner 25; admin and owner unlimited), enforced at creation with not_entitled and reason agent_limit. A refused OAuth access token at the MCP door now answers 401 with the WWW-Authenticate challenge instead of 500.",
  },
  {
    version: "0.39.0",
    date: "2026-09-09",
    summary:
      "Eleven feedback items from one agent session, shipped together because they share a shape: the corpus held the detail and exposed one grouping axis per tool. NEW AXES: battles_opponents groups a player's recorded battles by opponent (record, first/last met, modes, name where known, min_battles so 'who have I faced twice' is one call); badges_rarity and badges_holders make badges a queryable dimension across every recorded profile, one-off badges told apart from tiered ones; cards_synergy answers 'what is Witch played with' with co-occurrence, distinct players per pair and lift over the partner's baseline, forms merged for the anchor by default; players_names resolves up to 100 tags to names from the corpus and lists the misses so a live fetch is a choice. NAMES: opponents and teammates carry name_known; a backfill gap (June-July archive rows without opponent names) is repaired from the recorded history. QUOTA: meta.quota on every response - daily calls and live fetches used/max/remaining, reset instant, unlimited reads as null. SCOPE: elixir_events needs only cr:read; the insufficient-scope refusal now says how to grant a capability. SIZING: elixir_data_insights reports recorded players as direct/via_clans/total, clans by scope, which clans, and how many distinct players back profile and badge questions. STATISTICS: meta tools shrink toward the CORPUS mean over the same window (a player-scoped segment no longer shrinks toward itself), flag insufficient_sample below 30 decided observations and withhold shrunk rates there, exclude boat battles, and report an excluded breakdown (duels, boat, draws, unresolved). battles_performance exposes decided_battles and boat_battles and no longer counts boat attacks in win_rate; (game_mode, type) is documented as the mode key. DUELS: card_legend states that duel crowns sum across rounds and tower_hp describes the final round; duel rows carry rounds_played; a one-tower princess array is padded to fixed length 2 with 0 for the destroyed tower. FORMS: players_collection and cards_catalog decode evolutionLevel/maxEvolutionLevel into forms_unlocked/forms_available (a bit field, never progress); cards_catalog serves maxLevel on the in-game 1-16 scale with maxLevelRarityScale alongside. Additive throughout; win_rate in battles_performance changes only for players with recorded boat battles.",
    tools_added: [
      "battles_opponents",
      "badges_rarity",
      "badges_holders",
      "cards_synergy",
      "players_names",
    ],
  },
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
