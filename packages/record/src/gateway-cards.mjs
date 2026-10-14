import { cardArt } from "@elixir-mcp/contracts";

/**
 * Card avatars (0019): every collector is a Clash Royale card, and the
 * card is its public name. Since 0078 the OPERATOR picks it (Jamie,
 * 2026-09-11: people have favourite cards), and a card is one live
 * collector's - the partial unique index is the arbiter, so two picks
 * racing for one card resolve in the database, not here.
 *
 * A collector raised without a pick still gets one: a deterministic
 * choice among the FREE cards, persisted on first read so catalog
 * reordering never reassigns. Shared by the web routes and the
 * elixir_collectors tool - the two doors must show the same fleet.
 * Lazy bookkeeping write, same class as audit rows: never breaks a
 * read if it fails.
 */

/** Derive current mirror art on read, including collectors whose stored
 * avatar predates the mirror. Never fall back to a stored CDN address. */
export function gatewayCardIcon({ card_id, icon_medium }) {
  return card_id == null
    ? null
    : (cardArt(Number(card_id), { medium: icon_medium })?.base ?? null);
}

/** Keep catalog-only join columns out of collector responses. */
export function gatewayCardView({ card_id, icon_medium, ...gateway }) {
  return { ...gateway, card_icon: gatewayCardIcon({ card_id, icon_medium }) };
}

/** The pickable catalog with who holds what: kind = 'card' only (tower
 *  troops are not a face), in catalog order. */
export async function gatewayCardCatalog(db) {
  const { rows } = await db.query(
    `select c.name, c.card_id, c.icon_medium, c.rarity, c.elixir_cost,
            (g.gateway_id is not null) as taken
     from card c
     left join gateway g on g.card_name = c.name and g.status <> 'revoked'
     where c.kind = 'card'
     order by c.card_id`,
  );
  return rows.map((r) => ({
    name: r.name,
    icon: gatewayCardIcon(r),
    rarity: r.rarity ?? null,
    elixir_cost: r.elixir_cost ?? null,
    taken: r.taken === true,
  }));
}

/** Resolve a pick to a catalog row, or say why not: `unknown_card` for
 *  a name not in the catalog, `card_taken` when a live collector holds
 *  it. The caller still handles the unique violation on write - two
 *  operators can pass this check together and only one can win. */
export async function resolveGatewayCard(db, name) {
  const { rows } = await db.query(
    `select c.name, c.card_id, c.icon_medium,
            (select g.gateway_id from gateway g
             where g.card_name = c.name and g.status <> 'revoked' limit 1) as holder
     from card c where c.kind = 'card' and lower(c.name) = lower($1)`,
    [String(name ?? "")],
  );
  if (!rows[0]) return { error: "unknown_card" };
  if (rows[0].holder) return { error: "card_taken", holder: rows[0].holder };
  return { card: { name: rows[0].name, icon: gatewayCardIcon(rows[0]) } };
}

/** Postgres unique_violation on the live-card index. */
export const isCardTakenError = (err) =>
  err?.code === "23505" &&
  /gateway_card_name_live_uniq/.test(err?.constraint ?? err?.message ?? "");

export async function ensureGatewayCards(db) {
  const { rows: bare } = await db.query(
    `select gateway_id from gateway
     where card_name is null and status <> 'revoked' limit 20`,
  );
  if (bare.length === 0) return;
  for (const g of bare) {
    // Re-read the free set per collector: each assignment shrinks it.
    const { rows: free } = await db.query(
      `select c.name, c.card_id, c.icon_medium from card c
       where c.kind = 'card'
         and not exists (select 1 from gateway g
                         where g.card_name = c.name and g.status <> 'revoked')
       order by c.card_id`,
    );
    if (!free.length) return;
    const n = parseInt(g.gateway_id.replaceAll("-", "").slice(0, 8), 16);
    const card = free[n % free.length];
    try {
      await db.query(
        `update gateway set card_name = $2, card_icon = $3
         where gateway_id = $1 and card_name is null`,
        [g.gateway_id, card.name, gatewayCardIcon(card)],
      );
    } catch (err) {
      // A concurrent read or a pick took it first; the next read tries
      // again with what is left.
      if (!isCardTakenError(err)) throw err;
    }
  }
}
