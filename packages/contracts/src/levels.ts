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

/**
 * Alternate card forms — `evolutionLevel` / `maxEvolutionLevel` are a bit
 * field, never a progress counter or an ordinal (feedback #20, corroborated
 * 123/123 catalog cards against iconUrls on 2026-09-09: bit 1 <->
 * evolutionMedium, bit 2 <-> heroMedium). On a collection card
 * maxEvolutionLevel says which forms EXIST for the card and evolutionLevel
 * which the player has UNLOCKED; on a battle-deck card evolutionLevel is
 * the single form the card was PLAYED as (1 or 2, never 3).
 */
export const CARD_FORM_BITS = { evolution: 1, hero: 2 } as const;
export type CardForm = keyof typeof CARD_FORM_BITS;

/** Decode a form bit field into the forms it names; absent/0 = none. */
export function cardForms(value: number | null | undefined): CardForm[] {
  const bits = typeof value === "number" ? value : 0;
  return (Object.keys(CARD_FORM_BITS) as CardForm[]).filter(
    (form) => (bits & CARD_FORM_BITS[form]) !== 0,
  );
}
