/** Who a reader is to the names in a mail (packages/mail, render.mjs): their
 *  own players and the clans those players are in today. A player's name
 *  opens the player page for every reader (Jamie, 2026-11-12, #764), so who
 *  else is in those clans is no longer read. Facts are composed once for
 *  every reader; this is read per reader and never stored with them.
 *
 *  `memberClans` picks links, and any primary or alt claim counts,
 *  because the page behind a link makes its own check. */
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
  return { tags, memberClans };
}
