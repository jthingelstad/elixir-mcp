/**
 * Recording slots belong to the PERSON, pooled across them and every agent
 * they own (Jamie, 2026-09-23: "Agents use the user's recording slots").
 *
 * A subject counts once however many of the pool track it, and a clan
 * counts once, at the widest scope any of them gives it. So making agents
 * never multiplies what one person can record, and an agent tracking a clan
 * its owner already tracks costs nothing. This replaced the creation-time
 * gate ("a clan you have already added") as the general statement of the
 * same guarantee, and closes the gap that gate left: an owner who removed a
 * clan left their agents' copies recording against no slot.
 */
import { roleQuotas } from "@elixir-mcp/contracts";

/** The person whose slots an account spends: itself, or its owner. With
 *  what the ceiling needs: role, the per-account player override, and
 *  whether they run a collector (the operator bonus is theirs). */
export async function poolOwner(db, accountId) {
  const { rows } = await db.query(
    `select o.account_id, o.role, o.is_owner, o.max_player_recordings as override,
            exists (select 1 from gateway g
                     where g.owner_account_id = o.account_id
                       and g.status = 'active') as operator
       from account a
       join account o on o.account_id = coalesce(a.owned_by_account_id, a.account_id)
      where a.account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/** The pool's ceilings; Infinity where the owner is exempt. */
export function poolLimits(owner) {
  const exempt = owner.is_owner || owner.role === "admin";
  const q = roleQuotas(owner.role, { operator: owner.operator });
  return {
    exempt,
    player_slots: exempt ? Infinity : (owner.override ?? q.player_slots),
    activity: exempt ? Infinity : q.activity_clans,
    comprehensive: exempt ? Infinity : q.comprehensive_clans,
  };
}

/**
 * What the pool records, leaving out one player and one clan when asked:
 * a slot check counts everything BUT the subject being added, so re-adding
 * something the pool already has never fails.
 */
export async function pooledUsage(
  db,
  ownerId,
  { exceptPlayer = null, exceptClan = null } = {},
) {
  const { rows } = await db.query(
    `with pool as (
       select account_id from account
        where account_id = $1
           or (owned_by_account_id = $1 and kind = 'agent')),
     clans as (
       select clan_tag,
              max(case when scope = 'comprehensive' then 2 else 1 end) as width
         from account_clan
        where account_id in (select account_id from pool)
          and clan_tag is distinct from $3
        group by clan_tag)
     select (select count(distinct player_tag)::int from claim
              where account_id in (select account_id from pool)
                and player_tag is distinct from $2) as players_used,
            (select count(*)::int from clans where width = 1) as activity_used,
            (select count(*)::int from clans where width = 2) as comprehensive_used`,
    [ownerId, exceptPlayer, exceptClan],
  );
  return rows[0];
}
