/** Proof and optional art for a page of players, from verifiedAccount's rule.
 * Missing art does not erase proof. Website and email projections share this read;
 * MCP tools and /api/v1 retain their existing outputs. */
export async function verifiedPlayerIdentities(db, tags) {
  const list = [
    ...new Set((tags ?? []).filter((t) => typeof t === "string" && t)),
  ];
  if (!list.length) return new Map();
  const { rows } = await db.query(
    `select distinct on (c.player_tag) c.player_tag, a.avatar_card_id
       from claim c join account a using (account_id)
      where c.player_tag = any($1::text[]) and c.status = 'verified'
        and (c.is_primary or c.relationship in ('primary', 'alt'))
        and coalesce(a.kind, 'person') = 'person'
      order by c.player_tag, c.verified_at`,
    [list],
  );
  return new Map(
    rows.map((r) => [
      r.player_tag,
      { verified: true, avatar_card_id: r.avatar_card_id },
    ]),
  );
}
