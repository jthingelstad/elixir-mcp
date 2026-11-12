/** Who a reader is to the names in a mail (packages/mail, render.mjs): their
 *  own players and the clans those players are in today. A player's name
 *  opens the player page for every reader (Jamie, 2026-11-12, #764), so who
 *  else is in those clans is no longer read. Facts are composed once for
 *  every reader; this is read per reader and never stored with them.
 *
 *  Two answers on purpose. `memberClans` picks links, and any primary or alt
 *  claim counts, because the page behind a link makes its own check.
 *  `verifiedClans` admits a reader to clan-visible facts, with the check
 *  `factItems` makes (packages/tools, activity/entries.mjs): anyone can claim
 *  a member's tag, so only a verified claim counts. */
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
  const { rows: seats } = await db.query(
    `select distinct cm.clan_tag
       from account a
       join claim c
         on c.account_id = coalesce(a.owned_by_account_id, a.account_id)
       join clan_membership cm
         on cm.player_tag = c.player_tag and cm.left_observed_at is null
      where a.account_id = $1 and c.status = 'verified'`,
    [accountId],
  );
  const verifiedClans = seats.map((r) => r.clan_tag);
  return { tags, memberClans, verifiedClans };
}
