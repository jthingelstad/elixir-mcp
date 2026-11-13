/**
 * Tests that seed a battle by hand write what a participant played the
 * way ingest does: a deck row (identity), its deck_card rows and the
 * battle_participant_card rows, and the same cards as arrays on the
 * deck, participant and round rows (0255), with catalog stubs for cards
 * the test never loaded. The participant row itself is the test's to insert with
 * this deck_hash (hashFor), before or after - nothing here references it
 * until the closing FK lands.
 */
import { deckHash } from "@elixir-mcp/contracts";

/** The contract's identity for a card list: [{id, evolutionLevel?}] plus
 *  an optional tower troop id. */
export function hashFor(cards, towerTroopId) {
  return deckHash({
    cards: cards.map((c) => ({
      id: c.id,
      ...(c.evolutionLevel ? { evolutionLevel: c.evolutionLevel } : {}),
    })),
    ...(towerTroopId ? { towerTroopId } : {}),
  });
}

/**
 * Write the rows for one played deck.
 *   cards:        [{id, name?, level?, evolutionLevel?, starLevel?}] in slot order
 *   supportCards: [{id, name?, level?}] (tower troop), optional
 *   rounds:       [[cards], ...] for a duel instead of cards (no identity)
 * Returns the deck_hash (null for a duel).
 */
/** The identity half alone: catalog stubs, the deck row and its cards.
 *  A test that inserts a participant by hand with a deck_hash writes
 *  this FIRST, as ingest does (0108: the participant references the
 *  deck), then the participant, then seedPlayedDeck for the card rows
 *  (which reference the participant). Returns the deck_hash. */
export async function seedDeck(
  db,
  { battle_time = null, cards = [], supportCards = [], rounds = null },
) {
  const stubs = new Map();
  for (const c of cards)
    stubs.set(c.id, { name: c.name ?? `card ${c.id}`, kind: "card" });
  for (const c of supportCards)
    stubs.set(c.id, { name: c.name ?? `tower ${c.id}`, kind: "support" });
  for (const c of (rounds ?? []).flat())
    stubs.set(c.id, { name: c.name ?? `card ${c.id}`, kind: "card" });
  for (const [id, s] of stubs)
    await db.query(
      `insert into card (card_id, name, kind) values ($1, $2, $3) on conflict (card_id) do nothing`,
      [id, s.name, s.kind],
    );
  const at = battle_time ?? new Date().toISOString();
  let hash = null;
  if (!rounds && cards.length > 0) {
    hash = hashFor(cards, supportCards[0]?.id);
    await db.query(
      `insert into deck (deck_hash, tower_troop_id, card_count, first_seen_at, last_seen_at)
       values ($1, $2, $3, $4, $4)
       on conflict (deck_hash) do update set
         first_seen_at = least(deck.first_seen_at, excluded.first_seen_at),
         last_seen_at = greatest(deck.last_seen_at, excluded.last_seen_at)`,
      [hash, supportCards[0]?.id ?? null, cards.length, at],
    );
    for (const c of cards)
      await db.query(
        `insert into deck_card (deck_hash, card_id, form) values ($1, $2, $3) on conflict do nothing`,
        [hash, c.id, c.evolutionLevel ?? 0],
      );
    // The identity as arrays (0255), in canonical (card_id, form) order.
    const sorted = cards
      .map((c) => [c.id, c.evolutionLevel ?? 0])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    await db.query(
      `update deck set card_ids = $2::int[], card_forms = $3::smallint[]
        where deck_hash = $1`,
      [hash, sorted.map((c) => c[0]), sorted.map((c) => c[1])],
    );
  }
  return hash;
}

export async function seedPlayedDeck(
  db,
  {
    battle_id,
    player_tag,
    battle_time = null,
    cards = [],
    supportCards = [],
    rounds = null,
  },
) {
  const hash = await seedDeck(db, {
    battle_time,
    cards,
    supportCards,
    rounds,
  });
  const rows = rounds
    ? rounds.flatMap((r, i) =>
        r.map((c, slot) => ({ ...c, round: i + 1, slot: slot + 1 })),
      )
    : [
        ...cards.map((c, slot) => ({ ...c, round: 0, slot: slot + 1 })),
        ...supportCards.map((c) => ({ ...c, round: 0, slot: 0 })),
      ];
  for (const r of rows)
    await db.query(
      `insert into battle_participant_card
         (battle_id, player_tag, round, card_id, form, slot, level, star_level)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing`,
      [
        battle_id,
        player_tag,
        r.round,
        r.id,
        r.evolutionLevel ?? 0,
        r.slot,
        r.level ?? null,
        r.starLevel ?? null,
      ],
    );

  // The same cards as arrays on the rows that own them (0255), indexed
  // by slot: round 0 and the tower troop on the participant, a duel's
  // rounds on their round rows (which the test writes first).
  const arrays = (list) => ({
    cards: list.map((c) => c.id),
    forms: list.map((c) => c.evolutionLevel ?? 0),
    levels: list.map((c) => c.level ?? null),
    stars: list.map((c) => c.starLevel ?? null),
  });
  if (rounds) {
    for (const [i, r] of rounds.entries()) {
      const a = arrays(r);
      await db.query(
        `update battle_participant_round
            set cards = $4::int[], card_forms = $5::smallint[],
                card_levels = $6::smallint[], card_stars = $7::smallint[],
                cards_used = $8::boolean[]
          where battle_id = $1 and player_tag = $2 and round = $3`,
        [
          battle_id,
          player_tag,
          i + 1,
          a.cards,
          a.forms,
          a.levels,
          a.stars,
          r.map(() => null),
        ],
      );
    }
  } else if (cards.length > 0 || supportCards.length > 0) {
    const a = arrays(cards);
    const tower = supportCards[0] ?? null;
    await db.query(
      `update battle_participant
          set cards = $3::int[], card_forms = $4::smallint[],
              card_levels = $5::smallint[], card_stars = $6::smallint[],
              tower_troop_id = $7, tower_form = $8, tower_level = $9,
              tower_star = $10
        where battle_id = $1 and player_tag = $2`,
      [
        battle_id,
        player_tag,
        a.cards,
        a.forms,
        a.levels,
        a.stars,
        tower?.id ?? null,
        tower ? (tower.evolutionLevel ?? 0) : null,
        tower ? (tower.level ?? null) : null,
        tower ? (tower.starLevel ?? null) : null,
      ],
    );
  }
  return hash;
}
