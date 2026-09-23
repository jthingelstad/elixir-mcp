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
 *  - outcome precedence: boatBattleWon -> trophyChange sign (only when the
 *    two sides moved OPPOSITE ways; Path of Legends penalises both players
 *    for a draw) -> crown compare -> unresolved.
 *
 * `side` semantics: 0/1 labels partition participants into their two teams
 * correctly, but WHICH team is 0 depends on whichever observer's log was
 * ingested first (team=0 from that log's perspective). The labels are
 * arbitrary; the partition is the fact. Readers must never assume side 0
 * means "the subject" — locate subjects by tag (§4.4 team[0] trap).
 */

import { createHash } from "node:crypto";
import { normalizeTag, deckHash, displayLevel } from "@elixir-mcp/contracts";
import {
  projectDecks,
  projectPlayedCards,
  projectRounds,
} from "./deck-cards.mjs";
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
  // Some event formats disclose no deck (cards: []); an empty list is
  // captured as given but is not an identity (0093).
  if (cards.length === 0) return { deck, hash: null };
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

/** A duel's rounds, one row per game (0151). `round` is 1-based to match
 *  battle_participant_card.round, which already holds that round's deck.
 *  Empty for every battle the API does not report rounds for. */
function roundRows(entry) {
  if (!Array.isArray(entry.rounds)) return [];
  return entry.rounds.map((r, i) => ({
    round: i + 1,
    crowns: Number.isInteger(r?.crowns) ? r.crowns : null,
    ...towerColumns(r ?? {}),
    elixir_leaked: typeof r?.elixirLeaked === "number" ? r.elixirLeaked : null,
  }));
}

/** The three tower columns (0123): 0 = destroyed (the API omits a
 *  destroyed tower from the array), null = not carried. */
function towerColumns(entry) {
  const p = Array.isArray(entry.princessTowersHitPoints)
    ? entry.princessTowersHitPoints
    : null;
  return {
    king_tower_hp: Number.isInteger(entry.kingTowerHitPoints)
      ? entry.kingTowerHitPoints
      : null,
    princess_tower_hp_1: p ? (Number.isInteger(p[0]) ? p[0] : 0) : null,
    princess_tower_hp_2: p ? (Number.isInteger(p[1]) ? p[1] : 0) : null,
  };
}

function sideCrowns(entries) {
  const values = entries
    .map((e) => e.crowns)
    .filter((c) => typeof c === "number");
  return values.length > 0 ? Math.max(...values) : undefined;
}

function sideTrophyChange(entries) {
  const values = entries
    .map((e) => e.trophyChange)
    .filter((t) => typeof t === "number" && t !== 0);
  return values.length > 0 ? values[0] : undefined;
}

/** Games won and lost in a duel, from each side's rounds[] crowns;
 *  null when either side carries no rounds. */
function duelGames(entry, otherSide) {
  const mine = Array.isArray(entry.rounds) ? entry.rounds : [];
  const theirs = Array.isArray(otherSide[0]?.rounds) ? otherSide[0].rounds : [];
  if (mine.length === 0 || theirs.length === 0) return null;
  let won = 0;
  let lost = 0;
  for (let i = 0; i < Math.min(mine.length, theirs.length); i++) {
    const a = mine[i]?.crowns;
    const b = theirs[i]?.crowns;
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    if (a > b) won += 1;
    else if (a < b) lost += 1;
  }
  return { won, lost };
}

function outcomeFor(entry, ownSide, otherSide, battle, isTeamSide) {
  if (battle.type?.startsWith("boatBattle")) {
    if (typeof battle.boatBattleWon === "boolean") {
      return battle.boatBattleWon === isTeamSide ? "win" : "loss";
    }
    return "unresolved";
  }
  // A duel is best of three GAMES (Gym #95): who won more of them won
  // the duel. Its top-level crowns are the sum across games, so a 0-3,
  // 1-0, 1-0 duel is won 2-1 on games and "lost" 2-3 on crowns - and the
  // crowns rule below recorded 7 of 70 duels that way. The per-game
  // crowns ride rounds[] on both sides; only when they are missing, or
  // the games tie, do the summed crowns decide.
  if (/^riverRaceDuel/.test(String(battle.type ?? ""))) {
    const games = duelGames(entry, otherSide);
    if (games && games.won !== games.lost)
      return games.won > games.lost ? "win" : "loss";
  }
  // A decided battle moves the two sides in OPPOSITE directions. Path of
  // Legends penalises BOTH players for a draw (verified 2026-09-22 against
  // the raw payload: team crowns 3 king 0 trophyChange -15, opponent
  // crowns 3 king 0 trophyChange -14), so reading each side's sign on its
  // own labelled both of them 'loss' - a result the game cannot produce.
  // Same-signed changes are not a verdict; fall through to the crowns,
  // which say draw.
  if (typeof entry.trophyChange === "number" && entry.trophyChange !== 0) {
    const other = sideTrophyChange(otherSide);
    const sameWay =
      typeof other === "number" &&
      Math.sign(other) === Math.sign(entry.trophyChange);
    if (!sameWay) return entry.trophyChange > 0 ? "win" : "loss";
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
        type_class: typeClass, // denormalized like battle_time (0095)
        type: entry.type, // and type (0099): filters read the participant
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
        deck, // not a column since 0097: the card rows are cut from it (deck-cards.mjs)
        deck_hash: hash,
        elixir_leaked: p.elixirLeaked ?? null,
        // Null unless the player was globally ranked at battle time
        // (0151): the API rides it on every participant of every battle.
        global_rank: Number.isInteger(p.globalRank) ? p.globalRank : null,
        // A duel's per-round results (0151). The top-level crowns are
        // their sum and the top-level tower hitpoints the final round's,
        // so without these a duel cannot answer "how did round two go".
        rounds: roundRows(p),
        ...towerColumns(p),
        outcome: outcomeFor(p, entries, otherEntries, entry, isTeamSide),
        clan_tag: p.clan?.tag ? normalizeTag(p.clan.tag) : null,
      });
    }
  }
  // The other side's deck level, stamped at the seam (0156): the mean of
  // its participants' deck_avg_level, nulls ignored, null when none -
  // what every level-gap reader used to compute per row at read time.
  for (const p of participants) {
    const levels = participants
      .filter((o) => o.side !== p.side && o.deck_avg_level !== null)
      .map((o) => o.deck_avg_level);
    p.opp_deck_avg_level = levels.length
      ? Number((levels.reduce((a, l) => a + l, 0) / levels.length).toFixed(4))
      : null;
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
      // The battle's own facts the log carries (0131, time-series review
      // 2.4): nullable, enriched like the rest; older rows are filled from
      // the battlelog receipts by the Phase 2 op.
      arena_id: Number.isInteger(entry.arena?.id) ? entry.arena.id : null,
      event_tag: typeof entry.eventTag === "string" ? entry.eventTag : null,
      tournament_tag:
        typeof entry.tournamentTag === "string" ? entry.tournamentTag : null,
      deck_selection:
        typeof entry.deckSelection === "string" ? entry.deckSelection : null,
      is_ladder_tournament:
        typeof entry.isLadderTournament === "boolean"
          ? entry.isLadderTournament
          : null,
      is_hosted_match:
        typeof entry.isHostedMatch === "boolean" ? entry.isHostedMatch : null,
      boat_battle_side:
        typeof entry.boatBattleSide === "string" ? entry.boatBattleSide : null,
      new_towers_destroyed: Number.isInteger(entry.newTowersDestroyed)
        ? entry.newTowersDestroyed
        : null,
      prev_towers_destroyed: Number.isInteger(entry.prevTowersDestroyed)
        ? entry.prevTowersDestroyed
        : null,
      remaining_towers: Number.isInteger(entry.remainingTowers)
        ? entry.remainingTowers
        : null,
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
  "arena_id",
  "event_tag",
  "tournament_tag",
  "deck_selection",
  "is_ladder_tournament",
  "is_hosted_match",
  "boat_battle_side",
  "new_towers_destroyed",
  "prev_towers_destroyed",
  "remaining_towers",
];
const BATTLE_KEY = ["battle_id", "battle_time", "type", "type_class"];
const BATTLE_ENRICH = BATTLE_COLS.filter((c) => !BATTLE_KEY.includes(c));

const PARTICIPANT_COLS = [
  "battle_id",
  "player_tag",
  "battle_time",
  "side",
  "type_class",
  "type",
  "crowns",
  "trophy_change",
  "starting_trophies",
  "deck_hash",
  "deck_avg_level",
  "opp_deck_avg_level",
  "elixir_leaked",
  "global_rank",
  "king_tower_hp",
  "princess_tower_hp_1",
  "princess_tower_hp_2",
  "outcome",
  "clan_tag",
];
const PARTICIPANT_KEY = [
  "battle_id",
  "player_tag",
  "battle_time",
  "side",
  "type_class",
  "type",
];
const PARTICIPANT_ENRICH = PARTICIPANT_COLS.filter(
  (c) => !PARTICIPANT_KEY.includes(c),
);

const JSONB_COLS = new Set();

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
// Upsert-and-enrich, touching a row only when it would change. Without the
// WHERE, Postgres writes a new tuple version for every conflicting row even
// when every coalesce() resolves to the value already there - and a
// battlelog is 25 battles resubmitted on every poll, so that was ~8 writes
// per real insert on battle and battle_participant (found 2026-09-11 when
// the t4g.micro swapped itself into a crash). Returns only the rows that
// were inserted or changed, keyed, so callers can tell which.
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
  const current = enrichCols.map((c) => `${table}.${c}`).join(", ");
  const resolved = enrichCols
    .map((c) => `coalesce(${table}.${c}, excluded.${c})`)
    .join(", ");
  return `insert into ${table} (${cols.join(", ")}) values ${rows.join(", ")}
          on conflict (${conflictTarget}) do update set ${sets}
          where (${current}) is distinct from (${resolved})
          returning ${conflictTarget}, (xmax = 0) as inserted`;
}

/**
 * Ingest one admitted battlelog payload for one observer.
 * Idempotent; at-least-once safe. Caller owns the transaction.
 */
/**
 * The observer's own arena, as far as this delivery can vouch for it (0101).
 *
 * A ladder battle's `arena` is the HIGHER side's arena, not the observer's:
 * a player thirty trophies under a gate meets people standing on it and
 * their own log names the next arena for those battles (checked live on
 * 2026-09-15 against three sub-6,000 players whose logs said Royal Crypt).
 * So only a battle the observer entered with at least the opponent's
 * trophies says where the OBSERVER stood. The newest such battle among
 * the ones this delivery INSERTED is the evidence; a resubmitted log inserts
 * nothing and vouches for nothing. Trophy Road only: no other type carries
 * a trophy arena.
 */
function observerArena(observer, writtenBattles, parts) {
  let newest = null;
  for (const b of writtenBattles) {
    if (b.type !== "PvP" || !b.arena) continue;
    const mine = parts.get(`${b.battle_id}|${observer}`);
    if (!mine || typeof mine.starting_trophies !== "number") continue;
    const others = [...parts.values()].filter(
      (p) => p.battle_id === b.battle_id && p.player_tag !== observer,
    );
    if (others.length !== 1) continue;
    const theirs = others[0].starting_trophies;
    if (typeof theirs !== "number" || mine.starting_trophies < theirs) continue;
    if (newest === null || b.battle_time > newest.battle_time)
      newest = { arena: b.arena, battle_time: b.battle_time };
  }
  return newest;
}

export async function ingestBattlelog(
  db,
  {
    observerTag,
    // receiptId is accepted for callers' sake and unused since the
    // battle_observation write went (2026-09-12).
    payload,
    highWater = false,
    collectorFilter = null,
  },
) {
  const observer = normalizeTag(observerTag);
  // The newest battle this observer's own log has delivered (0073). A
  // log is the last 25 battles, chronological and contiguous, so with
  // the mark known every battle at or before it was in an earlier
  // delivery and is dropped here before any table is touched. Replayed
  // history passes highWater: false and neither consults nor moves it.
  // The row's existence is also the coverage question the capture audit
  // asks - a first poll's all-new log is history arriving, not a gap -
  // which used to be a sequential scan of battle_observation per poll.
  // Read as text in the canonical second-precision ISO form battle_time
  // strings carry, so the comparison below is the same shape both sides.
  const { rows: hwRows } = await db.query(
    `select to_char(battle_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as mark
     from battlelog_high_water where observer_tag = $1`,
    [observer],
  );
  const mark = hwRows[0]?.mark ?? null;
  const hadPriorCoverage = mark !== null;
  let battlesSeen = 0;
  let battlesSkipped = 0;
  let newest = null; // the payload's newest battle_time, to advance the mark
  let oldest = null; // the payload's oldest, for the capture audit
  const affected = new Set(); // "tag|day" pairs for rollup refresh

  // Canonicalize everything first; the writes go out as one statement
  // per table (R1). Within-payload dedup matters: ON CONFLICT cannot
  // touch the same row twice in one statement.
  const battles = new Map(); // battle_id -> battle
  const parts = new Map(); // battle_id|tag -> participant row
  for (const entry of payload) {
    const { battle, participants } = canonicalizeBattle(entry);
    battlesSeen += 1;
    if (newest === null || battle.battle_time > newest.battle_time)
      newest = battle;
    if (oldest === null || battle.battle_time < oldest.battle_time)
      oldest = battle;
    if (highWater && mark !== null && battle.battle_time <= mark) {
      battlesSkipped += 1;
      continue;
    }
    battles.set(battle.battle_id, battle);
    for (const p of participants) {
      parts.set(`${battle.battle_id}|${p.player_tag}`, {
        ...p,
        battle_id: battle.battle_id,
        battle_time: battle.battle_time,
      });
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
       name = coalesce(player.name, excluded.name)
     where (player.name is null and excluded.name is not null)
        or player.last_seen_at < now() - interval '1 day'`,
    [tags, tags.map((t) => nameByTag.get(t) ?? null)],
  );

  let battlesInserted = 0;
  let oldestWasNew = false;
  let arenaEvidence = null;
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
    // The payload's oldest battle: if it was previously UNSEEN, the
    // rotating log may have rolled past battles we never captured.
    oldestWasNew = rows.some(
      (r) => r.inserted && r.battle_id === oldest.battle_id,
    );
    const changedBattles = new Set(rows.map((r) => r.battle_id));

    const insertedBattles = new Set(
      rows.filter((r) => r.inserted).map((r) => r.battle_id),
    );
    arenaEvidence = observerArena(
      observer,
      battleRows.filter((b) => insertedBattles.has(b.battle_id)),
      parts,
    );

    const partRows = [...parts.keys()].sort().map((k) => parts.get(k));
    // Deck identities first: battle_participant.deck_hash references
    // deck (0091). Catalog stubs for unknown cards land inside.
    await projectDecks(db, partRows);
    const { rows: partsWritten } = await db.query(
      insertManySql(
        "battle_participant",
        PARTICIPANT_COLS,
        "battle_id, player_tag",
        PARTICIPANT_ENRICH,
        partRows.length,
      ),
      partRows.flatMap((p) => paramValues(PARTICIPANT_COLS, p)),
    );
    // Rollups are derived from these rows, so only a (player, day) whose
    // battle or participant row was actually written needs recomputing.
    // Before this, every poll rebuilt every pair in the payload - 469k
    // rows deleted to keep 96k.
    for (const p of partRows)
      if (changedBattles.has(p.battle_id))
        affected.add(`${p.player_tag}|${p.battle_time.slice(0, 10)}`);
    for (const r of partsWritten)
      affected.add(
        `${r.player_tag}|${parts.get(`${r.battle_id}|${r.player_tag}`).battle_time.slice(0, 10)}`,
      );
    // What each written participant played, as rows (0091) - only for
    // rows that were inserted or changed, so a resubmission writes nothing.
    const writtenKeys = new Set(
      partsWritten.map((r) => `${r.battle_id}|${r.player_tag}`),
    );
    await projectPlayedCards(db, partRows, writtenKeys);
    // A duel's per-round results (0151), beside the round decks.
    await projectRounds(db, partRows, writtenKeys);

    // battle_observation is no longer written (2026-09-12): the receipt
    // carries what this poll saw and dropped (0074) and what it added
    // (0077), and battlelog_high_water carries coverage (0073). Nothing
    // read the table; provenance per battle stays in the archive under
    // payloads/endpoint=player_battlelog/entity=<observer>.
  }

  // Advance the mark past everything this delivery contained. Only a
  // live poll moves it (a replay is history); only forward.
  if (highWater && newest !== null) {
    await db.query(
      `insert into battlelog_high_water (observer_tag, battle_time)
       values ($1, $2)
       on conflict (observer_tag) do update
         set battle_time = excluded.battle_time, updated_at = now()
       where battlelog_high_water.battle_time < excluded.battle_time`,
      [observer, newest.battle_time],
    );
  }

  // The capture audit. With the mark known it is stated plainly: a log
  // whose oldest battle is newer than the mark has rolled past battles
  // this observer's log never delivered (the log holds 25; a gap of
  // exactly 25 new battles is indistinguishable and reads as a gap).
  // Without a mark (replay, or a live poll before 0073's seed) it is
  // the older rule: the oldest battle was previously unseen.
  // When the collector filtered under the mark, the payload is the new
  // battles only and its oldest is past the mark by construction; the
  // collector's counts say what it saw: nothing dropped means nothing in
  // the log was as old as the mark - the log rolled past what we had.
  const seen = collectorFilter ? collectorFilter.observed : battlesSeen;
  const gap = collectorFilter
    ? highWater && mark !== null && seen > 0 && collectorFilter.filtered === 0
    : highWater && mark !== null && oldest !== null
      ? oldest.battle_time > mark
      : oldestWasNew;
  return {
    battlesSeen: seen,
    battlesSkipped: battlesSkipped + (collectorFilter?.filtered ?? 0),
    battlesInserted,
    facts: battlesInserted,
    captureAudit:
      hadPriorCoverage && seen > 0
        ? { audited: true, gap }
        : { audited: false, gap: false },
    arenaEvidence,
    affectedPairs: [...affected].map((k) => {
      const [playerTag, day] = k.split("|");
      return { playerTag, day };
    }),
  };
}
