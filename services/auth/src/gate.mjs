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

export async function decideAccess(db, { emailHash, decision }) {
  if (!["approved", "denied"].includes(decision))
    throw new Error(`bad decision: ${decision}`);
  // Returns the address so the caller can send the approval mail. An
  // account that predates us keeping addresses has none, which is why
  // the caller has to check rather than assume it can write to them.
  const { rows } = await db.query(
    `update account set status = $2, decided_at = now()
     where email_hash = $1 and status in ('requested', 'denied', 'approved')
     returning account_id, status, email`,
    [emailHash, decision],
  );
  return rows[0] ?? null;
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
