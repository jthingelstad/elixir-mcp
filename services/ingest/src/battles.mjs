/**
 * Canonical battle ingest — DESIGN §4.4.
 *
 * battle_id = sha256(canonical battle_time ":" sorted participant tags ":"
 * type_class), derived from the SAME canonical values that are stored.
 * Invariants encoded here, not in readers:
 *  - a river-race duel is ONE battle with rounds, not three;
 *  - participants are written symmetrically for every side (§4.1);
 *  - enrich-on-dedup fills missing fields only (COALESCE), and the enrich
 *    column list is DERIVED from the insert column list so the two can
 *    never drift (elixir-bot's "deck_json stayed NULL" lesson);
 *  - outcome precedence: boatBattleWon -> trophyChange sign -> crown
 *    compare -> unresolved.
 *
 * `side` semantics: 0/1 labels partition participants into their two teams
 * correctly, but WHICH team is 0 depends on whichever observer's log was
 * ingested first (team=0 from that log's perspective). The labels are
 * arbitrary; the partition is the fact. Readers must never assume side 0
 * means "the subject" — locate subjects by tag (§4.4 team[0] trap).
 */

import { createHash } from "node:crypto";
import { normalizeTag, deckHash } from "@elixir-mcp/contracts";
import { canonicalBattleTime } from "./battle-time.mjs";

function slimCards(cards) {
  if (!Array.isArray(cards)) return undefined;
  return cards.map((c) => {
    const slim = { id: c.id, name: c.name, level: c.level };
    if (c.evolutionLevel !== undefined) slim.evolutionLevel = c.evolutionLevel;
    if (c.starLevel !== undefined) slim.starLevel = c.starLevel;
    if (c.used !== undefined) slim.used = c.used;
    return slim;
  });
}

function participantDeck(entry) {
  // Duels: top-level `cards` is all rounds concatenated — store rounds,
  // and there is no single deck identity to hash.
  if (Array.isArray(entry.rounds)) {
    return {
      deck: {
        rounds: entry.rounds.map((r) => ({ cards: slimCards(r.cards) })),
      },
      hash: null,
    };
  }
  const cards = slimCards(entry.cards);
  if (!cards) return { deck: null, hash: null };
  const deck = { cards };
  if (Array.isArray(entry.supportCards) && entry.supportCards.length > 0) {
    deck.supportCards = slimCards(entry.supportCards);
  }
  const hash = deckHash({
    cards: entry.cards.map((c) => ({
      id: c.id,
      ...(c.evolutionLevel !== undefined
        ? { evolutionLevel: c.evolutionLevel }
        : {}),
    })),
    ...(deck.supportCards?.[0]?.id !== undefined
      ? { towerTroopId: deck.supportCards[0].id }
      : {}),
  });
  return { deck, hash };
}

function towerHp(entry) {
  const out = {};
  if (entry.kingTowerHitPoints !== undefined)
    out.king = entry.kingTowerHitPoints;
  if (entry.princessTowersHitPoints !== undefined)
    out.princess = entry.princessTowersHitPoints;
  return Object.keys(out).length > 0 ? out : null;
}

function sideCrowns(entries) {
  const values = entries
    .map((e) => e.crowns)
    .filter((c) => typeof c === "number");
  return values.length > 0 ? Math.max(...values) : undefined;
}

function outcomeFor(entry, ownSide, otherSide, battle, isTeamSide) {
  if (battle.type?.startsWith("boatBattle")) {
    if (typeof battle.boatBattleWon === "boolean") {
      return battle.boatBattleWon === isTeamSide ? "win" : "loss";
    }
    return "unresolved";
  }
  if (typeof entry.trophyChange === "number" && entry.trophyChange !== 0) {
    return entry.trophyChange > 0 ? "win" : "loss";
  }
  const own = sideCrowns(ownSide);
  const other = sideCrowns(otherSide);
  if (own !== undefined && other !== undefined) {
    if (own > other) return "win";
    if (own < other) return "loss";
    return "draw";
  }
  return "unresolved";
}

function canonicalBattleId(battleTimeCanonical, participantTags, typeClass) {
  const sorted = [...participantTags].sort();
  return createHash("sha256")
    .update(`${battleTimeCanonical}:${sorted.join(",")}:${typeClass}`)
    .digest("hex");
}

/** Extract the canonical battle + participant rows from one battlelog entry. */
export function canonicalizeBattle(entry) {
  const battleTime = canonicalBattleTime(entry.battleTime);
  const typeClass = entry.type?.startsWith("boatBattle") ? "boat" : "pvp";
  const team = Array.isArray(entry.team) ? entry.team : [];
  const opponent = Array.isArray(entry.opponent) ? entry.opponent : [];

  const participants = [];
  for (const [side, entries, otherEntries, isTeamSide] of [
    [0, team, opponent, true],
    [1, opponent, team, false],
  ]) {
    for (const p of entries) {
      if (p.tag === undefined) continue; // boat defenses may lack real participants
      const { deck, hash } = participantDeck(p);
      participants.push({
        player_tag: normalizeTag(p.tag),
        side,
        crowns: p.crowns ?? null,
        trophy_change: p.trophyChange ?? null,
        starting_trophies: p.startingTrophies ?? null,
        deck,
        deck_hash: hash,
        support_cards: null, // folded into deck.supportCards
        elixir_leaked: p.elixirLeaked ?? null,
        tower_hp: towerHp(p),
        outcome: outcomeFor(p, entries, otherEntries, entry, isTeamSide),
        clan_tag: p.clan?.tag ? normalizeTag(p.clan.tag) : null,
      });
    }
  }

  const battleId = canonicalBattleId(
    battleTime,
    participants.map((p) => p.player_tag),
    typeClass,
  );

  return {
    battle: {
      battle_id: battleId,
      battle_time: battleTime,
      type: entry.type,
      type_class: typeClass,
      game_mode_id: entry.gameMode?.id ?? null,
      game_mode_name: entry.gameMode?.name ?? null,
      arena: entry.arena?.name ?? null,
      league_number: entry.leagueNumber ?? null,
      modifiers: null,
    },
    participants,
  };
}

// Insert column lists — the enrich lists are DERIVED from these.
const BATTLE_COLS = [
  "battle_id",
  "battle_time",
  "type",
  "type_class",
  "game_mode_id",
  "game_mode_name",
  "arena",
  "league_number",
  "modifiers",
];
const BATTLE_KEY = ["battle_id", "battle_time", "type", "type_class"];
const BATTLE_ENRICH = BATTLE_COLS.filter((c) => !BATTLE_KEY.includes(c));

const PARTICIPANT_COLS = [
  "battle_id",
  "player_tag",
  "side",
  "crowns",
  "trophy_change",
  "starting_trophies",
  "deck",
  "deck_hash",
  "support_cards",
  "elixir_leaked",
  "tower_hp",
  "outcome",
  "clan_tag",
];
const PARTICIPANT_KEY = ["battle_id", "player_tag", "side"];
const PARTICIPANT_ENRICH = PARTICIPANT_COLS.filter(
  (c) => !PARTICIPANT_KEY.includes(c),
);

const JSONB_COLS = new Set(["modifiers", "deck", "support_cards", "tower_hp"]);

function insertSql(table, cols, conflictTarget, enrichCols) {
  const params = cols.map((_, i) => `$${i + 1}`).join(", ");
  const sets = enrichCols
    .map((c) => `${c} = coalesce(${table}.${c}, excluded.${c})`)
    .join(", ");
  return `insert into ${table} (${cols.join(", ")}) values (${params})
          on conflict (${conflictTarget}) do update set ${sets}
          returning (xmax = 0) as inserted`;
}

function paramValues(cols, row) {
  return cols.map((c) => {
    const v = row[c];
    if (JSONB_COLS.has(c))
      return v === null || v === undefined ? null : JSON.stringify(v);
    return v ?? null;
  });
}

const BATTLE_SQL = insertSql("battle", BATTLE_COLS, "battle_id", BATTLE_ENRICH);
const PARTICIPANT_SQL = insertSql(
  "battle_participant",
  PARTICIPANT_COLS,
  "battle_id, player_tag",
  PARTICIPANT_ENRICH,
);

/**
 * Ingest one admitted battlelog payload for one observer.
 * Idempotent; at-least-once safe. Caller owns the transaction.
 */
export async function ingestBattlelog(db, { observerTag, receiptId, payload }) {
  const observer = normalizeTag(observerTag);
  let battlesInserted = 0;
  let battlesSeen = 0;
  const affected = new Set(); // "tag|day" pairs for rollup refresh

  // The observer may not appear in a battle (e.g. boat defense shapes);
  // its player row must exist for the observation FK regardless.
  await db.query(
    `insert into player (player_tag) values ($1)
     on conflict (player_tag) do update set last_seen_at = now()`,
    [observer],
  );

  for (const entry of payload) {
    const { battle, participants } = canonicalizeBattle(entry);
    battlesSeen += 1;

    // Ensure player rows exist for all participants (game entities exist
    // independent of accounts, §4.1).
    for (const p of participants) {
      await db.query(
        `insert into player (player_tag) values ($1)
         on conflict (player_tag) do update set last_seen_at = now()`,
        [p.player_tag],
      );
    }

    const {
      rows: [b],
    } = await db.query(BATTLE_SQL, paramValues(BATTLE_COLS, battle));
    if (b.inserted) battlesInserted += 1;

    for (const p of participants) {
      await db.query(
        PARTICIPANT_SQL,
        paramValues(PARTICIPANT_COLS, { ...p, battle_id: battle.battle_id }),
      );
    }

    await db.query(
      `insert into battle_observation (battle_id, observer_tag, receipt_id)
       values ($1, $2, $3) on conflict do nothing`,
      [battle.battle_id, observer, receiptId],
    );

    const day = battle.battle_time.slice(0, 10);
    for (const p of participants) affected.add(`${p.player_tag}|${day}`);
  }

  return {
    battlesSeen,
    battlesInserted,
    affectedPairs: [...affected].map((k) => {
      const [playerTag, day] = k.split("|");
      return { playerTag, day };
    }),
  };
}
