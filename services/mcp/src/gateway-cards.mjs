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
  const { rows: items } = await db.query(
    `select name, icon_urls->>'medium' as icon from card
     where kind = 'card' order by card_id`,
  );
  if (!items.length) return;
  for (const g of bare) {
    const n = parseInt(g.gateway_id.replaceAll("-", "").slice(0, 8), 16);
    const card = items[n % items.length];
    await db.query(
      `update gateway set card_name = $2, card_icon = $3
       where gateway_id = $1 and card_name is null`,
      [g.gateway_id, card.name, card.icon ?? null],
    );
  }
}
