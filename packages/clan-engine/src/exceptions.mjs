/**
 * Exceptions (2026-11-23): named overrides a leader sets on one member,
 * so the rules leave that member alone in one way, until a date. They
 * replace holds. Every exception ends: there is no "until I end it".
 *
 *   keep_in_clan   the rules never suggest kicking them
 *   keep_as_elder     an Elder the rules never suggest demoting. A gifted
 *                  Elder: out of the Elder band altogether, so they take
 *                  none of the earned seats, block no promotion and are
 *                  not ranked for demotion
 *   not_for_elder      the rules never suggest promoting them (a second
 *                  account, or someone who said no thanks); out of the
 *                  band, so they push nobody out of line
 *   away           the member's own "I'll be away" (or a leader's for
 *                  them): no kick while it lasts. Always clan-visible
 *
 * One exception record is one stretch of one kind on one member: who set
 * it and when, the end date, the why, who can see it, and each change in
 * `events`. Ended early, it keeps `ended_at`; ended by its date, it is
 * simply past `until` (nothing is written when it runs out). A member
 * carries at most one running exception of each kind.
 *
 * Kinds apply by role at the instant judged: Keep as Elder only to an
 * Elder, Not for Elder only to a Member. Leader and Co-Leaders are never
 * judged by the rules at all, so no exception is set on them.
 */

const DAY_MS = 86400_000;

export const EXCEPTION_KINDS = {
  keep_in_clan: {
    label: "Keep in clan",
    short: "No kick",
    roles: ["member", "elder"],
  },
  keep_as_elder: {
    label: "Keep as Elder",
    short: "No demotion",
    roles: ["elder"],
  },
  not_for_elder: {
    label: "Not for Elder",
    short: "No promotion",
    roles: ["member"],
  },
  away: {
    label: "Away",
    short: "No kick",
    roles: ["member", "elder"],
  },
};

export const EXCEPTION_VISIBILITY = ["leaders", "clan"];

/** The longest an exception may run: a year from when it is set or
 *  changed. Renewing is a change. */
export const EXCEPTION_MAX_DAYS = 365;

/** The lengths a leader is offered, besides a date of their own. */
export const EXCEPTION_LENGTHS = [
  { key: "1w", days: 7, label: "1 week" },
  { key: "2w", days: 14, label: "2 weeks" },
  { key: "1m", days: 30, label: "1 month" },
  { key: "3m", days: 90, label: "3 months" },
];

/** What a member's own Away, or a leader's Away for them, always is. */
export const AWAY_VISIBILITY = "clan";

/** Whether `ex` protects at `ms`: set by then, not yet at its end date,
 *  not ended early. */
export function exceptionActiveAt(ex, ms) {
  if (!ex || !EXCEPTION_KINDS[ex.kind]) return false;
  const set = Date.parse(ex.set_at);
  if (Number.isFinite(set) && set > ms) return false;
  const until = Date.parse(ex.until);
  if (!Number.isFinite(until) || until <= ms) return false;
  if (ex.ended_at && Date.parse(ex.ended_at) <= ms) return false;
  return true;
}

/** Tag -> Set of the kinds running for that member at `ms`. */
export function activeKindsAt(exceptions, ms) {
  const out = new Map();
  for (const ex of exceptions ?? []) {
    if (!exceptionActiveAt(ex, ms)) continue;
    if (!out.has(ex.player_tag)) out.set(ex.player_tag, new Set());
    out.get(ex.player_tag).add(ex.kind);
  }
  return out;
}

/** Whether a kind applies to a member of this role: Keep as Elder to an
 *  Elder, Not for Elder to a Member, the rest to either. */
export function kindApplies(kind, role) {
  return EXCEPTION_KINDS[kind]?.roles.includes(role) ?? false;
}

/** The tags the Elder band leaves out at one instant: Elders kept as
 *  Elder and Members not for Elder. `roleOf(tag)` is the role then. */
export function outOfBand(kindsByTag, roleOf) {
  const out = new Set();
  for (const [tag, kinds] of kindsByTag) {
    const role = roleOf(tag);
    if (
      (kinds.has("keep_as_elder") && role === "elder") ||
      (kinds.has("not_for_elder") && role === "member")
    )
      out.add(tag);
  }
  return out;
}

/** Whether the removal clock is set aside for a member at `ms`. */
export function shieldsRemoval(kinds) {
  return kinds?.has("keep_in_clan") || kinds?.has("away") || false;
}

/**
 * Checks a leader's (or a member's own) exception before it is saved.
 * Returns the error code, or null. `until` is an ISO instant; `role` the
 * member's role now.
 */
export function exceptionProblem(
  { kind, until, visibility, note },
  { role, nowMs },
) {
  if (!EXCEPTION_KINDS[kind]) return "bad_kind";
  if (role === "leader" || role === "coLeader") return "leaders_are_automatic";
  if (!kindApplies(kind, role))
    return kind === "keep_as_elder" ? "elders_only" : "members_only";
  const untilMs = Date.parse(String(until ?? ""));
  if (!Number.isFinite(untilMs) || untilMs <= nowMs) return "bad_until";
  if (untilMs > nowMs + EXCEPTION_MAX_DAYS * DAY_MS) return "too_long";
  if (!EXCEPTION_VISIBILITY.includes(visibility)) return "bad_visibility";
  if (kind === "away" && visibility !== AWAY_VISIBILITY)
    return "bad_visibility";
  if (note != null && String(note).length > 200) return "bad_note";
  return null;
}

/**
 * Everything that happened to one member's exceptions, oldest first, for
 * a member's clan history: each saved event (added, changed, ended),
 * plus an `expired` event at the end date of each one that ran out by
 * itself before `ms`. Every event names its exception, kind and the
 * visibility it had then; `by` is null for Elixir's own (the 0318
 * migration's end date, an expiry).
 */
export function exceptionEvents(exceptions, ms) {
  const events = [];
  for (const ex of exceptions ?? []) {
    for (const e of ex.events ?? [])
      events.push({
        exception_id: ex.exception_id,
        player_tag: ex.player_tag,
        kind: ex.kind,
        ...e,
      });
    if (!ex.ended_at && Date.parse(ex.until) <= ms)
      events.push({
        exception_id: ex.exception_id,
        player_tag: ex.player_tag,
        kind: ex.kind,
        event: "expired",
        at: ex.until,
        by: null,
        by_name: null,
        until: ex.until,
        visibility: ex.visibility,
        note: null,
      });
  }
  // Ties at one instant fall to the event's order, then the exception's
  // id, so the same records always read in the same order.
  return events.sort(
    (a, b) =>
      (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) ||
      eventOrder(a) - eventOrder(b) ||
      String(a.exception_id).localeCompare(String(b.exception_id)),
  );
}

const ORDER = { added: 0, changed: 1, ended: 2, expired: 3 };
const eventOrder = (e) => ORDER[e.event] ?? 4;
