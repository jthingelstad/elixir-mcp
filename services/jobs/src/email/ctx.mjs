/** The recipients of a mail kind: person accounts that have not turned
 *  it off, projected the way validateAccessToken projects an account. */
import { tierSql } from "@elixir-mcp/contracts";

/** Person accounts eligible for product mail, projected for a ctx. */
export async function loadRecipients(db, kind, { accountId = null } = {}) {
  const { rows } = await db.query(
    `select a.account_id, a.email, a.email_hash, a.timezone,
            ${tierSql("a")} as role, a.kind,
            a.mcp_daily_quota, a.live_daily_quota, a.public_id
       from account a
      where a.kind = 'person' and a.status = 'approved' and a.email is not null
        and ($2::uuid is null or a.account_id = $2)
        and not exists (select 1 from account_email_pref p
                         where p.account_id = a.account_id and p.kind = $1
                           and not p.enabled)
      order by a.created_at`,
    [kind, accountId],
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
    publicId: row.public_id,
    credentialType: "mail",
  };
}
