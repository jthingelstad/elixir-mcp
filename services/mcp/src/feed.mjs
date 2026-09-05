/**
 * The push lane's write side. Subscriptions are implicit — an
 * account's claims, recordings, and feedback are its subscriptions —
 * so emitters fan out to the interested accounts at write time.
 * Failures never break the action being recorded (same stance as the
 * activity log).
 */

export const FEED_TOPICS = [
  "battles_recorded",
  "feedback_responded",
  "recording_started",
  "recording_stopped",
  "role_changed",
  "clan_war_week_finished",
];

/** Emit one event to one account. */
export async function emitFeedEvent(db, accountId, topic, subjectTag, payload) {
  await db
    .query(
      `insert into event_feed (account_id, topic, subject_tag, payload)
       values ($1, $2, $3, $4)`,
      [accountId, topic, subjectTag, payload ? JSON.stringify(payload) : null],
    )
    .catch(() => {});
}

/** Fan a player-subject event out to every account subscribed to the
 *  tag (a claim on it, or an active recording it requested). */
export async function emitToTagWatchers(db, playerTag, topic, payload) {
  await db
    .query(
      `insert into event_feed (account_id, topic, subject_tag, payload)
       select account_id, $2, $1, $3 from (
         select c.account_id from claim c where c.player_tag = $1
         union
         select r.requested_by from recording r
         where r.subject_type = 'player' and r.subject_tag = $1
           and r.status = 'active' and r.requested_by is not null
       ) subs`,
      [playerTag, topic, payload ? JSON.stringify(payload) : null],
    )
    .catch(() => {});
}

/** Fan a clan-subject event out to accounts watching the clan (an
 *  active clan recording they requested, or a claimed member). */
export async function emitToClanWatchers(db, clanTag, topic, payload) {
  await db
    .query(
      `insert into event_feed (account_id, topic, subject_tag, payload)
       select account_id, $2, $1, $3 from (
         select r.requested_by as account_id from recording r
         where r.subject_type = 'clan' and r.subject_tag = $1
           and r.status = 'active' and r.requested_by is not null
         union
         select c.account_id from claim c
         join clan_membership cm on cm.player_tag = c.player_tag
           and cm.left_observed_at is null
         where cm.clan_tag = $1
       ) subs`,
      [clanTag, topic, payload ? JSON.stringify(payload) : null],
    )
    .catch(() => {});
}

/** battles_recorded is high-volume for heavy watchers, so it coalesces:
 *  any UNREAD battles_recorded row for the same (account, tag) is
 *  folded into the new event (counts summed, fresh event_id at the
 *  cursor tail). Rows already read are never touched — an account sees
 *  at most one unread row per tag, with a running count. Call this
 *  AFTER the ingest transaction commits: an error inside a txn aborts
 *  the whole txn, so the swallow-catch is only safe outside one. */
export async function emitBattlesRecorded(db, playerTag, count) {
  await db
    .query(
      `with subs as (
         select c.account_id from claim c where c.player_tag = $1
         union
         select r.requested_by from recording r
         where r.subject_type = 'player' and r.subject_tag = $1
           and r.status = 'active' and r.requested_by is not null
       ),
       folded as (
         delete from event_feed ef
         using account a
         where a.account_id = ef.account_id
           and ef.account_id in (select account_id from subs)
           and ef.topic = 'battles_recorded'
           and ef.subject_tag = $1
           and ef.event_id > a.events_seen_through
         returning ef.account_id,
                   coalesce((ef.payload->>'count')::int, 0) as prior
       ),
       folded_sum as (
         select account_id, sum(prior)::int as prior
         from folded group by account_id
       )
       insert into event_feed (account_id, topic, subject_tag, payload)
       select s.account_id, 'battles_recorded', $1,
              jsonb_build_object('count', $2::int + coalesce(f.prior, 0))
       from subs s
       left join folded_sum f on f.account_id = s.account_id`,
      [playerTag, count],
    )
    .catch(() => {});
}
