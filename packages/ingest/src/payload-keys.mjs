/**
 * The field manifest (docs/ENGINEERING.md, "Ingest invariants": the shape
 * of every admitted payload is known, and a change is a work item;
 * time-series review 2.7, decided by Jamie 2026-09-17).
 *
 * One entry per field per endpoint, at the top level and inside each
 * array's elements, with its disposition: where it lands (`to`), what it
 * is derived from at read time (`derived`), or why it is dropped
 * (`dropped`). A field the API sends that has no entry here is a
 * finding; an entry with no disposition is a test failure. The census
 * of review Part 2 is the content; Appendix D the key sets.
 *
 * Paths: dots for keys, `[]` for an array's elements, `*` for a map's
 * keys (`progress.*.trophies`). A scalar array's elements are `x[]`.
 * `optional: true` marks a field the API sends only sometimes
 * (`finishTime` on an unfinished race, `boatBattleSide` outside boat
 * battles); the nightly census does not report its absence.
 *
 * This file is read by the fixture test (every fixture payload walked
 * against it) and by the nightly {shape_census} in the jobs Lambda; the
 * ingest path never reads it. Change it with the projection, the
 * contract bump, the docs and the cr-agent-api-docs entry, together.
 */

const to = (target, extra = {}) => ({ to: target, ...extra });
const derived = (from, extra = {}) => ({ derived: from, ...extra });
const dropped = (reason, extra = {}) => ({ dropped: reason, ...extra });
const opt = { optional: true };

const RETIRED_EXP_LEVEL =
  "retired in-game in 2026 (cr-agent-api-docs/players.md); reads 0 on every roster member and a frozen number on the profile; not recorded by decision";
const CLAN_CHEST =
  "clan chests no longer exist in-game (cr-agent-api-docs/clans.md); the fields are vestigial and constant";
const CARD_CATALOG =
  "the card catalog (card) carries it; a card's label never varies per holder";

/** A card as it appears on a player or in a battle: id, level and form
 *  are the fact; the catalog fields ride along and are the catalog's.
 *  `within` marks every field optional when the list itself is
 *  conditional (a duel's rounds): the census expects a field in every
 *  sampled payload, and twenty battle logs a night rarely hold a duel
 *  (Close the Loop, feedback 350-361: "absent for 7 days" while duels
 *  recorded 2026-09-25 carried every field). */
function cardFields(
  prefix,
  target,
  { count = false, played = false, within = false } = {},
) {
  const fields = {
    [`${prefix}.id`]: to(`${target}.card_id`),
    [`${prefix}.level`]: to(`${target}.level`),
    [`${prefix}.starLevel`]: to(`${target}.star_level`, opt),
    [`${prefix}.evolutionLevel`]: to(`${target}.evolution_level`, opt),
    [`${prefix}.name`]: derived(CARD_CATALOG),
    [`${prefix}.rarity`]: derived(CARD_CATALOG),
    [`${prefix}.maxLevel`]: derived(CARD_CATALOG),
    [`${prefix}.maxEvolutionLevel`]: derived(CARD_CATALOG, opt),
    [`${prefix}.elixirCost`]: derived(CARD_CATALOG, opt),
    [`${prefix}.iconUrls.medium`]: derived(CARD_CATALOG),
    [`${prefix}.iconUrls.evolutionMedium`]: derived(CARD_CATALOG, opt),
    [`${prefix}.iconUrls.heroMedium`]: derived(CARD_CATALOG, opt),
    ...(count ? { [`${prefix}.count`]: to(`${target}.count`) } : {}),
    ...(played
      ? {
          [`${prefix}.used`]: to("battle_participant_card.used", opt),
        }
      : {}),
  };
  if (!within) return fields;
  return Object.fromEntries(
    Object.entries(fields).map(([k, d]) => [k, { ...d, optional: true }]),
  );
}

/** A battle participant, on either side. */
function participant(side) {
  const p = `[].${side}[]`;
  return {
    [`${p}.tag`]: to("battle_participant.player_tag"),
    [`${p}.name`]: to("player.name"),
    [`${p}.startingTrophies`]: to("battle_participant.starting_trophies", opt),
    [`${p}.trophyChange`]: to("battle_participant.trophy_change", opt),
    [`${p}.crowns`]: to("battle_participant.crowns"),
    [`${p}.kingTowerHitPoints`]: to("battle_participant.king_tower_hp", opt),
    [`${p}.princessTowersHitPoints[]`]: to(
      "battle_participant.princess_tower_hp_1 / princess_tower_hp_2",
      opt,
    ),
    [`${p}.princessTowersHitPoints`]: to(
      "battle_participant.princess_tower_hp_1 / princess_tower_hp_2 (null, not [], once both towers are down)",
      opt,
    ),
    [`${p}.elixirLeaked`]: to("battle_participant.elixir_leaked", opt),
    [`${p}.globalRank`]: to("battle_participant.global_rank", opt),
    [`${p}.clan.tag`]: to("battle_participant.clan_tag", opt),
    [`${p}.clan.name`]: derived(
      "the clan row when it exists, a label otherwise",
      opt,
    ),
    [`${p}.clan.badgeId`]: derived("the clan row when it exists", opt),
    ...cardFields(`${p}.cards[]`, "battle_participant_card"),
    ...cardFields(`${p}.supportCards[]`, "battle_participant_card"),
    ...cardFields(`${p}.rounds[].cards[]`, "battle_participant_card (round)", {
      played: true,
      within: true,
    }),
    [`${p}.rounds[].crowns`]: to("battle_participant_round.crowns", opt),
    [`${p}.rounds[].kingTowerHitPoints`]: to(
      "battle_participant_round.king_tower_hp",
      opt,
    ),
    [`${p}.rounds[].princessTowersHitPoints[]`]: to(
      "battle_participant_round.princess_tower_hp_1 / princess_tower_hp_2",
      opt,
    ),
    [`${p}.rounds[].elixirLeaked`]: to(
      "battle_participant_round.elixir_leaked",
      opt,
    ),
  };
}

export const PAYLOAD_KEYS = {
  player: {
    tag: to("player.player_tag"),
    name: to("player.name"),
    expLevel: dropped(RETIRED_EXP_LEVEL),
    trophies: to("player_snapshot_daily.trophies"),
    bestTrophies: to("player_snapshot_daily.best_trophies"),
    wins: to("player_snapshot_daily.wins"),
    losses: to("player_snapshot_daily.losses"),
    battleCount: to("player_snapshot_daily.battle_count"),
    threeCrownWins: to("player_snapshot_daily.three_crown_wins"),
    challengeCardsWon: to("player_snapshot_daily.challenge_cards_won"),
    challengeMaxWins: to("player_snapshot_daily.challenge_max_wins"),
    tournamentCardsWon: to("player_snapshot_daily.tournament_cards_won"),
    tournamentBattleCount: to("player_snapshot_daily.tournament_battle_count"),
    role: to("player.last_known_clan_role"),
    donations: to("player_snapshot_daily.donations"),
    donationsReceived: to("player_snapshot_daily.donations_received"),
    totalDonations: to("player_snapshot_daily.total_donations"),
    warDayWins: to("player.war_day_wins"),
    clanCardsCollected: to("player.clan_cards_collected"),
    "clan.tag": to("player.last_known_clan_tag", opt),
    "clan.name": to("clan.name", opt),
    "clan.badgeId": to("clan.badge_id", opt),
    "arena.id": to("player_snapshot_daily.arena_id"),
    "arena.name": to("arena.name"),
    "arena.rawName": dropped(
      "the season namespace rides in it; a text column on arena is Tier 2 (time-series review 2.1)",
    ),
    "leagueStatistics.currentSeason.trophies": to(
      "player_snapshot_daily.season_trophies",
      opt,
    ),
    "leagueStatistics.currentSeason.bestTrophies": to(
      "player_snapshot_daily.season_best_trophies",
      opt,
    ),
    "leagueStatistics.previousSeason.id": to(
      "player_snapshot_daily.prev_season_month",
      opt,
    ),
    "leagueStatistics.previousSeason.rank": to(
      "player_snapshot_daily.prev_season_rank",
      opt,
    ),
    "leagueStatistics.previousSeason.trophies": to(
      "player_snapshot_daily.prev_season_trophies",
      opt,
    ),
    "leagueStatistics.previousSeason.bestTrophies": to(
      "player_snapshot_daily.prev_season_best_trophies",
      opt,
    ),
    "leagueStatistics.bestSeason.id": to(
      "player_snapshot_daily.best_season_month",
      opt,
    ),
    "leagueStatistics.bestSeason.trophies": to(
      "player_snapshot_daily.best_season_trophies",
      opt,
    ),
    "leagueStatistics.bestSeason.rank": to(
      "player_snapshot_daily.best_season_rank",
      opt,
    ),
    "badges[].name": to("player_badge.name"),
    "badges[].level": to("player_badge.level", opt),
    "badges[].maxLevel": to("player_badge.max_level", opt),
    "badges[].progress": to("player_badge.progress", opt),
    "badges[].target": to("player_badge.target", opt),
    "badges[].iconUrls.large": dropped(
      "a badge catalog row per name is Tier 2 (time-series review 2.1)",
    ),
    "achievements[].name": dropped(
      "twelve fixed rows per player; player_achievement is Tier 2 (time-series review 2.1)",
    ),
    "achievements[].stars": dropped("Tier 2, with achievements[].name"),
    "achievements[].value": dropped("Tier 2, with achievements[].name"),
    "achievements[].target": dropped("Tier 2, with achievements[].name"),
    "achievements[].info": dropped("Tier 2, with achievements[].name"),
    "achievements[].completionInfo": dropped(
      "Tier 2, with achievements[].name",
      opt,
    ),
    ...cardFields("cards[]", "player_card", { count: true }),
    ...cardFields("supportCards[]", "player_card", { count: true }),
    "currentDeck[].id": dropped(
      "client-synced and useless for Verify (0094, docs/NOTES.md 2026-09-12); the deck a player PLAYS is the battle's",
    ),
    "currentDeck[].name": dropped("with currentDeck[].id"),
    "currentDeck[].level": dropped("with currentDeck[].id"),
    "currentDeck[].starLevel": dropped("with currentDeck[].id", opt),
    "currentDeck[].evolutionLevel": dropped("with currentDeck[].id", opt),
    "currentDeck[].maxLevel": dropped("with currentDeck[].id"),
    "currentDeck[].maxEvolutionLevel": dropped("with currentDeck[].id", opt),
    "currentDeck[].rarity": dropped("with currentDeck[].id"),
    "currentDeck[].count": dropped("with currentDeck[].id"),
    "currentDeck[].elixirCost": dropped("with currentDeck[].id", opt),
    "currentDeck[].iconUrls.medium": dropped("with currentDeck[].id"),
    "currentDeck[].iconUrls.evolutionMedium": dropped(
      "with currentDeck[].id",
      opt,
    ),
    "currentDeck[].iconUrls.heroMedium": dropped("with currentDeck[].id", opt),
    "currentDeckSupportCards[].id": dropped("with currentDeck[].id"),
    "currentDeckSupportCards[].name": dropped("with currentDeck[].id"),
    "currentDeckSupportCards[].level": dropped("with currentDeck[].id"),
    "currentDeckSupportCards[].maxLevel": dropped("with currentDeck[].id"),
    "currentDeckSupportCards[].rarity": dropped("with currentDeck[].id"),
    "currentDeckSupportCards[].count": dropped("with currentDeck[].id"),
    "currentDeckSupportCards[].iconUrls.medium": dropped(
      "with currentDeck[].id",
    ),
    "currentFavouriteCard.id": to(
      "player_snapshot_daily.favorite_card_id",
      opt,
    ),
    "currentFavouriteCard.name": derived(CARD_CATALOG, opt),
    "currentFavouriteCard.maxLevel": derived(CARD_CATALOG, opt),
    "currentFavouriteCard.maxEvolutionLevel": derived(CARD_CATALOG, opt),
    "currentFavouriteCard.elixirCost": derived(CARD_CATALOG, opt),
    "currentFavouriteCard.rarity": derived(CARD_CATALOG, opt),
    "currentFavouriteCard.iconUrls.medium": derived(CARD_CATALOG, opt),
    "currentFavouriteCard.iconUrls.evolutionMedium": derived(CARD_CATALOG, opt),
    "currentFavouriteCard.iconUrls.heroMedium": derived(CARD_CATALOG, opt),
    starPoints: to("player_snapshot_daily.star_points"),
    expPoints: to("player_snapshot_daily.exp_points"),
    totalExpPoints: dropped(
      "the retired progression's lifetime total, frozen with expLevel; state to write once if a reader ever asks (time-series review 1.3)",
    ),
    legacyTrophyRoadHighScore: to("player.legacy_trophy_road_high_score", opt),
    kingTowerLevel: to("player_snapshot_daily.king_tower_level"),
    currentWinLoseStreak: dropped(
      "intraday and derivable: the battle record answers a streak exactly (time-series review 2.1)",
    ),
    // The three season-result objects are always present and null for a
    // player with no Path of Legends history (cr-agent-api-docs
    // players.md; the nightly census met one in twenty on 2026-09-20,
    // feedback #67-#69). The bare path is the null: the projector reads
    // the children through ?. and writes the columns null, and
    // projectPolSeason writes no row.
    currentPathOfLegendSeasonResult: to(
      "player_snapshot_daily.pol_league / pol_trophies / pol_rank (null when the player has no Path of Legends history: the three columns stay null)",
      opt,
    ),
    lastPathOfLegendSeasonResult: to(
      "player_pol_season (null when the player has no Path of Legends history: no row is written)",
      opt,
    ),
    bestPathOfLegendSeasonResult: to(
      "player_snapshot_daily.pol_best_league / pol_best_trophies / pol_best_rank (null when the player has no Path of Legends history: the three columns stay null)",
      opt,
    ),
    "currentPathOfLegendSeasonResult.leagueNumber": to(
      "player_snapshot_daily.pol_league",
      opt,
    ),
    "currentPathOfLegendSeasonResult.trophies": to(
      "player_snapshot_daily.pol_trophies",
      opt,
    ),
    "currentPathOfLegendSeasonResult.rank": to(
      "player_snapshot_daily.pol_rank",
      opt,
    ),
    "lastPathOfLegendSeasonResult.leagueNumber": to(
      "player_pol_season.league",
      opt,
    ),
    "lastPathOfLegendSeasonResult.trophies": to(
      "player_pol_season.trophies",
      opt,
    ),
    "lastPathOfLegendSeasonResult.rank": to("player_pol_season.rank", opt),
    "bestPathOfLegendSeasonResult.leagueNumber": to(
      "player_snapshot_daily.pol_best_league",
      opt,
    ),
    "bestPathOfLegendSeasonResult.trophies": to(
      "player_snapshot_daily.pol_best_trophies",
      opt,
    ),
    "bestPathOfLegendSeasonResult.rank": to(
      "player_snapshot_daily.pol_best_rank",
      opt,
    ),
    "progress.*.trophies": to(
      "player_progress_daily.trophies (mode_season keys the bucket)",
    ),
    "progress.*.bestTrophies": to("player_progress_daily.best_trophies"),
    "progress.*.arena.id": to("player_progress_daily.arena_id"),
    "progress.*.arena.name": to(
      "arena.name (the roster and the profile feed the catalog)",
    ),
    "progress.*.arena.rawName": dropped("with arena.rawName"),
    collectionLevel: to("player_snapshot_daily.collection_level"),
  },

  clan: {
    tag: to("clan.clan_tag"),
    name: to("clan.name"),
    type: to("clan.type; clan_snapshot_daily.type"),
    description: to("clan.description"),
    badgeId: to("clan.badge_id"),
    clanScore: to("clan_snapshot_daily.clan_score"),
    clanWarTrophies: to("clan_snapshot_daily.clan_war_trophies"),
    "location.id": to("clan.location_id; clan_snapshot_daily.location_id"),
    "location.name": derived(
      "ranking_board carries the label per location key; a location catalog is Tier 3 (time-series review 2.2)",
    ),
    "location.isCountry": derived("with location.name"),
    "location.countryCode": derived("with location.name", opt),
    requiredTrophies: to("clan_snapshot_daily.required_trophies"),
    donationsPerWeek: to("clan_snapshot_daily.donations_per_week"),
    clanChestStatus: dropped(CLAN_CHEST),
    clanChestLevel: dropped(CLAN_CHEST),
    clanChestMaxLevel: dropped(CLAN_CHEST),
    members: derived(
      "equals memberList.length by admission (admission.mjs cross-checks it); clan_snapshot_daily.members is written from it",
    ),
    "memberList[].tag": to("clan_membership.player_tag; player.player_tag"),
    "memberList[].name": to("player.name"),
    "memberList[].role": to("clan_membership.role"),
    "memberList[].lastSeen": to(
      "player.game_last_seen_at (latest); player_snapshot_daily.game_last_seen_at (the day's series)",
    ),
    "memberList[].expLevel": dropped(RETIRED_EXP_LEVEL),
    "memberList[].trophies": to("player_snapshot_daily.trophies"),
    "memberList[].arena.id": to("player_snapshot_daily.arena_id"),
    "memberList[].arena.name": to("arena.name"),
    "memberList[].arena.rawName": dropped("with the profile's arena.rawName"),
    "memberList[].clanRank": to("player_snapshot_daily.clan_rank"),
    "memberList[].previousClanRank": to(
      "player_snapshot_daily.previous_clan_rank",
    ),
    "memberList[].donations": to("player_snapshot_daily.donations"),
    "memberList[].donationsReceived": to(
      "player_snapshot_daily.donations_received",
    ),
    "memberList[].clanChestPoints": dropped(CLAN_CHEST),
  },

  currentriverrace: {
    state: dropped("always 'full' (cr-agent-api-docs/models/river-race.md)"),
    periodIndex: to("war_period_anchor.period_index"),
    periodType: to("poll_state.period_type"),
    sectionIndex: to("war_week.section_index (with the inferred season)"),
    "clan.tag": to("war_week.clan_tag"),
    "clan.name": to("war_week_clan.participant_name"),
    "clan.badgeId": to("clan.badge_id"),
    "clan.fame": to("war_week_clan.fame"),
    "clan.repairPoints": to("war_week_clan.repair_points"),
    "clan.periodPoints": to("war_week_clan.period_points"),
    "clan.clanScore": to(
      "war_week_clan.clan_score (WAR trophies on a race payload, not the profile's clan score; see locations.md for the same overload on the war board)",
    ),
    "clan.finishTime": to("war_week_clan.finish_time", opt),
    "clan.participants[].tag": to("war_participation.player_tag"),
    "clan.participants[].name": to("player.name"),
    "clan.participants[].fame": to("war_participation.points"),
    "clan.participants[].repairPoints": to("war_participation.repair_points"),
    "clan.participants[].boatAttacks": to("war_participation.boat_attacks"),
    "clan.participants[].decksUsed": to("war_participation.decks_used"),
    "clan.participants[].decksUsedToday": to(
      "war_attendance_day.decks_used_today (every day of the race week, day_in_section 0-6)",
    ),
    "clans[].tag": to("war_week_clan.participant_clan_tag"),
    "clans[].name": to("war_week_clan.participant_name"),
    "clans[].badgeId": to("clan.badge_id (the rival's row)"),
    "clans[].fame": to("war_week_clan.fame"),
    "clans[].repairPoints": to("war_week_clan.repair_points"),
    "clans[].periodPoints": to("war_week_clan.period_points"),
    "clans[].clanScore": to(
      "war_week_clan.clan_score (war trophies, as above)",
    ),
    "clans[].finishTime": to("war_week_clan.finish_time", opt),
    "clans[].participants[].tag": derived(
      "the rivals' members: the observing clan's own participants are the same array under clan.participants; rivals' participation is not recorded (multi-tenant: a rival that is itself recorded has its own week)",
    ),
    "clans[].participants[].name": derived("with clans[].participants[].tag"),
    "clans[].participants[].fame": derived("with clans[].participants[].tag"),
    "clans[].participants[].repairPoints": derived(
      "with clans[].participants[].tag",
    ),
    "clans[].participants[].boatAttacks": derived(
      "with clans[].participants[].tag",
    ),
    "clans[].participants[].decksUsed": derived(
      "with clans[].participants[].tag",
    ),
    "clans[].participants[].decksUsedToday": derived(
      "with clans[].participants[].tag",
    ),
    "periodLogs[].periodIndex": to(
      "war_period_log.period_index (this section's entries only)",
    ),
    "periodLogs[].items[].clan.tag": to("war_period_log.participant_clan_tag"),
    "periodLogs[].items[].pointsEarned": to("war_period_log.points_earned"),
    "periodLogs[].items[].progressStartOfDay": to(
      "war_period_log.progress_start",
    ),
    "periodLogs[].items[].progressEndOfDay": to("war_period_log.progress_end"),
    "periodLogs[].items[].progressEarned": to("war_period_log.progress_earned"),
    "periodLogs[].items[].endOfDayRank": to("war_period_log.end_of_day_rank"),
    "periodLogs[].items[].numOfDefensesRemaining": to(
      "war_period_log.defenses_remaining",
    ),
    "periodLogs[].items[].progressEarnedFromDefenses": to(
      "war_period_log.progress_from_defenses",
    ),
    collectionEndTime: dropped(
      "not observed live; documented from older captures (cr-agent-api-docs/clans.md)",
      opt,
    ),
    warEndTime: dropped(
      "not observed live; documented from older captures",
      opt,
    ),
  },

  riverracelog: {
    "items[].seasonId": to("war_week.season_id"),
    "items[].sectionIndex": to("war_week.section_index"),
    "items[].createdDate": to("war_week.closed_at"),
    "items[].standings[].rank": to("war_week_clan.rank"),
    "items[].standings[].trophyChange": to("war_week_clan.trophy_change"),
    "items[].standings[].clan.tag": to("war_week_clan.participant_clan_tag"),
    "items[].standings[].clan.name": to("war_week_clan.participant_name"),
    "items[].standings[].clan.badgeId": to("clan.badge_id"),
    "items[].standings[].clan.fame": to("war_week_clan.fame"),
    "items[].standings[].clan.repairPoints": to("war_week_clan.repair_points"),
    "items[].standings[].clan.periodPoints": dropped(
      "always 0 in a closed log; the live race's period_points is the record",
    ),
    "items[].standings[].clan.clanScore": to(
      "war_week_clan.clan_score (fills a null)",
    ),
    "items[].standings[].clan.finishTime": to("war_week_clan.finish_time", opt),
    "items[].standings[].clan.participants[].tag": to(
      "war_participation.player_tag (the observing clan's own)",
    ),
    "items[].standings[].clan.participants[].name": to("player.name"),
    "items[].standings[].clan.participants[].fame": to(
      "war_participation.points",
    ),
    "items[].standings[].clan.participants[].repairPoints": to(
      "war_participation.repair_points",
    ),
    "items[].standings[].clan.participants[].boatAttacks": to(
      "war_participation.boat_attacks",
    ),
    "items[].standings[].clan.participants[].decksUsed": to(
      "war_participation.decks_used",
    ),
    "items[].standings[].clan.participants[].decksUsedToday": to(
      "war_attendance_day.decks_used_today (war day 4, day_in_section 6)",
    ),
    "paging.cursors.after": derived(
      "the log poll takes the API's default page; truncation is not a fact of the race",
      opt,
    ),
    "paging.cursors.before": derived("with paging.cursors.after", opt),
  },

  player_battlelog: {
    "[].type": to("battle.type"),
    "[].battleTime": to("battle.battle_time"),
    "[].arena.id": to(
      "battle.arena_id (filled by the Phase 2 op for older rows)",
    ),
    "[].arena.name": to("battle.arena"),
    "[].arena.rawName": dropped("with the profile's arena.rawName", opt),
    "[].gameMode.id": to("battle.game_mode_id"),
    "[].gameMode.name": to("battle.game_mode_name"),
    "[].leagueNumber": to("battle.league_number", opt),
    "[].deckSelection": to("battle.deck_selection"),
    "[].eventTag": to("battle.event_tag", opt),
    "[].tournamentTag": to("battle.tournament_tag", opt),
    "[].isLadderTournament": to("battle.is_ladder_tournament"),
    "[].isHostedMatch": to("battle.is_hosted_match"),
    "[].boatBattleSide": to("battle.boat_battle_side", opt),
    "[].boatBattleWon": derived(
      "battle_participant.outcome (lossless for it)",
      opt,
    ),
    "[].newTowersDestroyed": to("battle.new_towers_destroyed", opt),
    "[].prevTowersDestroyed": to("battle.prev_towers_destroyed", opt),
    "[].remainingTowers": to("battle.remaining_towers", opt),
    "[].modifiers[].tag": dropped(
      "0112: CHAOS modifiers had no reader; the column was dead",
      opt,
    ),
    "[].modifiers[].modifiers[]": dropped("with modifiers[].tag", opt),
    "[].challengeWinCountBefore": dropped(
      "official-only; never observed live (Appendix D)",
      opt,
    ),
    "[].challengeId": dropped("official-only; never observed live", opt),
    "[].challengeTitle": dropped("official-only; never observed live", opt),
    ...participant("team"),
    ...participant("opponent"),
  },

  cards: {
    "items[].id": to("card.card_id"),
    "items[].name": to("card.name"),
    "items[].rarity": to("card.rarity"),
    "items[].maxLevel": to("card.max_level"),
    "items[].maxEvolutionLevel": to("card.max_evolution_level", opt),
    "items[].elixirCost": to("card.elixir_cost", opt),
    "items[].iconUrls.medium": to("card.icon_medium"),
    "items[].iconUrls.evolutionMedium": to("card.icon_evolution_medium", opt),
    "items[].iconUrls.heroMedium": to("card.icon_hero_medium", opt),
    "supportItems[].id": to("card.card_id"),
    "supportItems[].name": to("card.name"),
    "supportItems[].rarity": to("card.rarity"),
    "supportItems[].maxLevel": to("card.max_level"),
    "supportItems[].iconUrls.medium": to("card.icon_medium"),
  },

  // The boards: one shape for the player boards (Appendix D).
  rankings_players: {
    "items[].tag": to("ranking_entry.player_tag"),
    "items[].name": to("ranking_entry.name"),
    "items[].rank": to("ranking_entry.rank"),
    "items[].trophies": to("ranking_entry.rating"),
    "items[].expLevel": dropped(RETIRED_EXP_LEVEL),
    "items[].arena.id": dropped(
      "the arena of a board entry is implied by its trophies; not recorded",
      opt,
    ),
    "items[].arena.name": dropped("with items[].arena.id", opt),
    "items[].clan.tag": to("ranking_entry.clan_tag", opt),
    "items[].clan.name": to("ranking_entry.clan_name", opt),
    "items[].clan.badgeId": derived(
      "a label on a board entry; no clan row is created for player boards (review 1.3)",
      opt,
    ),
    "paging.cursors.after": to("ranking_snapshot.truncated", opt),
    "paging.cursors.before": derived("with paging.cursors.after", opt),
  },
  rankings_pol: {
    "items[].tag": to("ranking_entry.player_tag"),
    "items[].name": to("ranking_entry.name"),
    "items[].rank": to("ranking_entry.rank"),
    "items[].eloRating": to("ranking_entry.rating"),
    "items[].expLevel": dropped(RETIRED_EXP_LEVEL),
    "items[].clan.tag": to("ranking_entry.clan_tag", opt),
    "items[].clan.name": to("ranking_entry.clan_name", opt),
    "items[].clan.badgeId": derived("a label on a board entry", opt),
    "paging.cursors.after": to("ranking_snapshot.truncated", opt),
    "paging.cursors.before": derived("with paging.cursors.after", opt),
  },
  rankings_pol_season: {
    "items[].tag": to("ranking_entry.player_tag"),
    "items[].name": to("ranking_entry.name"),
    "items[].rank": to("ranking_entry.rank"),
    "items[].eloRating": to("ranking_entry.rating"),
    "items[].expLevel": dropped(RETIRED_EXP_LEVEL),
    "items[].clan.tag": to("ranking_entry.clan_tag", opt),
    "items[].clan.name": to("ranking_entry.clan_name", opt),
    "items[].clan.badgeId": derived("a label on a board entry", opt),
    "paging.cursors.after": to("ranking_snapshot.truncated", opt),
    "paging.cursors.before": derived("with paging.cursors.after", opt),
  },
  // A mode leaderboard's entry carries no expLevel at all, unlike the
  // trophy and Path of Legends boards (live read 2026-09-26; feedback 362).
  leaderboard: {
    "items[].tag": to("ranking_entry.player_tag"),
    "items[].name": to("ranking_entry.name"),
    "items[].rank": to("ranking_entry.rank"),
    "items[].score": to("ranking_entry.rating"),
    "items[].clan.tag": to("ranking_entry.clan_tag", opt),
    "items[].clan.name": to("ranking_entry.clan_name", opt),
    "items[].clan.badgeId": derived("a label on a board entry", opt),
    "paging.cursors.after": to("ranking_snapshot.truncated", opt),
    "paging.cursors.before": derived("with paging.cursors.after", opt),
  },
  rankings_clans_loc: {
    "items[].tag": to("clan_ranking_entry.clan_tag"),
    "items[].name": to("clan_ranking_entry.name"),
    "items[].rank": to("clan_ranking_entry.rank"),
    "items[].previousRank": to("clan_ranking_entry.previous_rank"),
    "items[].clanScore": to("clan_ranking_entry.score"),
    "items[].members": to("clan_ranking_entry.members"),
    "items[].badgeId": to("clan_ranking_entry.badge_id"),
    "items[].location.id": to("clan_ranking_entry.location_id"),
    "items[].location.name": derived(
      "ranking_board carries the label per location key",
    ),
    "items[].location.isCountry": derived("with items[].location.name"),
    "items[].location.countryCode": derived("with items[].location.name", opt),
    "paging.cursors.after": to("ranking_snapshot.truncated", opt),
    "paging.cursors.before": derived("with paging.cursors.after", opt),
  },
  rankings_clanwars: {
    "items[].tag": to("clan_ranking_entry.clan_tag"),
    "items[].name": to("clan_ranking_entry.name"),
    "items[].rank": to("clan_ranking_entry.rank"),
    "items[].previousRank": to("clan_ranking_entry.previous_rank"),
    // The war board's score is spelt clanScore too and means war
    // trophies (cr-agent-api-docs/locations.md); the census's first run
    // (2026-09-17) caught this entry naming a field the board never
    // sends.
    "items[].clanScore": to(
      "clan_ranking_entry.score (war trophies on this board)",
    ),
    "items[].clanWarTrophies": to(
      "clan_ranking_entry.score (the projector's fallback spelling; never observed)",
      opt,
    ),
    "items[].members": to("clan_ranking_entry.members"),
    "items[].badgeId": to("clan_ranking_entry.badge_id"),
    "items[].location.id": to("clan_ranking_entry.location_id"),
    "items[].location.name": derived(
      "ranking_board carries the label per location key",
    ),
    "items[].location.isCountry": derived("with items[].location.name"),
    "items[].location.countryCode": derived("with items[].location.name", opt),
    "paging.cursors.after": to("ranking_snapshot.truncated", opt),
    "paging.cursors.before": derived("with paging.cursors.after", opt),
  },
  leaderboards: {
    "items[].id": to("ranking_board.location_key (board 'mode')"),
    "items[].name": to("ranking_board.label", opt),
  },
  // /events is a BARE ARRAY (admission.mjs, cr-agent-api-docs events.md),
  // so its paths start at `[]`: the manifest said `items[]` and the first
  // census filed the three real paths as unknown (feedback #50-#52).
  events: {
    "[].eventTag": to("game_event.event_tag; game_event_day.event_tag"),
    "[].title": to("game_event.title"),
    "[].description": to("game_event.description", opt),
  },
  globaltournaments: {
    "items[].tag": dropped(
      "0094: game_tournament was written and never read; the payload is archived and re-projectable",
    ),
    "items[].title": dropped("with items[].tag", opt),
    "items[].startTime": dropped("with items[].tag", opt),
    "items[].endTime": dropped("with items[].tag", opt),
    "items[].maxTopRewardLevel": dropped("with items[].tag", opt),
    "items[].gameMode.id": dropped("with items[].tag", opt),
    "items[].gameMode.name": dropped("with items[].tag", opt),
    "items[].maxLosses": dropped("with items[].tag", opt),
    "items[].minExpLevel": dropped("with items[].tag", opt),
    "items[].tournamentLevel": dropped("with items[].tag", opt),
    "items[].milestoneRewards[].chest": dropped("with items[].tag", opt),
    "items[].milestoneRewards[].rarity": dropped("with items[].tag", opt),
    "items[].milestoneRewards[].resource": dropped("with items[].tag", opt),
    "items[].milestoneRewards[].type": dropped("with items[].tag", opt),
    "items[].milestoneRewards[].amount": dropped("with items[].tag", opt),
    "items[].milestoneRewards[].card.id": dropped("with items[].tag", opt),
    "items[].milestoneRewards[].card.name": dropped("with items[].tag", opt),
    "items[].milestoneRewards[].wins": dropped("with items[].tag", opt),
    "items[].freeTierRewards[].chest": dropped("with items[].tag", opt),
    "items[].freeTierRewards[].rarity": dropped("with items[].tag", opt),
    "items[].freeTierRewards[].resource": dropped("with items[].tag", opt),
    "items[].freeTierRewards[].type": dropped("with items[].tag", opt),
    "items[].freeTierRewards[].amount": dropped("with items[].tag", opt),
    "items[].freeTierRewards[].wins": dropped("with items[].tag", opt),
    "items[].topRankReward[].chest": dropped("with items[].tag", opt),
    "items[].topRankReward[].rarity": dropped("with items[].tag", opt),
    "items[].topRankReward[].resource": dropped("with items[].tag", opt),
    "items[].topRankReward[].type": dropped("with items[].tag", opt),
    "items[].topRankReward[].amount": dropped("with items[].tag", opt),
    "items[].topRankReward[].startRank": dropped("with items[].tag", opt),
    "items[].topRankReward[].endRank": dropped("with items[].tag", opt),
  },
};

/**
 * Every leaf path of a payload, in the manifest's notation: dots for
 * keys, `[]` for array elements, `*` for the keys of a map named in
 * `maps` (`progress` on the profile). A scalar array's elements are
 * `x[]`; an empty array or object names nothing (absence is not shape).
 */
export function payloadPaths(payload, { maps = ["progress"] } = {}) {
  const out = new Set();
  const walk = (value, path) => {
    if (Array.isArray(value)) {
      for (const el of value) walk(el, `${path}[]`, false);
      return;
    }
    if (value && typeof value === "object") {
      const isMap = maps.includes(path.split(".").pop());
      for (const k of Object.keys(value))
        walk(value[k], path ? `${path}.${isMap ? "*" : k}` : k);
      return;
    }
    // A scalar, null included: null is a value the API chose to send
    // (princessTowersHitPoints is null, not [], once both are down).
    if (path) out.add(path);
  };
  walk(payload, "");
  return out;
}

/** The manifest's verdict on one path: the entry, or null. */
export function dispositionOf(endpoint, path) {
  return PAYLOAD_KEYS[endpoint]?.[path] ?? null;
}

/** The paths of an endpoint's manifest that are not optional. */
export function expectedPaths(endpoint) {
  return Object.entries(PAYLOAD_KEYS[endpoint] ?? {})
    .filter(([, d]) => !d.optional)
    .map(([p]) => p);
}
