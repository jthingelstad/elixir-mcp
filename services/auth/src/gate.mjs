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
  // The address is held only until a decision is made, so the approval
  // mail the request page promises can actually be sent. decideAccess
  // clears it. Nothing else may read it.
  const { rows } = await db.query(
    `insert into account (email_hash, status, requested_player_tag, request_note, pending_email)
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
  // Returns the held address and clears it in one statement, so it
  // survives exactly one decision: the caller gets it to send the
  // welcome, and a second decision returns null and mails nobody twice.
  //
  // The prior value has to come from a CTE. RETURNING on an UPDATE reads
  // the NEW row, so `returning pending_email` after setting it to null
  // returns the null we just wrote, not the address we meant to send to.
  const { rows } = await db.query(
    `with prior as (
       select account_id, pending_email from account where email_hash = $1
     )
     update account a
        set status = $2, decided_at = now(), pending_email = null
       from prior p
      where a.account_id = p.account_id
        and a.status in ('requested', 'denied', 'approved')
     returning a.account_id, a.status, p.pending_email as email`,
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
