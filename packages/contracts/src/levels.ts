/**
 * Card-level normalization — THE conversion (single definition, golden
 * rule 5; the elixir-bot scar imported whole: convert at the seam so no
 * raw level exists past it, because API levels are rarity-relative — a
 * maxed epic reports 11/11, a maxed legendary 8/8, and the game shows
 * both as 16/16).
 *
 *   display = level + (MAX_DISPLAY_LEVEL - maxLevel)
 *
 * Gap arithmetic ("2 from max") is invariant: both level and cap shift
 * by the same constant. Applies to support (tower troop) cards too.
 * Truth source: cr-agent-api-docs/cards.md rarity table.
 */

export const MAX_DISPLAY_LEVEL = 16;

/** Convert one API card level to the in-game display scale. */
export function displayLevel(level: number, maxLevel: number): number {
  return level + (MAX_DISPLAY_LEVEL - maxLevel);
}

/** Normalize a card object in place-ish: display level, uniform cap. */
export function displayCard<T extends { level?: number; maxLevel?: number }>(
  card: T,
): T {
  if (typeof card.level !== "number" || typeof card.maxLevel !== "number") {
    return card;
  }
  return {
    ...card,
    level: displayLevel(card.level, card.maxLevel),
    maxLevel: MAX_DISPLAY_LEVEL,
  };
}
