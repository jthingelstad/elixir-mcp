/**
 * A leader's powers here come from the clan's roster in Elixir's record
 * (clan_membership, which the gate reads on every request), and the record
 * moves only when the roster is read from the game. A leader kicked or
 * demoted in the game kept their powers until the next roster poll, hours
 * for a quiet clan. So a mutation that needs the leader band needs the
 * clan's latest admitted roster read to be no older than
 * ROLE_CONFIRM_MAX_AGE_MS. Older, it asks for one live roster read (the
 * ledger's live lane: one open job per clan, charged once, a second ask
 * while it is open is the same ask) and is refused `role_unconfirmed`;
 * the next try, a minute on, reads the record the live read moved, and
 * the gate drops a role the game no longer shows.
 *
 * Views are not leader mutations: they change nothing, and a person who
 * lost the role sees at most what they saw an hour ago. A member's own
 * away and the two read-only POSTs (policy preview, scout) are not either:
 * they do not need the leader band. docs/notes/2026-10-12-clan-role-freshness.md.
 */

import { ManageError } from "./manage/service.mjs";

/** The assumption (2026-10-12): an hour-old roster is recent enough to
 *  act on. One constant; a different bound is this line. */
export const ROLE_CONFIRM_MAX_AGE_MS = 60 * 60_000;

const LEADER_BAND = new Set(["leader", "coLeader"]);

/** Non-GET routes that do not need the leader band. Every other one does,
 *  a new route included. */
const NOT_LEADER_MUTATIONS = [
  /^\/me\/away$/,
  /^\/policy\/preview$/,
  /^\/scout$/,
];

/** Whether a request to `rest` (the path after /api/clans/:tag) by a
 *  person holding `role` is a leader mutation. */
export function isLeaderMutation(method, rest, role) {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS")
    return false;
  if (!LEADER_BAND.has(role)) return false;
  return !NOT_LEADER_MUTATIONS.some((re) => re.test(rest));
}

const observedAt = (body) => {
  const at = body?.meta?.source_polls?.clan?.observed_at ?? null;
  const ms = at ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? { at, ms } : null;
};

/**
 * Confirm the clan's roster is recent enough for a leader mutation, or
 * throw: ManageError 409 `role_unconfirmed` once a live read is asked for,
 * 401 `session_expired`, 502 `elixir_unavailable`.
 */
export async function confirmRole({ mcp, token, clanTag, now }) {
  const args = { clan_tag: clanTag, verbosity: "compact" };
  const expired = () =>
    new ManageError(401, "session_expired", "Sign in again.");
  const read = await mcp.callTool(token, "clans_roster", args);
  if (read?.status === 401) throw expired();
  // A clan nobody records still has a roster the live lane can read.
  if (!read?.ok && read?.code !== "not_recorded")
    throw new ManageError(
      502,
      "elixir_unavailable",
      "Elixir could not read the clan's roster.",
    );
  const recent = (o) => o !== null && now - o.ms <= ROLE_CONFIRM_MAX_AGE_MS;
  const seen = read.ok ? observedAt(read.body) : null;
  if (recent(seen)) return;
  const live = await mcp.callTool(token, "clans_roster", {
    ...args,
    live: true,
  });
  if (live?.status === 401) throw expired();
  // A read already inside the game's cache window answers at once.
  const after = live?.ok ? observedAt(live.body) : null;
  if (recent(after)) return;
  const pending = live?.ok ? (live.body?.live_status ?? null) : null;
  throw new ManageError(
    409,
    "role_unconfirmed",
    "Confirming your role in the game; try again in a minute.",
    {
      roster_observed_at: (after ?? seen)?.at ?? null,
      max_age_s: ROLE_CONFIRM_MAX_AGE_MS / 1000,
      retry_after_s: Math.max(pending?.retry_after_s ?? 60, 15),
    },
  );
}
