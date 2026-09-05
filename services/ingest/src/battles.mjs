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
import { normalizeTag, deckHash, displayLevel } from "@elixir-mcp/contracts";
import { canonicalBattleTime } from "./battle-time.mjs";

function slimCards(cards) {
  if (!Array.isArray(cards)) return undefined;
  return cards.map((c) => {
    // Levels stored on the in-game display scale, never the API's
    // rarity-relative one (contracts displayLevel — the one conversion).
    const slim = {
      id: c.id,
      name: c.name,
      level:
        typeof c.level === "number" && typeof c.maxLevel === "number"
          ? displayLevel(c.level, c.maxLevel)
          : c.level,
    };
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
        norm: 1, // levels already on the display scale (0011 backfill skips)
        rounds: entry.rounds.map((r) => ({ cards: slimCards(r.cards) })),
      },
      hash: null,
    };
  }
  const cards = slimCards(entry.cards);
  if (!cards) return { deck: null, hash: null };
  const deck = { norm: 1, cards };
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
      const cardLevels = (deck?.cards ?? [])
        .map((c) => c.level)
        .filter((l) => typeof l === "number");
      participants.push({
        player_tag: normalizeTag(p.tag),
        name: p.name ?? null, // for the player upsert only, never a participant column
        side,
        deck_avg_level: cardLevels.length
          ? Number(
              (
                cardLevels.reduce((s2, l) => s2 + l, 0) / cardLevels.length
              ).toFixed(2),
            )
          : null,
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
  "battle_time",
  "side",
  "crowns",
  "trophy_change",
  "starting_trophies",
  "deck",
  "deck_hash",
  "deck_avg_level",
  "support_cards",
  "elixir_leaked",
  "tower_hp",
  "outcome",
  "clan_tag",
];
const PARTICIPANT_KEY = ["battle_id", "player_tag", "battle_time", "side"];
const PARTICIPANT_ENRICH = PARTICIPANT_COLS.filter(
  (c) => !PARTICIPANT_KEY.includes(c),
);

const JSONB_COLS = new Set(["modifiers", "deck", "support_cards", "tower_hp"]);

function paramValues(cols, row) {
  return cols.map((c) => {
    const v = row[c];
    if (JSONB_COLS.has(c))
      return v === null || v === undefined ? null : JSON.stringify(v);
    return v ?? null;
  });
}

/** Multi-row variant: one statement for the whole payload (R1 — the
 *  census showed the projector's sequential round trips are 93% of
 *  ingest cost). Enrichment semantics identical to insertSql. */
function insertManySql(table, cols, conflictTarget, enrichCols, rowCount) {
  const rows = [];
  for (let r = 0; r < rowCount; r += 1) {
    rows.push(
      `(${cols.map((_, c) => `$${r * cols.length + c + 1}`).join(", ")})`,
    );
  }
  const sets = enrichCols
    .map((c) => `${c} = coalesce(${table}.${c}, excluded.${c})`)
    .join(", ");
  return `insert into ${table} (${cols.join(", ")}) values ${rows.join(", ")}
          on conflict (${conflictTarget}) do update set ${sets}
          returning (xmax = 0) as inserted`;
}

/**
 * Ingest one admitted battlelog payload for one observer.
 * Idempotent; at-least-once safe. Caller owns the transaction.
 */
export async function ingestBattlelog(db, { observerTag, receiptId, payload }) {
  const observer = normalizeTag(observerTag);
  let battlesSeen = 0;
  const affected = new Set(); // "tag|day" pairs for rollup refresh

  // Canonicalize everything first; the writes go out as one statement
  // per table (R1). Within-payload dedup matters: ON CONFLICT cannot
  // touch the same row twice in one statement.
  const battles = new Map(); // battle_id -> battle
  const parts = new Map(); // battle_id|tag -> participant row
  for (const entry of payload) {
    const { battle, participants } = canonicalizeBattle(entry);
    battlesSeen += 1;
    battles.set(battle.battle_id, battle);
    const day = battle.battle_time.slice(0, 10);
    for (const p of participants) {
      parts.set(`${battle.battle_id}|${p.player_tag}`, {
        ...p,
        battle_id: battle.battle_id,
        battle_time: battle.battle_time,
      });
      affected.add(`${p.player_tag}|${day}`);
    }
  }

  // Player rows for observer + every participant (game entities exist
  // independent of accounts, §4.1). Battlelog names fill NULLs only —
  // roster/profile observations stay authoritative for known players.
  const nameByTag = new Map();
  for (const p of parts.values()) {
    if (p.name && !nameByTag.has(p.player_tag))
      nameByTag.set(p.player_tag, p.name);
  }
  const tags = [
    ...new Set([observer, ...[...parts.values()].map((p) => p.player_tag)]),
  ];
  await db.query(
    `insert into player (player_tag, name)
     select t.tag, t.name from unnest($1::text[], $2::text[]) as t(tag, name)
     on conflict (player_tag) do update set
       last_seen_at = now(),
       name = coalesce(player.name, excluded.name)`,
    [tags, tags.map((t) => nameByTag.get(t) ?? null)],
  );

  let battlesInserted = 0;
  if (battles.size > 0) {
    // Deterministic lock order: concurrent observers of the SAME battles
    // (concurrency 4) otherwise acquire row locks in payload order and
    // stall each other — censused live as a 13s p99 on a 251ms p50.
    const battleRows = [...battles.values()].sort((a, z) =>
      a.battle_id < z.battle_id ? -1 : 1,
    );
    const { rows } = await db.query(
      insertManySql(
        "battle",
        BATTLE_COLS,
        "battle_id",
        BATTLE_ENRICH,
        battleRows.length,
      ),
      battleRows.flatMap((b) => paramValues(BATTLE_COLS, b)),
    );
    battlesInserted = rows.filter((r) => r.inserted).length;

    const partRows = [...parts.keys()].sort().map((k) => parts.get(k));
    await db.query(
      insertManySql(
        "battle_participant",
        PARTICIPANT_COLS,
        "battle_id, player_tag",
        PARTICIPANT_ENRICH,
        partRows.length,
      ),
      partRows.flatMap((p) => paramValues(PARTICIPANT_COLS, p)),
    );

    await db.query(
      `insert into battle_observation (battle_id, observer_tag, receipt_id)
       select unnest($1::text[]), $2, $3 on conflict do nothing`,
      [[...battles.keys()], observer, receiptId],
    );
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
