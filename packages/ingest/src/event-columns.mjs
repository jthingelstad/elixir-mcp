/**
 * The event ledgers' typed columns (0124), one
 * mapping for the writer and the SQL fill: `eventColumns(type, payload)`
 * takes an emitter's payload apart into the columns its kind carries.
 * The reader-side inverse lives in packages/tools/src/event-payloads.mjs,
 * which renders the same object back with the keys the catalog, the
 * battle row and the player row hold today.
 */

import { CARD_FORM_BITS } from "@elixir-mcp/contracts";

const int = (v) => (Number.isInteger(v) ? v : null);
const text = (v) => (typeof v === "string" ? v : null);

export function playerEventColumns(type, p = {}) {
  const battle = p.promoted_by ?? p.crossed_by ?? null;
  const out = {
    card_id: null,
    badge_name: null,
    level: null,
    prior_level: null,
    max_level: null,
    arena_from: null,
    arena_to: null,
    arena_to_name: null,
    league_from: null,
    league_to: null,
    value_before: null,
    value_after: null,
    step: null,
    // The battle moments (0289).
    mode_group: null,
    deck_hash: null,
    prior_deck_hash: null,
    battles: null,
    wins: null,
    season_month: null,
    battle_id: text(battle?.battle_id),
    floor: int(battle?.arena_floor),
  };
  switch (type) {
    case "card_leveled":
      return {
        ...out,
        card_id: int(p.card_id),
        level: int(p.level),
        prior_level: int(p.prior_level),
      };
    case "card_unlocked":
      return { ...out, card_id: int(p.card_id) };
    // The form rides as its bit in step (0192): 1 Evolution, 2 Hero.
    case "card_form_unlocked":
      return {
        ...out,
        card_id: int(p.card_id),
        step: CARD_FORM_BITS[p.form] ?? null,
      };
    // The rung the level-up crossed rides in step (0286), written from
    // that deploy on; null when it crossed none.
    case "badge_earned":
      return {
        ...out,
        badge_name: text(p.name),
        level: int(p.level),
        prior_level: int(p.prior_level),
        max_level: int(p.max_level),
        step: int(p.rung),
      };
    // A deck newly played in one mode (0289): the first battle with it
    // is its battle_id.
    case "deck_switched":
      return {
        ...out,
        mode_group: text(p.mode_group),
        deck_hash: text(p.deck_hash),
        prior_deck_hash: text(p.prior_deck_hash),
        battles: int(p.battles),
        wins: int(p.wins),
        battle_id: text(p.first_battle_id),
      };
    // A Ranked season's final league once the profile rolled (0289).
    case "ranked_season_finished":
      return {
        ...out,
        season_month: text(p.season_month),
        league_to: int(p.league),
        value_after: int(p.rating),
      };
    // The first win with a newly unlocked card or form (0289): the form's
    // bit in step as card_form_unlocked has it, null for the card itself.
    case "card_first_win":
      return {
        ...out,
        card_id: int(p.card_id),
        step: p.form ? (CARD_FORM_BITS[p.form] ?? null) : null,
        battle_id: text(p.battle_id),
      };
    case "card_maxed":
      return { ...out, card_id: int(p.card_id), level: int(p.level) };
    case "king_tower_leveled":
      return { ...out, level: int(p.level), prior_level: int(p.prior_level) };
    case "challenge_best_run":
      return {
        ...out,
        value_before: int(p.best_before),
        value_after: int(p.best),
      };
    // A 12-win challenge badge's progress is its count of 12-win runs.
    case "twelve_win_run":
      return {
        ...out,
        badge_name: text(p.name),
        value_before: int(p.runs_before),
        value_after: int(p.runs),
        level: int(p.level),
        prior_level: int(p.prior_level),
      };
    case "legendary_badge_earned":
      return { ...out, badge_name: text(p.name) };
    case "arena_changed":
      return {
        ...out,
        arena_from: int(p.from),
        arena_to: int(p.to),
        arena_to_name: text(p.to_name),
      };
    case "ranked_promotion":
      return { ...out, league_from: int(p.from), league_to: int(p.to) };
    case "donation_reset":
      return {
        ...out,
        value_before: int(p.donations_before),
        value_after: int(p.donations_after),
      };
    case "best_trophies_band":
      return { ...out, value_after: int(p.best), step: int(p.band) };
    case "career_wins_step":
      return { ...out, value_after: int(p.wins), step: int(p.step) };
    case "collection_level_step":
      return { ...out, level: int(p.level), step: int(p.step) };
    default:
      return out;
  }
}

export function clanEventColumns(type, p = {}) {
  const out = {
    player_tag: null,
    role_before: null,
    role_after: null,
    joined_observed_at: null,
    roster_size_before: int(p.roster_size_before),
    roster_size_after: int(p.roster_size_after),
    war_season_id: int(p.season_id),
    section_index: int(p.section_index),
    fame: int(p.fame),
    rank: int(p.rank),
    trophy_change: int(p.trophy_change),
    finish_time: p.finish_time ? new Date(p.finish_time) : null,
  };
  switch (type) {
    case "member_joined":
      return {
        ...out,
        player_tag: text(p.player_tag),
        role_after: text(p.role),
      };
    case "member_left":
      return {
        ...out,
        player_tag: text(p.player_tag),
        role_before: text(p.role_at_departure),
        joined_observed_at: p.joined_observed_at
          ? new Date(p.joined_observed_at)
          : null,
      };
    case "role_changed":
      return {
        ...out,
        player_tag: text(p.player_tag),
        role_before: text(p.role_before),
        role_after: text(p.role_after),
      };
    default:
      return out;
  }
}
