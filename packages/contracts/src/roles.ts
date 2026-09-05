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
  /** Active player recordings the account may hold. */
  player_slots: number;
  /** Clan watches at activity scope (roster + war, no member fan-out). */
  activity_clans: number;
  /** Clan watches at comprehensive scope (every member's battles). */
  comprehensive_clans: number;
  /** MCP tool calls per UTC day (collector credits may extend it). */
  mcp_calls_per_day: number;
  /** live_fetch calls per UTC day — these spend the global CR budget. */
  live_fetches_per_day: number;
  /** Collections the account may create and curate. */
  collections_max: number;
  /** Service tokens (headless agents) the account may hold. */
  service_tokens: number;
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
    player_slots: 3,
    activity_clans: 1,
    comprehensive_clans: 0,
    mcp_calls_per_day: 500,
    live_fetches_per_day: 20,
    collections_max: 0,
    service_tokens: 0,
  },
  leader: {
    player_slots: 5,
    activity_clans: 1,
    comprehensive_clans: 1,
    mcp_calls_per_day: 2000,
    live_fetches_per_day: 100,
    collections_max: 0,
    service_tokens: 0,
  },
  family: {
    player_slots: 10,
    activity_clans: 3,
    comprehensive_clans: 3,
    mcp_calls_per_day: 5000,
    live_fetches_per_day: 250,
    collections_max: 5,
    service_tokens: 0,
  },
  partner: {
    player_slots: 25,
    activity_clans: 10,
    comprehensive_clans: 5,
    mcp_calls_per_day: 15000,
    live_fetches_per_day: 1000,
    collections_max: 20,
    service_tokens: 1,
  },
  admin: {
    player_slots: Infinity,
    activity_clans: Infinity,
    comprehensive_clans: Infinity,
    mcp_calls_per_day: Infinity,
    live_fetches_per_day: Infinity,
    collections_max: Infinity,
    service_tokens: Infinity,
  },
  owner: {
    player_slots: Infinity,
    activity_clans: Infinity,
    comprehensive_clans: Infinity,
    mcp_calls_per_day: Infinity,
    live_fetches_per_day: Infinity,
    collections_max: Infinity,
    service_tokens: Infinity,
  },
};

/** One entitlements system (Jamie, 2026-09-05): the console is a role
 *  power, not a separate flag. Admins run day-to-day (requests,
 *  feedback, collections, clan recordings, roles up to partner); the
 *  owner — exactly one, whom no admin can affect — additionally holds
 *  admin grants, service tokens, gateways, and quota overrides. */
export type ConsoleAccess = "none" | "admin" | "owner";

export function consoleAccess(role: string | null | undefined): ConsoleAccess {
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  return "none";
}

/** Roles an admin-level actor may assign. Owner may assign anything
 *  except "owner" itself (exactly one, held, never granted by API);
 *  admins stop at partner and may not touch admin/owner accounts. */
export const ADMIN_SETTABLE: Role[] = ["member", "leader", "family", "partner"];

export function canSetRole(
  actorRole: string | null | undefined,
  targetCurrentRole: string,
  newRole: string,
): boolean {
  if (!isRole(newRole) || newRole === "owner") return false;
  if (targetCurrentRole === "owner") return false;
  if (actorRole === "owner") return true;
  if (actorRole !== "admin") return false;
  return (
    ADMIN_SETTABLE.includes(targetCurrentRole as Role) &&
    ADMIN_SETTABLE.includes(newRole as Role)
  );
}

/** Running a live collector earns extra capture — capacity begets
 *  collection. Stacks on member/leader/family; partner's tier already
 *  assumes a collector; admin is unbounded anyway. */
export const OPERATOR_BONUS = {
  player_slots: 2,
  activity_clans: 1,
} as const;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLES;
}

/** Effective quotas for an account: role defaults, plus the operator
 *  bonus when the account runs an active collector. */
export function roleQuotas(
  role: string | null | undefined,
  { operator = false }: { operator?: boolean } = {},
): RoleQuotas {
  const base = ROLES[isRole(role) ? role : "member"];
  if (!operator || role === "admin" || role === "owner" || role === "partner")
    return base;
  return {
    ...base,
    player_slots: base.player_slots + OPERATOR_BONUS.player_slots,
    activity_clans: base.activity_clans + OPERATOR_BONUS.activity_clans,
  };
}
