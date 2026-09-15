/**
 * Tests that seed a battle by hand write what a participant played the
 * way ingest does: a deck row (identity), its deck_card rows and the
 * battle_participant_card rows, with catalog stubs for cards the test
 * never loaded. The participant row itself is the test's to insert with
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
  }
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

  return hash;
}
