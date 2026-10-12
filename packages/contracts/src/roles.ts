/**
 * The entitlement ladder (Jamie, 2026-09-05). One principle above all:
 * ROLES NEVER GATE VISIBILITY — universal reads is ratified, every tier
 * sees all recorded game data. Roles gate the two things that cost the
 * service something: COLLECTION (what we promise to record) and CALL
 * VOLUME (daily tool calls, and the live lane that spends the one
 * global CR API budget).
 *
 * This table is the single source of truth; per-account override
 * columns (max_player_recordings, mcp_daily_quota, live_daily_quota)
 * beat the role default when set. Infinity encodes "unlimited" and
 * must never be persisted — compare, don't store.
 */

export type Role =
  "member" | "leader" | "family" | "partner" | "admin" | "owner";

export interface RoleQuotas {
  /**
   * Active player recordings the account may hold.
   *
   * Fifty at every tier below unlimited (2026-09-08). The number is not
   * arbitrary: one comprehensive clan watch already records ~50 players, so
   * fifty individually tracked players cost the service what a single
   * comprehensive slot has always cost — and most of them are ALREADY being
   * recorded, since a recording is shared by everyone watching it. Adding a
   * clanmate of a clan you comprehensively record is free.
   *
   * The generosity is what makes relationships worth having: primary, alt,
   * friend and watching are only useful with room to keep friends in.
   *
   * Player slots therefore stop being a rung on the ladder. The tiers still
   * differ where the cost actually scales — clan watches, daily calls, the
   * live lane. (Integrations are admin-provisioned platform
   * access, not a tier entitlement: Jamie, 2026-09-25.)
   */
  player_slots: number;
  /** Clan watches at activity scope (roster + war, no member fan-out). */
  activity_clans: number;
  /** Clan watches at comprehensive scope (every member's battles). */
  comprehensive_clans: number;
  /** MCP tool calls per UTC day. */
  mcp_calls_per_day: number;
  /** live_fetch calls per UTC day — these spend the global CR budget. */
  live_fetches_per_day: number;
  /**
   * Agents the account may create. Agents are not a tier feature - any role
   * may create one for a clan it has added - but each agent is a credential
   * that spends its owner's call and live-fetch budgets, and an unbounded
   * count is an unbounded number of keys to rotate and audit. The cap is
   * generous relative to the clan slots it is bounded by.
   */
  agents: number;
}

export const ROLE_ORDER: Role[] = [
  "member",
  "leader",
  "family",
  "partner",
  "admin",
  "owner",
];

export const ROLES: Record<Role, RoleQuotas> = {
  member: {
    player_slots: 50,
    activity_clans: 1,
    comprehensive_clans: 0,
    mcp_calls_per_day: 500,
    live_fetches_per_day: 20,
    agents: 3,
  },
  leader: {
    player_slots: 50,
    activity_clans: 1,
    comprehensive_clans: 1,
    mcp_calls_per_day: 2000,
    live_fetches_per_day: 100,
    agents: 5,
  },
  family: {
    player_slots: 50,
    activity_clans: 3,
    comprehensive_clans: 3,
    mcp_calls_per_day: 5000,
    live_fetches_per_day: 250,
    agents: 10,
  },
  partner: {
    player_slots: 50,
    activity_clans: 10,
    comprehensive_clans: 5,
    mcp_calls_per_day: 15000,
    live_fetches_per_day: 1000,
    agents: 25,
  },
  admin: {
    player_slots: Infinity,
    activity_clans: Infinity,
    comprehensive_clans: Infinity,
    mcp_calls_per_day: Infinity,
    live_fetches_per_day: Infinity,
    agents: Infinity,
  },
  owner: {
    player_slots: Infinity,
    activity_clans: Infinity,
    comprehensive_clans: Infinity,
    mcp_calls_per_day: Infinity,
    live_fetches_per_day: Infinity,
    agents: Infinity,
  },
};

/** One entitlements system (Jamie, 2026-09-05): the console is a role
 *  power, not a separate flag. Admins run day-to-day (requests,
 *  feedback, clan recordings, roles up to partner); the
 *  owner — exactly one, whom no admin can affect — additionally holds
 *  admin grants, integrations, gateways, and quota overrides. */
export type ConsoleAccess = "none" | "admin" | "owner";

export function consoleAccess(role: string | null | undefined): ConsoleAccess {
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  return "none";
}

/** Tiers come from two places (Jamie, 2026-10-12, #530): Member, Leader
 *  and Family are EARNED in the game and computed on every read (see
 *  `tierSql`); Partner, admin and owner are GRANTS stored on the account.
 *  A stored "leader" or "family" is a pre-2026-10-12 hand grant: it counts
 *  for nothing now, and a tier earned is lost when its ground goes. */
export const EARNED_ROLES: Role[] = ["member", "leader", "family"];
export const GRANTED_ROLES: Role[] = ["partner", "admin", "owner"];

/** Roles an admin-level actor may assign: Member (which takes a grant
 *  away) and Partner, which stays Jamie's to grant. Leader and Family are
 *  earned, never set. Owner may also assign admin, never "owner" itself
 *  (exactly one, held, never granted by API); admins may not touch
 *  admin/owner accounts. */
export const ADMIN_SETTABLE: Role[] = ["member", "partner"];

/** The stored roles an admin may change: a legacy hand-granted leader or
 *  family included, so it can be moved to member or partner. */
const ADMIN_TOUCHABLE: Role[] = ["member", "leader", "family", "partner"];

export function canSetRole(
  actorRole: string | null | undefined,
  targetCurrentRole: string,
  newRole: string,
): boolean {
  if (!isRole(newRole) || newRole === "owner") return false;
  if (EARNED_ROLES.includes(newRole) && newRole !== "member") return false;
  if (targetCurrentRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole !== "admin") return false;
  return (
    ADMIN_TOUCHABLE.includes(targetCurrentRole as Role) &&
    ADMIN_SETTABLE.includes(newRole as Role)
  );
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLES;
}

/** Effective quotas for a tier. Running a collector no longer adds
 *  slots: it earns the Family tier, and that is the reward (Jamie,
 *  2026-10-12, #539). */
export function roleQuotas(role: string | null | undefined): RoleQuotas {
  return ROLES[isRole(role) ? role : "member"];
}

const ALIAS = /^[a-z_][a-z0-9_]*$/;
function alias(a: string): string {
  if (!ALIAS.test(a)) throw new Error(`bad alias ${a}`);
  return a;
}

/** The Family ground, as a SQL predicate over account row `a`. */
export function familyGroundSql(a: string = "a"): string {
  alias(a);
  return `exists (select 1 from gateway tier_g
                  where tier_g.owner_account_id = ${a}.account_id
                    and tier_g.status = 'active')`;
}

/** The Leader ground, as a SQL predicate over account row `a`. */
export function leaderGroundSql(a: string = "a"): string {
  alias(a);
  return `exists (select 1 from claim tier_c
                   join clan_membership tier_m
                     on tier_m.player_tag = tier_c.player_tag
                    and tier_m.left_observed_at is null
                    and tier_m.role in ('leader', 'coLeader')
                   join account_clan tier_ac
                     on tier_ac.account_id = ${a}.account_id
                    and tier_ac.clan_tag = tier_m.clan_tag
                  where tier_c.account_id = ${a}.account_id
                    and tier_c.status = 'verified'
                    and (tier_c.is_primary or tier_c.relationship = 'alt'))`;
}

/**
 * A person's tier, as SQL over an account row aliased `a`: the current
 * check, read on every request like Clan's role check, never stored.
 *
 *   - partner, admin, owner: the stored grant
 *   - family: the account owns a collector whose status is `active` (its
 *     last admitted fetch came after its last probation; drained,
 *     probation and revoked do not count)
 *   - leader: one of the person's own players (primary or alt) is
 *     VERIFIED and is in an open membership as leader or co-leader of a
 *     clan the account tracks. Verified, because several accounts may
 *     claim one tag unverified; only Verify proves whose it is.
 *   - member: otherwise, a stored hand-granted leader or family included
 *
 * The higher earned tier wins: a leader who runs a collector is Family.
 */
function personTierSql(a: string): string {
  return `case
    when ${a}.role in ('partner', 'admin', 'owner') then ${a}.role
    when ${familyGroundSql(a)} then 'family'
    when ${leaderGroundSql(a)} then 'leader'
    else 'member' end`;
}

/**
 * The tier of the account row aliased `a`, as a SQL expression to select
 * in place of `a.role`. An integration keeps its stored role (Partner
 * access is admin-provisioned). An agent is capped at its owner's tier
 * and never above leader (DECISIONS: principals), so it follows its
 * owner's earned tier rather than the snapshot taken at its creation.
 */
export function tierSql(a: string = "a"): string {
  alias(a);
  return `(case
    when ${a}.kind = 'integration' then ${a}.role
    when ${a}.kind = 'agent' then coalesce(
      (select case when (${personTierSql("tier_o")}) = 'member'
                   then 'member' else 'leader' end
         from account tier_o where tier_o.account_id = ${a}.owned_by_account_id),
      'member')
    else ${personTierSql(a)} end)`;
}
