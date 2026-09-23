/** Shared by the battlesTools tools in this directory: the helpers,
 *  argument schemas and notes more than one of them uses. Split out of
 *  tools/battles.mjs (2026-09-23), one file per tool. */

import {
  EVENT_MODE_GROUP,
  MODE_GROUPS,
  cardDisplayName,
  typesForModeGroup,
} from "@elixir-mcp/contracts";
import { deckStamps, docsRef, requireEnum } from "../shared.mjs";
import { TROPHY_BAND_NAMES } from "../../meta-season.mjs";

/** group_by on battles_meta_decks (6.6.0, design §6): the population's
 *  decks folded by archetype label or by family, with the members who
 *  play each on a clan, player or collection segment. */
export const GROUP_BY_SCHEMA = {
  type: "string",
  enum: ["archetype", "family"],
  description:
    'Fold the population\'s decks by archetype label ("Royal Hogs bridge spam") or by family (six rows). Rows carry decks, battles, record and players; on a clan, player or collection segment each carries members[] (who plays it, with their most-played deck of that shape). Sorted by players then battles - who plays what, never a tier list: shrunk_win_rate is deliberately absent. decks[] is empty with group_by.',
};

/** fit_for on the meta tools (6.4.0, feedback #70). */
export const FIT_FOR_SCHEMA = {
  type: "string",
  description:
    "A player tag whose recorded collection every row is checked against. On battles_meta_decks a row the player cannot field (a card not owned, a form not unlocked) leaves decks[] for unfieldable[] with the reason, and every row carries fit: the mean level the player would field it at, that against the level they have been fielding in the window (fit_for.fielded_mean_level), and the upgrade path to it. On battles_meta_cards each row carries held (level and forms) or null. Omit for the population alone; a recommendation to a person should not omit it.",
};

/** The trophy band argument the three meta tools take (0135): the
 *  participant's own starting trophies at battle time. */

/** One card, or a handful: the ids a card-shaped question names (5.0.0).
 *  Filters the rows AFTER aggregation, like min_battles and limit; the
 *  denominators (decided_battles, usage_share) stay the population's. */
export const CARD_IDS_ARG = {
  type: "array",
  items: { type: "integer" },
  minItems: 1,
  maxItems: 8,
};
export const META_TROPHY_BAND_SCHEMA = {
  type: "string",
  enum: TROPHY_BAND_NAMES,
  description:
    "Only battles the deck's own player entered with starting trophies in this band: the meta at a level. Ranked (Path of Legends) battles carry a rating, not trophies, and sit in no band. A corpus season read answers from the banded rollup once the nightly rebuild has filled it, else from the raw rows with a note.",
};

/** The band fallback sentence when the rollup is not yet built. */
/** The meta tools and the caller's collection (6.4.0, feedback #70). */
export const NO_FIT_NOTE =
  "These are the population's decks and levels; nothing here checks what any one player holds. Before naming a row as a recommendation to a person, pass fit_for with their tag: rows they cannot field leave decks[], and every row then says what they would field it at and what upgrades would open.";

export function fitNotes(fitBlock, decks, unfieldable) {
  const fielded =
    fitBlock.fielded_mean_level === null
      ? `${fitBlock.player_tag} has no decided pvp battles with a recorded deck in this window, so fit.vs_fielded and fit.upgrades are null: there is no fielded level to measure against`
      : `${fitBlock.player_tag} has fielded a mean card level of ${fitBlock.fielded_mean_level} over ${fitBlock.fielded_battles} decided battles in this window, and ${fitBlock.recent_mean_level ?? fitBlock.fielded_mean_level} over their last ten (recent_mean_level); fit.vs_fielded is each row's own_mean_level against the recent level, and fit.upgrades is the path to it`;
  const levelling =
    fitBlock.recent_mean_level !== null &&
    fitBlock.recent_mean_level !== undefined &&
    fitBlock.fielded_mean_level !== null &&
    Math.abs(fitBlock.recent_mean_level - fitBlock.fielded_mean_level) >= 1
      ? `${fitBlock.player_tag} is levelling up: they field ${fitBlock.recent_mean_level} now against ${fitBlock.fielded_mean_level} over the window, so vs_fielded and the upgrade targets read against the recent level (Gym #171).`
      : null;
  return [
    ...(levelling ? [levelling] : []),
    `Checked against ${fitBlock.player_tag}'s collection as of ${fitBlock.collection_as_of}: ${decks.length} of the top ${decks.length + unfieldable.length} rows are fieldable as held (decks[]); ${unfieldable.length} are not (unfieldable[], each naming the card or form missing). The population's ranking is unchanged - the split is after sort and limit, so raise limit for more fieldable rows.`,
    `${fielded}. mean_level_gap on a row is the population's players' edge over their opponents, not ${fitBlock.player_tag}'s; own_mean_level is what the deck would be at their levels, and held_level rides each card.`,
    `fit.plays_archetype, fit.plays_win_condition and fit.plays_family say whether ${fitBlock.player_tag} already fields this row's exact shape, its win condition (form included: Evo Royal Hogs is not Royal Hogs) or its family (fit_for.plays lists theirs). Adoption cost reads off them in that order: the exact shape costs the least; the same win condition in another family is the card they have leveled and learned played at a different pace (the usual next step); the same family around a new win condition is a new card to level; a row sharing neither is a new deck to learn as well as levels to buy.`,
  ];
}

/** Fold deck rows by their stamped archetype (label or family). With
 *  members, one scan of the scope's battle rows by player and deck says
 *  who plays each shape and their most-played deck of it; `players` is
 *  then exact. Without (the corpus), `players` sums the decks' distinct
 *  players and the note says a player on two decks of one shape counts
 *  twice. */
export async function groupByArchetype(
  db,
  { groupBy, rows, where, params, withMembers, limit },
) {
  const stamps = await deckStamps(
    db,
    rows.map((r) => r.deck_hash),
  );
  const keyOf = (stamp) => (groupBy === "family" ? stamp.family : stamp.label);
  const groups = new Map();
  const total = rows.reduce((n, r) => n + r.battles, 0);
  for (const r of rows) {
    const stamp = stamps.get(r.deck_hash);
    if (!stamp) continue;
    const key = keyOf(stamp);
    const g = groups.get(key) ?? {
      ...(groupBy === "family"
        ? { family: stamp.family }
        : {
            label: stamp.label,
            family: stamp.family,
            win_condition_ids: stamp.win_condition_ids,
          }),
      decks: 0,
      battles: 0,
      wins: 0,
      losses: 0,
      players: 0,
      _hashes: new Set(),
    };
    g.decks += 1;
    g.battles += r.battles;
    g.wins += r.wins;
    g.losses += r.losses;
    g.players += r.players ?? 0;
    g._hashes.add(r.deck_hash);
    groups.set(key, g);
  }
  let members = null;
  if (withMembers) {
    // Who plays what, over the same scope the deck rows came from.
    const { rows: plays } = await db.query(
      `select bp.player_tag, p.name, bp.deck_hash,
              count(*)::int as battles,
              count(*) filter (where bp.outcome = 'win')::int as wins
       from battle_participant bp
       left join player p on p.player_tag = bp.player_tag
       where ${where.join(" and ")}
       group by bp.player_tag, p.name, bp.deck_hash`,
      params,
    );
    members = new Map(); // key -> Map(player_tag -> {name, battles, wins, best})
    for (const pl of plays) {
      const stamp = stamps.get(pl.deck_hash);
      if (!stamp) continue;
      const key = keyOf(stamp);
      const byPlayer = members.get(key) ?? new Map();
      const m = byPlayer.get(pl.player_tag) ?? {
        player_tag: pl.player_tag,
        name: pl.name ?? null,
        battles: 0,
        wins: 0,
        deck_hash: pl.deck_hash,
        _deckBattles: 0,
      };
      m.battles += pl.battles;
      m.wins += pl.wins;
      if (pl.battles > m._deckBattles) {
        m._deckBattles = pl.battles;
        m.deck_hash = pl.deck_hash;
      }
      byPlayer.set(pl.player_tag, m);
      members.set(key, byPlayer);
    }
  }
  const out = [...groups.values()].map((g) => {
    const row = { ...g };
    delete row._hashes;
    const byPlayer = members?.get(groupBy === "family" ? g.family : g.label);
    const list = byPlayer
      ? [...byPlayer.values()]
          .sort(
            (a, z) =>
              z.battles - a.battles || a.player_tag.localeCompare(z.player_tag),
          )
          .map(({ _deckBattles, ...m }) => m)
      : null;
    return {
      ...row,
      ...(list ? { players: list.length, members: list } : {}),
      win_rate:
        row.wins + row.losses > 0
          ? Number((row.wins / (row.wins + row.losses)).toFixed(3))
          : null,
      share: total > 0 ? Number((row.battles / total).toFixed(3)) : null,
    };
  });
  out.sort((a, z) => z.players - a.players || z.battles - a.battles);
  return {
    rows: out.slice(0, limit),
    folded: `Folded ${rows.length} decks over min_battles into ${out.length} ${groupBy === "family" ? "families" : "archetypes"} by their stamped label, sorted by who plays them (players, then battles); share is of the ${total} decided battles those decks hold. cards_archetype({ name }) says what one of these labels MEANS - its family, its win conditions, the other names for the shape - and cards_archetype({ cards }) names a deck you hand it. ${
      withMembers
        ? "members lists each player of the shape with their most-played deck of it; players is exact."
        : "players sums the decks' distinct players, so a player on two decks of one shape counts twice."
    } No win rate is shrunk or ranked here: the same label wins and loses with the player.`,
  };
}

export function cardFitNote(fitBlock, cards) {
  const unowned = cards.filter((c) => c.held === null).length;
  const noForm = cards.filter((c) => c.held && !c.held.has_form).length;
  return `held on each row is what ${fitBlock.player_tag} holds of the card as of ${fitBlock.collection_as_of} (${unowned} of ${cards.length} rows not owned, ${noForm} owned without the form played); ${
    fitBlock.fielded_mean_level === null
      ? "no fielded level is known for this window"
      : `their fielded mean level in this window is ${fitBlock.fielded_mean_level}, the benchmark a held level reads against`
  }. mean_level_gap is the population's, not theirs.`;
}

export const BAND_FALLBACK_NOTE =
  "trophy_band answered from the raw rows (the season's banded rollup is not built yet; the nightly rebuild fills it), so distinct-player counts are exact and the read is slower.";

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
 *  rides a battle played inside a time-bound event and nothing else
 *  (6.17.0). The permanent groups must therefore also exclude tagged
 *  battles, or `casual` would keep collecting the events that used to
 *  fold into it. */
export function modeClause(args, add) {
  requireEnum(args.mode, MODE_GROUPS, "mode");
  if (!args.mode) return;
  if (args.mode === EVENT_MODE_GROUP) {
    add("b.event_tag is not null", undefined);
    return;
  }
  add("b.type = any(?)", typesForModeGroup(args.mode));
  add("b.event_tag is null", undefined);
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
export const COMPACT_DESC =
  "one row keeps deck_hash, archetype_label, card_names (one string), battles, wins, losses, players, usage_share, win_rate, shrunk_win_rate, dominant_mode and (with fit_for) fit without its upgrade path; drops modes, first/last_used, the level gap, the card objects, the archetype object, methodology and modes_in_window.";
export const COMPACT_CARDS_DESC =
  "one row keeps card_id, name, form, battles, wins, losses, players, usage_share, win_rate, shrunk_win_rate and (with fit_for) held; drops modes, the level gap, methodology and modes_in_window.";
export function compactDeckRow(row) {
  const {
    modes,
    first_used,
    last_used,
    mean_level_gap,
    level_gap_battles,
    cards,
    tower_troop,
    archetype,
    fit,
    ...rest
  } = row;
  void modes;
  void first_used;
  void last_used;
  void mean_level_gap;
  void level_gap_battles;
  void tower_troop;
  return {
    ...rest,
    archetype_label: archetype?.label ?? null,
    card_names: (cards ?? [])
      .map((c) => cardDisplayName({ name: c.name, form: c.form ?? "base" }))
      .join(", "),
    ...(fit
      ? {
          fit: (({ upgrades, ...verdict }) => {
            void upgrades;
            return verdict;
          })(fit),
        }
      : {}),
  };
}
export function compactCardRow(row) {
  const { modes, mean_level_gap, ...rest } = row;
  void modes;
  void mean_level_gap;
  return rest;
}
