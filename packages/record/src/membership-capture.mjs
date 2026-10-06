import { membershipCapture } from "./capture-state.mjs";

/** Private projection only; public my-players/MCP shapes are unchanged.
 * The retained last-known tag and a null roster role cannot prove absence.
 * Historical rows start unknown. An admitted profile without projection
 * also leaves a gap, so its newer poll stamp invalidates older evidence. */
export async function readMembershipCapture(db, tags) {
  if (!tags.length) return new Map();
  const { rows } = await db.query(
    `select p.player_tag, m.observed_at as observed_at,
            case when s.last_admitted_at > m.observed_at then 'unknown'
                 else m.state end as state
       from player p
       left join player_profile_membership m on m.player_tag = p.player_tag
       left join poll_state s on s.subject_tag = p.player_tag and s.endpoint = 'player'
      where p.player_tag = any($1::text[])`,
    [tags],
  );
  return new Map(rows.map((row) => [row.player_tag, membershipCapture(row)]));
}
