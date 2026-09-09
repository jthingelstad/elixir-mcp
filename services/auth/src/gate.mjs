import { canSetRole, isRole, ROLE_ORDER } from "@elixir-mcp/contracts";

/**
 * The access gate. Request-access creates a
 * `requested` account; the owner decides on the admin page. The HTTP
 * layer must answer identically for new, pending, denied, and unknown
 * emails ("if approved, you'll hear from us") — the gate must never
 * become an email oracle; these functions just do the state moves.
 */

export async function requestAccess(
  db,
  { emailHash, playerTag = null, note = null, email = null },
) {
  // email_hash is the identity; the address is the contact detail we
  // keep so we can actually write to this person later.
  const { rows } = await db.query(
    `insert into account (email_hash, status, requested_player_tag, request_note, email)
     values ($1, 'requested', $2, $3, $4)
     on conflict (email_hash) do nothing
     returning account_id`,
    [emailHash, playerTag, note, email],
  );
  return { created: rows.length > 0 };
}

/**
 * Deciding a target's access status is a privileged act on that
 * target, so it answers to the same hierarchy as changing their role
 * (contracts canSetRole): the owner is exactly one and no decision may
 * unseat them, and an admin may not decide another privileged account.
 * Without this an admin could deny the owner and lock them out — the
 * status move is a stronger power than the role move it bypassed.
 *
 * The guard lives in the UPDATE's own predicate, not a preceding
 * SELECT, so a concurrent role change cannot land between the check
 * and the write.
 *
 * Returns the decided row, `{ refused: <reason> }` when the hierarchy
 * forbids it, or null when there is no such decidable account.
 */
export async function decideAccess(db, { emailHash, decision, actorRole }) {
  if (!["approved", "denied"].includes(decision))
    throw new Error(`bad decision: ${decision}`);
  if (!["owner", "admin"].includes(actorRole))
    return { refused: "not_entitled" };
  // Returns the address so the caller can send the approval mail. An
  // account that predates us keeping addresses has none, which is why
  // the caller has to check rather than assume it can write to them.
  const { rows } = await db.query(
    `update account set status = $2, decided_at = now()
     where email_hash = $1 and status in ('requested', 'denied', 'approved')
       and role <> 'owner' and is_owner is not true
       and ($3 = 'owner' or role <> 'admin')
     returning account_id, status, email`,
    [emailHash, decision, actorRole],
  );
  if (rows[0]) return rows[0];
  // No row moved: either nothing to decide, or the hierarchy refused.
  // Tell those apart so the caller can answer 404 vs 403 — and so a
  // refusal is never reported to the operator as a success.
  const { rows: target } = await db.query(
    `select role, is_owner, status from account where email_hash = $1`,
    [emailHash],
  );
  if (!target[0]) return null;
  const { role, is_owner: isOwner, status } = target[0];
  if (role === "owner" || isOwner) return { refused: "owner_protected" };
  if (role === "admin") return { refused: "admin_protected" };
  if (!["requested", "denied", "approved"].includes(status)) return null;
  return null;
}

export async function approvedAccount(db, emailHash) {
  const { rows } = await db.query(
    `select account_id, email_hash, is_owner, timezone, newsletter_opt_in
     from account where email_hash = $1 and status = 'approved'`,
    [emailHash],
  );
  return rows[0] ?? null;
}

export async function pendingRequests(db) {
  const { rows } = await db.query(
    `select account_id, email_hash, requested_player_tag, request_note, created_at
     from account where status = 'requested' order by created_at`,
  );
  return rows;
}

/**
 * Set an account's role as ONE atomic decision (issue #29).
 *
 * The endpoint used to SELECT the target's role, ask canSetRole, then
 * UPDATE by account_id alone. Between the select and the update the
 * target can be promoted, and the stale answer still authorizes the
 * write — an admin forbidden from touching admin/owner accounts could
 * demote an account that became one. Same shape as #14: a precheck in
 * a separate statement authorizes nothing; the rule belongs in the
 * predicate of the write.
 *
 * canSetRole stays the single source of the hierarchy. Rather than
 * restate it in SQL, we ask it which CURRENT target roles this actor
 * may move to the requested role, and the update matches only those.
 *
 * Returns the updated row, `{ refused: <reason> }`, or null when there
 * is no such account.
 */
export async function setAccountRole(db, { accountId, role, actorRole }) {
  // Input-only rules: "owner" is exactly one, held, never granted here.
  if (!isRole(role) || role === "owner") return { refused: "bad_role" };
  const settableTargets = ROLE_ORDER.filter((current) =>
    canSetRole(actorRole, current, role),
  );
  if (settableTargets.length === 0) return { refused: "not_entitled" };

  const { rows } = await db.query(
    `update account set role = $2
     where account_id = $1 and is_owner is not true and role = any($3)
     returning account_id, role`,
    [accountId, role, settableTargets],
  );
  if (rows[0]) return rows[0];
  // No row moved: nothing to set, or the target is above this actor —
  // including a target that got promoted a moment ago. Tell them apart
  // so a refusal is never reported as a successful change.
  const { rows: target } = await db.query(
    `select role, is_owner from account where account_id = $1`,
    [accountId],
  );
  if (!target[0]) return null;
  if (target[0].role === "owner" || target[0].is_owner)
    return { refused: "owner_protected" };
  return { refused: "not_entitled" };
}
