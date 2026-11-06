/** Who a reader is to the names in a mail, for the render's one door per name
 *  (packages/mail, render.mjs): their own players, the clans those players are
 *  in today, and who else is in those clans. Facts are composed once for every
 *  reader; this is read per reader and never stored with them. */
export async function readerDoors(db, accountId) {
  const { rows: own } = await db.query(
    `select c.player_tag, m.clan_tag
       from claim c
       left join clan_membership m
         on m.player_tag = c.player_tag and m.left_observed_at is null
      where c.account_id = $1 and (c.is_primary or c.relationship = 'alt')`,
    [accountId],
  );
  const tags = [...new Set(own.map((r) => r.player_tag))];
  const memberClans = [...new Set(own.map((r) => r.clan_tag).filter(Boolean))];
  if (!memberClans.length) return { tags, memberClans, clanmates: {} };
  const { rows: mates } = await db.query(
    `select player_tag, clan_tag from clan_membership
      where clan_tag = any($1::text[]) and left_observed_at is null`,
    [memberClans],
  );
  const clanmates = {};
  for (const r of mates) clanmates[r.player_tag] = r.clan_tag;
  return { tags, memberClans, clanmates };
}
