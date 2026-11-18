/** A display copy of an eight-card deck in Evo, Hero, Wild order.
 * Recorded API slots and canonical deck identity remain untouched. Only
 * played forms and catalog rarity identify special cards; ownership,
 * capability and artwork do not. This does not infer unlocked slots.
 */
export function deckDisplayCards<
  T extends { id: number; form?: string | null; rarity?: string | null },
>(
  cards: readonly T[],
  rarityOf?: (id: number) => string | null | undefined,
): T[] {
  if (cards.length !== 8) return [...cards];
  const indexed = cards.map((card, index) => ({ card, index }));
  const evos = indexed.filter(({ card }) => card.form === "evolution");
  const heroes = indexed.filter(
    ({ card }) =>
      card.form !== "evolution" &&
      (card.form === "hero" ||
        (card.rarity ?? rarityOf?.(card.id)) === "champion"),
  );
  // Historical and special-mode decks can exceed the current three-slot
  // layout. Keep their recorded order rather than imply a legal layout.
  if (evos.length > 2 || heroes.length > 2 || evos.length + heroes.length > 3)
    return [...cards];
  if (evos.length + heroes.length === 0) return [...cards];
  const slots = [evos[0], heroes[0], evos[1] ?? heroes[1]];
  const used = new Set(slots.filter(Boolean).map((entry) => entry!.index));
  const rest = indexed.filter((entry) => !used.has(entry.index));
  return [...slots.map((entry) => entry ?? rest.shift()!), ...rest].map(
    ({ card }) => card,
  );
}
