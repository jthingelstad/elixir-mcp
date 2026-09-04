/**
 * Card avatars (0019): deterministic pick from the recorded catalog,
 * persisted on first read so catalog reordering never reassigns.
 * Shared by the web ladder route and the elixir_collectors tool — the
 * two doors must show the same fleet. Lazy bookkeeping write, same
 * class as audit rows: never breaks a read if it fails.
 */
export async function ensureGatewayCards(db) {
  const { rows: bare } = await db.query(
    `select gateway_id from gateway where card_name is null limit 20`,
  );
  if (bare.length === 0) return;
  const { rows: cat } = await db.query(
    `select payload_json->'items' as items from api_payload
     where endpoint = 'cards' and entity_key = 'GLOBAL'
     order by last_fetched_at desc limit 1`,
  );
  const items = cat[0]?.items;
  if (!items?.length) return;
  for (const g of bare) {
    const n = parseInt(g.gateway_id.replaceAll("-", "").slice(0, 8), 16);
    const card = items[n % items.length];
    await db.query(
      `update gateway set card_name = $2, card_icon = $3
       where gateway_id = $1 and card_name is null`,
      [g.gateway_id, card.name, card.iconUrls?.medium ?? null],
    );
  }
}
