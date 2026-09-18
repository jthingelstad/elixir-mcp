/** The readers the tools use, called in-process.
 *
 *  A builder never re-derives a number: it calls the same registered
 *  tool handler an agent would, with a ctx shaped the way the MCP door
 *  shapes it (invoker.mjs: db, account, live, notifyOwner), and reads
 *  the same body. The account is the recipient projected the way
 *  validateAccessToken projects it, so defaults (omit player_tag to mean
 *  the primary; omit clan_tag to mean the recorded clan) resolve for
 *  that person. Arguments are validated against the declared schema by
 *  the registry, so a builder that drifts from the contract fails here,
 *  not in a reader. */
import { makeRegistry } from "../../../mcp/src/tools.mjs";

let registry = null;
function reg() {
  registry ??= makeRegistry();
  return registry;
}

/** Person accounts eligible for product mail, projected for a ctx. */
export async function loadRecipients(db, kind, { accountId = null } = {}) {
  const { rows } = await db.query(
    `select a.account_id, a.email, a.email_hash, a.timezone, a.role, a.kind,
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

export function accountCtx(db, account) {
  return { db, account, live: null, notifyOwner: async () => {} };
}

/** One tool call, validated and answered like the door's. */
export async function callTool(ctx, name, args = {}) {
  return reg().invoke(name, ctx, args);
}
