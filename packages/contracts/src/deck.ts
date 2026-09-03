/**
 * Deck identity — DESIGN §3 contract discipline.
 *
 * deck_hash = sha256 over the canonical deck string:
 *   sorted "cardId:evolutionLevel" pairs (evolutionLevel 0 when absent)
 *   joined with ",", then "|" and the tower troop card id (0 when absent).
 *
 * Form discriminators are part of identity: evolution_level encodes card
 * FORM (1 = Evo, 2 = Hero), never a level — two forms of a card are two
 * different deck slots. Card levels and star levels are NOT part of
 * identity: upgrading a card does not change which deck it is.
 */

import { createHash } from "node:crypto";

export interface DeckCard {
  id: number;
  /** CR form discriminator: absent/0 = base form, 1 = Evolution, 2 = Hero. */
  evolutionLevel?: number;
}

export interface DeckIdentity {
  cards: DeckCard[];
  /** Tower troop card id; absent for battles predating tower troops. */
  towerTroopId?: number;
}

/** The canonical pre-hash string. Exposed for tests and debugging. */
export function canonicalDeckString(deck: DeckIdentity): string {
  const pairs = deck.cards
    .map((c) => `${c.id}:${c.evolutionLevel ?? 0}`)
    .sort();
  return `${pairs.join(",")}|${deck.towerTroopId ?? 0}`;
}

export function deckHash(deck: DeckIdentity): string {
  return createHash("sha256").update(canonicalDeckString(deck)).digest("hex");
}
