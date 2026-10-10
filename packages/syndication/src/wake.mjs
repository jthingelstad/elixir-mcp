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
 *  never fails a submission on it; so does Elixir Clan after a leader's
 *  attested fact (a departure's answer, an award), which no collector
 *  admits.
 *
 *  A clan that posts its activity to a channel of its own (Clan
 *  Settings, Social) is woken the same way, by its own tag or a
 *  member's. */
import { clanWakeId } from "./clan-sync.mjs";

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

/** The clans posting their activity to a channel of their own (Clan
 *  Settings, Social) that `tag` reaches: the clan itself, or the clan a
 *  member is in (or left within the day). */
export async function clansToWake(db, tag) {
  if (!tag) return [];
  const { rows } = await db.query(
    `select d.clan_tag from clan_activity_discord d
      where d.enabled
        and (d.clan_tag = $1
          or d.clan_tag in (
               select cm.clan_tag from clan_membership cm
                where cm.player_tag = $1
                  and (cm.left_observed_at is null
                       or cm.left_observed_at > now() - interval '1 day')))`,
    [tag],
  );
  return rows.map((r) => r.clan_tag);
}

/** Wake them: one timeline-sync outbox object each, for every account
 *  and every clan channel `tag` reaches. */
export async function wakeSyndication(db, tag, { outbox, now = Date.now() }) {
  if (!outbox) return 0;
  const accounts = await accountsToWake(db, tag);
  const clans = await clansToWake(db, tag);
  const minute = Math.floor(now / 60_000);
  for (const accountId of accounts)
    await outbox(
      "timeline-sync",
      { v: 1, account_id: accountId },
      { id: `${accountId}.${minute}`, once: true },
    );
  for (const clanTag of clans)
    await outbox(
      "timeline-sync",
      { v: 1, clan_tag: clanTag },
      { id: `${clanWakeId(clanTag)}.${minute}`, once: true },
    );
  return accounts.length + clans.length;
}

/** After an attested fact about a clan is written (a leader's word on a
 *  departure, an award): wake what that clan reaches. `fact` is the
 *  writer's answer; never fails the write it follows. */
export async function wakeAfterFact(db, fact, { outbox, now = Date.now() }) {
  const clanTag = fact?.subject?.clan_tag;
  if (!outbox || !clanTag) return 0;
  try {
    return await wakeSyndication(db, clanTag, { outbox, now });
  } catch (err) {
    console.error("syndication_wake_failed", err?.code ?? err?.name ?? "error");
    return 0;
  }
}
