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
import { OPEN_MS } from "./sync.mjs";

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

/** A sitting is over once its player's last battle is this old (the
 *  timeline's SESSION_GAP_MS, 30 minutes), and a minute for the read. */
const SITTING_QUIET_MS = 31 * 60_000;
/** A quiet sitting's account is woken at most once in this long. */
const SITTING_WAKE_EVERY_MS = 15 * 60_000;

/**
 * The closing edit of a sitting told while open (#454). An admission
 * wakes the sync, but a sitting closes when nothing more happens, so no
 * admission comes to drop "still going" from its line. The accounts with
 * a sitting told open whose player has played nothing for
 * SITTING_QUIET_MS (measured from the last battle, not from when the
 * line was told, so a sitting told late closes as soon) are woken (one timeline-sync object each, at most once a quarter hour),
 * and the sync reads the sitting again from its start and edits it
 * closed. This wakes only accounts that already have a line waiting to
 * close: it is not a poll of the timeline. A wake that finds the sitting
 * still open changes nothing; the sync stops reading a sitting OPEN_MS
 * after it began, and so does this.
 */
export async function wakeClosingSittings(db, { outbox, now = Date.now() }) {
  if (!outbox) return 0;
  const { rows } = await db.query(
    `select distinct t.account_id
       from timeline_discord_told t
       join timeline_discord d on d.account_id = t.account_id and d.enabled
      where t.open_from > $1 and t.open_player is not null
        and coalesce(
              (select max(bp.battle_time) from battle_participant bp
                where bp.player_tag = t.open_player
                  and bp.battle_time >= t.open_from
                  and bp.battle_time <= $3),
              t.open_from) < $2`,
    [new Date(now - OPEN_MS), new Date(now - SITTING_QUIET_MS), new Date(now)],
  );
  const slot = Math.floor(now / SITTING_WAKE_EVERY_MS);
  for (const { account_id } of rows)
    await outbox(
      "timeline-sync",
      { v: 1, account_id },
      { id: `${account_id}.sitting.${slot}`, once: true },
    );
  return rows.length;
}
