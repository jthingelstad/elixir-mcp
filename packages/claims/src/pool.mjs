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
 *
 * Only ACTIVE agents are in the pool (Jamie, 2026-10-10: "Only active ones
 * should count against usage slots."). A suspended agent's subjects free
 * their slots and stop being a reason to record (reconcileRecording), and
 * resuming it is refused when it would take the pool past a ceiling.
 *
 * A followed player costs a slot only when Elixir records them because of
 * this pool (Jamie, 2026-11-11, #760: quotas built in from the start, and
 * "a clan all following each other is flat cost"). playerCostSql below is
 * the one statement of when a follow is free; every count and every check
 * reads it.
 */
import { roleQuotas, tierSql } from "@elixir-mcp/contracts";

/** The pool's accounts, for owner $1: the person and their active agents. */
const POOL = `select account_id from account
               where account_id = $1
                  or (owned_by_account_id = $1 and kind = 'agent'
                      and status = 'approved')`;

/** The person whose slots an account spends: itself, or its owner. With
 *  what the ceiling needs: the tier (earned in the game, read now, #530)
 *  and the per-account player override. Running a collector earns the
 *  Family tier and no bonus slots on top (#539). */
export async function poolOwner(db, accountId) {
  const { rows } = await db.query(
    `select o.account_id, ${tierSql("o")} as role, o.is_owner,
            o.max_player_recordings as override
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
  const q = roleQuotas(owner.role);
  return {
    exempt,
    player_slots: exempt ? Infinity : (owner.override ?? q.player_slots),
    activity: exempt ? Infinity : q.activity_clans,
    comprehensive: exempt ? Infinity : q.comprehensive_clans,
  };
}

/** An account `a` whose tracking is a reason to record: anyone but a
 *  suspended agent. reconcileRecording (index.mjs) and the slot count
 *  read this one text, so what records and what pays cannot disagree. */
export const COUNTS = `(a.kind <> 'agent' or a.status = 'approved')`;

/**
 * Why Elixir records the player `tag` (a SQL expression) apart from the
 * pool whose account ids `pool` (a subquery) selects, read from what the
 * planner polls (packages/ledger plan.mjs selectEligible; the same set as
 * RECORDED_PLAYERS_SQL in packages/tools):
 *
 *  - in_recorded_clan: an open member of a clan recorded at comprehensive
 *    scope, whose members' profiles and battle logs are polled whoever
 *    follows them. An activity-scope clan (the automatic follow of your
 *    primary's clan) polls only its roster, so its members are not
 *    recorded on its account.
 *  - followed_by_others: the player's FIRST follow that is a reason to
 *    record (the oldest claim, ties by account id) is outside this pool.
 *    First follower pays: exactly one pool carries a player no clan pays
 *    for, so two accounts cannot make each other's follows free and
 *    record without limit. When that follow goes, the next oldest pays
 *    from then on (#760: it keeps recording and starts counting; nobody
 *    is forced off).
 *
 * A follow is free when either holds. For a player the pool does not
 * follow yet, "first follow outside the pool" is simply "someone follows
 * them", so the same columns price a follow before the tap.
 */
const playerCostSql = (tag, pool) => `
  exists (select 1 from clan_membership cm
            join recording r on r.subject_type = 'clan'
             and r.subject_tag = cm.clan_tag and r.status = 'active'
             and r.scope = 'comprehensive'
           where cm.player_tag = ${tag} and cm.left_observed_at is null)
    as in_recorded_clan,
  coalesce((select c.account_id not in (${pool})
              from claim c join account a using (account_id)
             where c.player_tag = ${tag} and ${COUNTS}
             order by c.created_at, c.account_id
             limit 1), false)
    as followed_by_others`;

/**
 * What the pool records, leaving out one player and one clan when asked.
 * players_used is the slots its follows take; players_free the players it
 * follows that take none (playerCostSql); players_followed both.
 */
export async function pooledUsage(
  db,
  ownerId,
  { exceptPlayer = null, exceptClan = null } = {},
) {
  const { rows } = await db.query(
    `with pool as (${POOL}),
     clans as (
       select clan_tag,
              max(case when scope = 'comprehensive' then 2 else 1 end) as width
         from account_clan
        where account_id in (select account_id from pool)
          and clan_tag is distinct from $3
        group by clan_tag),
     followed as (
       select distinct player_tag from claim
        where account_id in (select account_id from pool)
          and player_tag is distinct from $2),
     priced as (
       select f.player_tag,
              ${playerCostSql("f.player_tag", "select account_id from pool")}
         from followed f)
     select (select count(*)::int from priced
              where not in_recorded_clan and not followed_by_others) as players_used,
            (select count(*)::int from priced
              where in_recorded_clan or followed_by_others) as players_free,
            (select count(*)::int from priced) as players_followed,
            (select count(*)::int from clans where width = 1) as activity_used,
            (select count(*)::int from clans where width = 2) as comprehensive_used`,
    [ownerId, exceptPlayer, exceptClan],
  );
  return rows[0];
}

/**
 * What following each of `tags` costs the pool of owner `ownerId`, now:
 * {player_tag, following (the pool already follows them), free, reason}.
 * reason is `in_recorded_clan` or `followed_by_others` when free, else
 * null. One read for a whole list (Players & following, a search's row).
 */
export async function playerCosts(db, ownerId, tags) {
  if (!tags.length) return [];
  const { rows } = await db.query(
    `with pool as (${POOL})
     select t.tag as player_tag,
            exists (select 1 from claim c
                     where c.player_tag = t.tag
                       and c.account_id in (select account_id from pool)) as following,
            ${playerCostSql("t.tag", "select account_id from pool")}
       from unnest($2::text[]) as t(tag)`,
    [ownerId, tags],
  );
  return rows.map((r) => ({
    player_tag: r.player_tag,
    following: r.following,
    free: r.in_recorded_clan || r.followed_by_others,
    reason: r.in_recorded_clan
      ? "in_recorded_clan"
      : r.followed_by_others
        ? "followed_by_others"
        : null,
  }));
}

/**
 * Every player the pool of owner `ownerId` follows, priced as pooledUsage
 * prices them: the same set (a player once, however many of the pool
 * follow them) and the same playerCostSql, so the rows that are not free
 * are exactly pooledUsage's players_used. Each row names who in the pool
 * follows the player: `claims`, one per account, with its kind, its
 * relationship and, for an agent, its public id. Settings' slot meter
 * reads it (2026-11-12): what uses a slot because of you, and what is
 * recorded anyway.
 */
export async function pooledFollows(db, ownerId) {
  const { rows } = await db.query(
    `with pool as (${POOL}),
     followed as (
       select distinct player_tag from claim
        where account_id in (select account_id from pool)),
     priced as (
       select f.player_tag,
              ${playerCostSql("f.player_tag", "select account_id from pool")}
         from followed f)
     select p.player_tag, p.in_recorded_clan, p.followed_by_others,
            (select json_agg(json_build_object(
                       'account_id', a.account_id,
                       'kind', a.kind,
                       'public_id', a.public_id,
                       'relationship', case when c.is_primary then 'primary'
                                            else c.relationship end)
                     order by a.kind = 'agent', a.created_at)
               from claim c join account a using (account_id)
              where c.player_tag = p.player_tag
                and c.account_id in (select account_id from pool)) as claims
       from priced p
      order by p.player_tag`,
    [ownerId],
  );
  return rows.map((r) => ({
    player_tag: r.player_tag,
    free: r.in_recorded_clan || r.followed_by_others,
    reason: r.in_recorded_clan
      ? "in_recorded_clan"
      : r.followed_by_others
        ? "followed_by_others"
        : null,
    claims: r.claims ?? [],
  }));
}

/** playerCosts for one tag. */
export async function playerCost(db, ownerId, tag) {
  return (await playerCosts(db, ownerId, [tag]))[0];
}

/** The plain words for a refused follow (#760): how many are used of how
 *  many, and that following a player Elixir already records stays free. */
export function slotsFullMessage(used, limit) {
  return `All ${limit} of your player slots are in use (${used} of ${limit}). Following a player Elixir already records stays free: a member of a clan recorded in full, or a player another account follows. Stop following someone who uses a slot to make room.`;
}

const WIDTH = { activity: 1, comprehensive: 2 };
export const scopeWidth = (scope) => WIDTH[scope] ?? WIDTH.comprehensive;
export const widthScope = (width) =>
  width >= WIDTH.comprehensive ? "comprehensive" : "activity";

/** The widest scope the REST of the pool gives a clan (null when nobody
 *  else tracks it): what an account's own copy is added on top of, so a
 *  change to your own copy is never refused for a slot it already had. */
export async function pooledClanWidth(db, ownerId, clanTag, exceptAccount) {
  const { rows } = await db.query(
    `select max(case when scope = 'comprehensive' then 2 else 1 end) as width
       from account_clan
      where clan_tag = $2 and account_id is distinct from $3
        and account_id in (${POOL})`,
    [ownerId, clanTag, exceptAccount],
  );
  return rows[0]?.width ?? null;
}
