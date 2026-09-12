import { deckHash } from "@elixir-mcp/contracts";

/** The player's active deck (0080): the eight currentDeck slots of a
 *  profile payload, hashed the way battle decks are (order-insensitive,
 *  form-aware, level-blind). Written only when the hash moves, so a
 *  profile poll that shows the same deck writes nothing and observed_at
 *  says when THIS deck first appeared - which is what a Verify challenge
 *  needs: proof observed after the brief. Replays (an older payload
 *  landing later) never regress the row. */
export async function projectCurrentDeck(
  db,
  { playerTag, payload, fetchedAt, receiptId = null },
) {
  const slots = Array.isArray(payload?.currentDeck) ? payload.currentDeck : [];
  const cards = slots
    .filter((c) => Number.isInteger(c?.id))
    .map((c) => ({
      id: c.id,
      ...(Number.isInteger(c.level) ? { level: c.level } : {}),
      ...(Number.isInteger(c.evolutionLevel)
        ? { evolutionLevel: c.evolutionLevel }
        : {}),
    }));
  if (cards.length === 0) return { changed: 0 };
  const support = Array.isArray(payload?.currentDeckSupportCards)
    ? payload.currentDeckSupportCards
    : [];
  const hash = deckHash({
    cards: cards.map((c) => ({ id: c.id, evolutionLevel: c.evolutionLevel })),
    towerTroopId: Number.isInteger(support[0]?.id) ? support[0].id : undefined,
  });
  const { rowCount } = await db.query(
    `insert into player_current_deck (player_tag, cards, deck_hash, observed_at, receipt_id)
     values ($1, $2::jsonb, $3, $4::timestamptz, $5)
     on conflict (player_tag) do update set
       cards = excluded.cards, deck_hash = excluded.deck_hash,
       observed_at = excluded.observed_at, receipt_id = excluded.receipt_id
     where player_current_deck.observed_at < excluded.observed_at
       and player_current_deck.deck_hash is distinct from excluded.deck_hash`,
    [playerTag, JSON.stringify(cards), hash, fetchedAt, receiptId],
  );
  return { changed: rowCount };
}
