import { canSetRole, isRole, ROLE_ORDER } from "@elixir-mcp/contracts";
import { emailHash as hashEmail } from "./crypto.mjs";
import { accountZone } from "./zone.mjs";

/** Public email authentication admits new people and ordinary pending members.
 * Blocked accounts and privileged pending requests retain their existing gate.
 * The HTTP response never reveals which case the address matched. */
export async function publicLoginAccount(db, emailHash) {
  const { rows } = await db.query(
    `select account_id, status, kind, role, is_owner, newsletter_opt_in
     from account where email_hash = $1`,
    [emailHash],
  );
  const account = rows[0];
  if (!account) return { newsletter_opt_in: false };
  return account.kind === "person" &&
    (account.status === "approved" ||
      (account.status === "requested" &&
        account.role === "member" &&
        !account.is_owner))
    ? account
    : null;
}

/** Call only with the email frozen in a successfully redeemed web login.
 * The conflict predicate checks current state, including concurrent denial
 * or promotion. Repeated verifications cannot change an existing tier.
 * `timezone` is the zone the signup request's browser reported: like the
 * newsletter choice it is written only by the insert, so it applies to a
 * newly created account and never to one that already exists (Jamie,
 * 2026-10-08). One that fails the Profile check leaves the account on UTC.
 * `playerTag`, normalized at the request, goes the same way: the insert
 * writes it to requested_player_tag, and onboardAccount claims it after
 * this proof. `created` says the insert, not the pending-member update,
 * opened the row: only a new account lands on its first-use page.
 *
 * `ageAttestedAt` is when the signup form that asked was told the person
 * is 13 or older (0240, #763; VISION "Signing up asks the person to attest
 * they are 13 or older"), frozen with the request. Without it no account
 * opens: an address with no account, or a pending member's, answers
 * `{ refused: "age_attestation_required" }` and nothing is written. An
 * account that is already open signs in as before (null). */
export async function openVerifiedAccount(
  db,
  {
    emailHash,
    email,
    newsletterOptIn = true,
    timezone = null,
    playerTag = null,
    ageAttestedAt = null,
  },
) {
  if (typeof email !== "string" || hashEmail(email) !== emailHash) return;
  const attestedAt = attestationTime(ageAttestedAt);
  if (!attestedAt) {
    const { rows } = await db.query(
      `select 1 from account
        where email_hash = $1
          and not (status = 'requested' and role = 'member'
                   and kind = 'person' and is_owner is not true)`,
      [emailHash],
    );
    return rows[0] ? null : AGE_REFUSED;
  }
  const { rows } = await db.query(
    `insert into account (email_hash, email, status, role, kind, decided_at,
                          newsletter_opt_in, timezone, requested_player_tag,
                          age_attested_at)
     values ($1, $2, 'approved', 'member', 'person', now(), $3, $4, $5, $6)
     on conflict (email_hash) do update
       set status = 'approved', email = excluded.email, decided_at = now(),
           age_attested_at = coalesce(account.age_attested_at, excluded.age_attested_at)
       where account.status = 'requested' and account.role = 'member'
         and account.kind = 'person' and account.is_owner is not true
     returning account_id, newsletter_opt_in, (xmax = 0) as created`,
    [
      emailHash,
      email.trim().toLowerCase(),
      newsletterOptIn === true,
      accountZone(timezone) ?? null,
      typeof playerTag === "string" && playerTag ? playerTag : null,
      attestedAt,
    ],
  );
  return rows[0] ?? null;
}

/** The doors' words when a proof would open an account the 13-or-older
 *  question was never answered for (0240, #763). */
export const AGE_ATTESTATION_MESSAGE =
  "There is no Elixir account for this address yet. To create one, say you are 13 or older and send a new email.";

/** What openVerifiedAccount answers for a new account with no attestation. */
const AGE_REFUSED = Object.freeze({ refused: "age_attestation_required" });

/** The frozen attestation as a Date, or null when there is none to use.
 *  The doors write it from their own clock, so only its shape is checked. */
function attestationTime(value) {
  if (value == null || value === false) return null;
  const at = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(at.getTime()) ? null : at;
}

export async function approvedAccount(db, emailHash) {
  const { rows } = await db.query(
    `select account_id, email_hash, is_owner, timezone, newsletter_opt_in, kind
     from account where email_hash = $1 and status = 'approved'`,
    [emailHash],
  );
  return rows[0] ?? null;
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
  if (rows[0]) {
    // An agent's tier is capped at its owner's (DECISIONS: principals),
    // and never above leader: a downgrade takes the owner's agents down
    // with it. They were clamped once at creation and never again, so an
    // owner moved below leader left an agent above them (2026-09-25).
    const ceiling =
      ROLE_ORDER[
        Math.min(ROLE_ORDER.indexOf(role), ROLE_ORDER.indexOf("leader"))
      ];
    await db.query(
      `update account set role = $2
        where owned_by_account_id = $1 and kind = 'agent'
          and array_position($3::text[], role) > array_position($3::text[], $2)`,
      [accountId, ceiling, ROLE_ORDER],
    );
    return rows[0];
  }
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
