/** Shared by the battlesTools tools in this directory: the helpers,
 *  argument schemas and notes more than one of them uses. Split out of
 *  tools/battles.mjs (2026-09-23), one file per tool. */

import { notBoatDefense } from "@elixir-mcp/record/boat-defense-sql";
import {
  EVENT_MODE_GROUP,
  MODE_GROUPS,
  eventContentSql,
  typesForModeGroup,
} from "@elixir-mcp/contracts";
import { docsRef, requireEnum } from "../shared.mjs";

/** tower_hp as served, from the three columns (0123): king when
 *  carried, princess as the fixed pair - a one-tower array was padded
 *  with 0 for the destroyed tower (feedback #22: the API omits a
 *  destroyed tower on head-to-head rows and writes 0 on duel rows, so
 *  array length was not a tower count). Position carries no meaning. */
export function towerHpOf(r) {
  if (r.king_tower_hp === null && r.princess_tower_hp_1 === null) return null;
  return {
    ...(r.king_tower_hp !== null ? { king: r.king_tower_hp } : {}),
    // The API omits a destroyed princess tower, and omits the whole
    // array when both fell; with the king carried, no array is [0, 0],
    // as the docs promise (Gym #100: 78 of 400 sides served no key).
    ...(r.princess_tower_hp_1 !== null
      ? { princess: [r.princess_tower_hp_1, r.princess_tower_hp_2 ?? 0] }
      : r.king_tower_hp !== null
        ? { princess: [0, 0] }
        : {}),
  };
}

/** A duel's per-round results (6.16.0, recorded since 0151). The
 *  top-level crowns are their SUM and the top-level tower hitpoints the
 *  FINAL round's, so until these rode the row a duel could not answer
 *  "how did round two go" - and the docs said so as if it were a
 *  property of duels rather than of the record. The round number is the
 *  one deck.rounds[] already uses, so a round's deck and its result line
 *  up. Each round carries its own elixir differential, which the summed
 *  top-level one cannot have. */
export function roundResultsOf(own, opponent) {
  if (!own || own.length === 0) return undefined;
  const byRound = new Map((opponent ?? []).map((r) => [r.round, r]));
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  return own.map((r) => {
    const mine = num(r.elixir_leaked);
    const theirs = num(byRound.get(r.round)?.elixir_leaked);
    return {
      round: r.round,
      crowns: r.crowns,
      tower_hp: towerHpOf(r),
      elixir: {
        leaked: mine,
        opponent_leaked: theirs,
        differential:
          mine !== null && theirs !== null
            ? Number((mine - theirs).toFixed(2))
            : null,
        // The caveat rides the row's own elixir object once; repeating
        // it per round per side cost ~1.8 KB on a three-round duel and
        // helped nobody.
      },
    };
  });
}

/** The comparisons a battle row already held both halves of and never
 *  made (6.18.0). Every one is me MINUS the single opponent, positive
 *  meaning my side: the number is only meaningful as a difference -
 *  Jamie, 2026-09-22, on elixir leaked - and a caller was reaching into
 *  two nested objects to compute each one.
 *
 *  Null on anything that is not a single head-to-head pair (2v2, a duel
 *  whose sides played different decks per round), and per-field null
 *  where the record lacks a side's value. */
export function versusOf(me, opponent, type) {
  // A boat battle is a defense against an attack: nothing to difference
  // (Gym #97).
  if (!opponent || isDuel(type) || /^boatBattle/.test(String(type ?? "")))
    return null;
  const diff = (a, b) =>
    typeof a === "number" && typeof b === "number"
      ? Number((a - b).toFixed(2))
      : null;
  const towers = (r) => {
    const parts = [
      r.king_tower_hp,
      r.princess_tower_hp_1,
      r.princess_tower_hp_2,
    ];
    return parts.every((v) => v === null || v === undefined)
      ? null
      : parts.reduce((n, v) => n + (v ?? 0), 0);
  };
  return {
    crowns: diff(me.crowns, opponent.crowns),
    // deck_avg_level is stamped at ingest from the cards as played, so
    // this is the level edge in THIS battle, not a career average.
    deck_level: diff(
      me.deck_avg_level === null ? null : Number(me.deck_avg_level),
      opponent.deck_avg_level === null ? null : Number(opponent.deck_avg_level),
    ),
    starting_trophies: diff(me.starting_trophies, opponent.starting_trophies),
    // Hitpoints REMAINING. A margin of victory only between equal
    // towers: a one-level gap starts 1,564 HP apart (Gym #97), so
    // tower_level rides beside it and a note fires when it is not 0.
    tower_hp: diff(towers(me), towers(opponent)),
    tower_level: diff(me.tower_level ?? null, opponent.tower_level ?? null),
  };
}

/** What the battle's signature proves about how long it ran (6.18.0).
 *  The log carries no duration, but the game's clock makes the crown
 *  pair a bound: a King Tower is the ONLY way to end before 3:00, and
 *  overtime ends on the next tower, so level crowns means overtime
 *  expired and the tower-hitpoints tiebreaker resolved it - exactly
 *  5:00. Head-to-head 1v1 only: a duel sums crowns over up to three
 *  games and a boat battle has no overtime. */
const H2H_TYPES = new Set(["PvP", "pathOfLegend", "riverRacePvP"]);
export function durationOf(me, opponent, type) {
  if (!H2H_TYPES.has(type) || !opponent) return null;
  const a = me.crowns;
  const b = opponent.crowns;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
  if (a === 3 || b === 3)
    return {
      at_least_s: null,
      at_most_s: 300,
      exact_s: null,
      basis: "king_tower_fell",
    };
  if (a === b)
    return {
      at_least_s: 300,
      at_most_s: 300,
      exact_s: 300,
      basis: "overtime_expired",
    };
  return {
    at_least_s: 180,
    at_most_s: 300,
    exact_s: null,
    basis: "regulation_ran",
  };
}

export const FORM_ROWS_NOTE =
  "Forms are separate rows: form is the card FORM played (base, evolution or hero), never a level, so a card played in two forms carries two records.";

export const roundsPlayed = (deck) =>
  Array.isArray(deck?.rounds) ? { rounds_played: deck.rounds.length } : {};

// The leaked-elixir counter travels as one object with its caveat ON the
// value (6.0.0, feedback #66): a note beside the row was read and
// overridden by a consuming agent the morning it shipped, because the
// number sat beside crowns and trophy_change as if it were an outcome
// fact. `rounds` is what the counters sum over; a duel's sides each sum
// two or three games on different decks, so its differential is null
// (feedback #65: the 3.13.0 spec said so and the code did not).
// Carried ON the value, not beside it (6.0.0, feedback #66), so it
// travels with the number - but tightly: it rides every participant of
// every row, and at ~295 characters it was 6 KB of one repeated
// sentence on a ten-battle page, which is what pushed battles_query
// full past the result cap in 6.18.0.
const ELIXIR_CAVEAT =
  "Not a skill measure: holding elixir to make the opponent commit is a deliberate line that raises leak by design, and the record cannot tell that from waste. Read the differential, never the absolute.";
export const isDuel = (type) => /^riverRaceDuel/.test(String(type ?? ""));
export const elixirOf = (own, opponent, type, deck) => {
  if (own === null) return null;
  const duel = isDuel(type);
  return {
    leaked: own,
    opponent_leaked: opponent,
    differential:
      !duel && opponent !== null ? Number((own - opponent).toFixed(2)) : null,
    // A duel row whose rounds were never recorded (an archive import)
    // still sums them: null says "more than one, count unknown".
    rounds: duel
      ? Array.isArray(deck?.rounds)
        ? deck.rounds.length
        : null
      : 1,
    caveat: ELIXIR_CAVEAT,
  };
};

// Deck identities render from deck_card via shared deckIdentities (0091):
// {id, name, form} plus tower_troop - the shape deckCards/towerTroop
// produced from an exemplar's JSON (playtest round, 2026-09-09: forms are
// part of identity and must be visible).

export const BATTLE_DOCS = docsRef("battles", "what-a-battle-record-holds");
// Where the mode split, the level gap, the trophy floor and the partial
// bucket are explained (3.13.0): the deck and card aggregates point here.
export const CONTROLS_DOCS = docsRef(
  "battles",
  "the-control-next-to-the-number",
);
export const DENOMINATOR_DOCS = docsRef(
  "battles",
  "decided-battles-and-denominators",
);

/** Shared: the mode filter as a WHERE clause.
 *
 *  `event` is not a set of types - it is the API's own eventTag, which
 *  rides a battle played inside a time-bound event (6.17.0), except on a
 *  clanmate battle, which is casual even when tagged (#109). The
 *  permanent groups must therefore also exclude event content, or
 *  `casual` would keep collecting the events that used to fold into it. */
/** A member's own battles only: boat defenses are not theirs (0171). */
export function ownBattlesClause(add) {
  add(notBoatDefense(), undefined);
}

export function modeClause(args, add) {
  requireEnum(args.mode, MODE_GROUPS, "mode");
  if (!args.mode) return;
  if (args.mode === EVENT_MODE_GROUP) {
    add(eventContentSql("b.type", "b.event_tag"), undefined);
    return;
  }
  add("b.type = any(?)", typesForModeGroup(args.mode));
  add(`not ${eventContentSql("b.type", "b.event_tag")}`, undefined);
}

/** compact on the meta tools (feedback #80): a weekly routine comparing
 *  the field to one clan makes four of these calls, and four full
 *  payloads (~1.3 KB a deck row) crossed a turn's token ceiling before
 *  the report could be written. One row keeps what a comparison reads -
 *  counts, share, the shrunk rate, players, the label and the card
 *  names as one string - and drops the split, the instants, the level gap, the
 *  card objects and the archetype object; the response drops the
 *  methodology block (documented) and the per-mode groups (the pooled
 *  note stays). fit keeps its verdict and drops the upgrade path. */
