/**
 * The access gate — DESIGN §6.1 step 0. Request-access creates a
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
    `select account_id, email_hash, is_owner, timezone from account
     where email_hash = $1 and status = 'approved'`,
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
