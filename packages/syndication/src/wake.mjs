/** The event that starts a sync (Jamie, 2026-10-10: "event driven, WHEN
 *  items arrive in the timeline. Not polling"). An admission that wrote
 *  new facts about a tag wakes every account cross-posting a timeline
 *  that tag reaches: a player it follows, the clan it follows, a clan
 *  that player is in, or (for a clan's admission) a player of its who
 *  is in that clan. A superset is fine, since a sync that finds nothing
 *  new posts nothing; a miss would be a lost post.
 *
 *  A wake is one outbox object per account per minute (written once),
 *  and the queue holds it a minute before the sync runs, so a burst of
 *  admissions is one sync. The collector calls this after its commit and
 *  never fails a submission on it. */

const WAKE_SQL = `
  select d.account_id from timeline_discord d
   where d.enabled
     and (exists (select 1 from claim c
                   where c.account_id = d.account_id and c.notify
                     and c.player_tag = $1)
       or exists (select 1 from account_clan ac
                   where ac.account_id = d.account_id and ac.notify
                     and (ac.clan_tag = $1
                       or ac.clan_tag in (
                            select cm.clan_tag from clan_membership cm
                             where cm.player_tag = $1
                               and (cm.left_observed_at is null
                                    or cm.left_observed_at > now() - interval '1 day'))))
       or exists (select 1 from claim c
                    join clan_membership cm on cm.player_tag = c.player_tag
                   where c.account_id = d.account_id and c.notify
                     and cm.clan_tag = $1
                     and (cm.left_observed_at is null
                          or cm.left_observed_at > now() - interval '1 day')))`;

/** The accounts whose cross-posted timeline `tag` reaches. */
export async function accountsToWake(db, tag) {
  if (!tag) return [];
  const { rows } = await db.query(WAKE_SQL, [tag]);
  return rows.map((r) => r.account_id);
}

/** Wake them: one timeline-sync outbox object each. */
export async function wakeSyndication(db, tag, { outbox, now = Date.now() }) {
  if (!outbox) return 0;
  const accounts = await accountsToWake(db, tag);
  const minute = Math.floor(now / 60_000);
  for (const accountId of accounts)
    await outbox(
      "timeline-sync",
      { v: 1, account_id: accountId },
      { id: `${accountId}.${minute}`, once: true },
    );
  return accounts.length;
}
