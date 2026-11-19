/** The roster projector and leader confirmation serialize on the same player
 * lock. Only observations admitted by the new projector enter this ledger. */
export const visibleClanInteractionSql = (
  alias,
  reader,
) => `(${alias}.audience_clan is null or exists(
    select 1 from claim seat join clan_membership cm on cm.player_tag=seat.player_tag and cm.left_observed_at is null
    where seat.account_id=${reader} and seat.status='verified' and (seat.is_primary or seat.relationship in ('primary','alt'))
      and cm.clan_tag=${alias}.audience_clan))`;

export async function observeLifecycle(
  db,
  { clan, tag, name, kind, stay, at, eventId, size },
) {
  const args = [clan, tag, stay, kind, at, eventId, name, size];
  const {
    rows: [prior],
  } = await db.query(
    `select coalesce(max(event_id),0) as id from clan_event where clan_tag=$1 and player_tag=$2
       and event_type='role_changed' and window_end >= $3 and window_end < $4`,
    [clan, tag, stay, at],
  );
  args.push(prior.id);
  // A late observation that missed the leader's window stands on its own.
  const matched = await db.query(
    `with candidates as (select occasion_id from clan_lifecycle where clan_tag=$1 and player_tag=$2 and stay_at=$3 and kind=$4 and event_id is null
      and (kind='departure' or prior_role_id=$9) and $5 between reported_at and match_until)
    update clan_lifecycle set event_id=$6, observed_at=$5,player_name=$7,roster_size=$8
      where occasion_id=(select min(occasion_id) from candidates having count(*)=1) returning occasion_id`,
    args,
  );
  if (!matched.rowCount)
    await db.query(
      `insert into clan_lifecycle
    (clan_tag,player_tag,stay_at,kind,observed_at,event_id,player_name,roster_size,prior_role_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(event_id) do nothing`,
      args,
    );
}
