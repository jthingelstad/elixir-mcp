/** The recipients of a mail kind: person accounts with it on (their own
 *  switch, else the kind's default: the daily brief is off until chosen),
 *  projected the way validateAccessToken projects an account. */
import { emailKindDefault, tierSql } from "@elixir-mcp/contracts";

/** Person accounts eligible for product mail, projected for a ctx. */
export async function loadRecipients(db, kind, { accountId = null } = {}) {
  const { rows } = await db.query(
    `select a.account_id, a.email, a.email_hash, a.timezone,
            ${tierSql("a")} as role, a.kind,
            a.mcp_daily_quota, a.live_daily_quota
       from account a
      where a.kind = 'person' and a.status = 'approved' and a.email is not null
        and ($2::uuid is null or a.account_id = $2)
        and coalesce((select p.enabled from account_email_pref p
                       where p.account_id = a.account_id and p.kind = $1),
                     $3::boolean)
      order by a.created_at`,
    [kind, accountId, emailKindDefault(kind)],
  );
  return rows.map(projectAccount);
}

function projectAccount(row) {
  return {
    accountId: row.account_id,
    email: row.email,
    emailHash: row.email_hash,
    timezone: row.timezone ?? "UTC",
    role: row.role,
    kind: row.kind,
    isOwner: row.role === "owner",
    isAdmin: row.role === "owner" || row.role === "admin",
    mcpDailyQuota: row.mcp_daily_quota,
    liveDailyQuota: row.live_daily_quota,
    credentialType: "mail",
  };
}
