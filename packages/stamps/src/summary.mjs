/**
 * A passport in one row (#1015): what a verified player's page shows of
 * its owner's passport.
 *
 *   { id, count, marks: [{ stamp_id, level }] }   (at most two marks)
 *
 * The owner is the canonical verified owner of the player, the same rule
 * as @elixir-mcp/tools/social verifiedAccount: the person account whose
 * verified primary or alt claim is the player, so a main and an alt give
 * the same passport. Its earned rows go through the public projection's
 * whitelist (projection.mjs publicEarned) before anything is counted, so
 * the row can carry nothing the public passport does not: no progress, no
 * profile list, no account id, no place.
 *
 * One statement, for the player page's statement budget. It reads 0269's
 * passport and earned tables beside store.mjs, read only, with the same
 * conditions as store.mjs readPublicPassport (an approved person account
 * holding the passport). An owner who has never opened their passport has
 * no row yet, and this read does not make one: null.
 */
import { publicEarned } from "./projection.mjs";

/** The two most recent marks and the count, from a projection's earned
 *  list (each Stamp once, at its highest level). A legacy grant sorts by
 *  the day it is known to precede. */
export function summarize(passport) {
  const earned = passport?.earned ?? [];
  const dayOf = (e) => e.earned_on ?? e.earned_before ?? "";
  const marks = [...earned]
    .sort((a, b) => (dayOf(b) > dayOf(a) ? 1 : dayOf(b) < dayOf(a) ? -1 : 0))
    .slice(0, 2)
    .map((e) => ({ stamp_id: e.stamp_id, level: e.level }));
  return { id: passport.id, count: earned.length, marks };
}

/** The summary of the passport of the account that verified `tag`, or
 *  null when nobody verified it or its owner has no passport yet. */
export async function readPlayerPassport(db, tag) {
  const { rows } = await db.query(
    `select ap.passport_id,
            coalesce(
              json_agg(json_build_object(
                'stamp_id', e.stamp_id,
                'level', e.level,
                'earned_on', to_char(e.earned_on, 'YYYY-MM-DD'),
                'legacy_before', to_char(e.legacy_before, 'YYYY-MM-DD')))
                filter (where e.stamp_id is not null),
              '[]') as earned
       from (select c.account_id
               from claim c join account a using (account_id)
              where c.player_tag = $1 and c.status = 'verified'
                and (c.is_primary or c.relationship in ('primary', 'alt'))
                and coalesce(a.kind, 'person') = 'person'
              order by c.verified_at limit 1) owner
       join account a on a.account_id = owner.account_id
        and a.kind = 'person' and a.status = 'approved'
       join account_passport ap on ap.account_id = owner.account_id
       left join account_stamp_earned e on e.account_id = owner.account_id
      group by ap.passport_id`,
    [tag],
  );
  const row = rows[0];
  if (!row) return null;
  return summarize({
    id: String(row.passport_id),
    earned: publicEarned(row.earned),
  });
}
