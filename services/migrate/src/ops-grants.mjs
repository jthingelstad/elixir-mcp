/**
 * OAuth consent grants, for the operator ({oauth_grants: {...}}).
 *
 *   {oauth_grants: {redirect_host: "clan.poapkings.com"}}  list live grants
 *     whose client redirects to that host: family, client, audience,
 *     scope, owner kind, created, and the last MCP call made under it.
 *   {oauth_grants: {revoke: ["<family_id>", ...], reason}}  revoke those,
 *     as the console's Connections page does (revoked_at, and a
 *     connection_revoked account event with the reason).
 *
 * Only for a revocation the owner asked for (Jamie 2026-09-24: the three
 * stale Elixir Clan MCP grants). No secret is read; tokens die with their
 * family.
 */

import pg from "pg";

export async function oauthGrants(databaseUrl, spec = {}) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    if (Array.isArray(spec.revoke) && spec.revoke.length) {
      const out = [];
      for (const id of spec.revoke) {
        const { rows } = await db.query(
          `update oauth_family set revoked_at = now()
            where family_id::text = $1 and revoked_at is null
            returning account_id`,
          [String(id)],
        );
        if (rows[0])
          await db.query(
            `insert into account_event (account_id, kind, detail) values ($1, 'connection_revoked', $2)`,
            [
              rows[0].account_id,
              JSON.stringify({
                family_id: String(id),
                by: "operator",
                reason: spec.reason ?? null,
              }),
            ],
          );
        out.push({ family_id: String(id), revoked: rows.length === 1 });
      }
      return { revoked: out };
    }
    const host = String(spec.redirect_host ?? "");
    if (!host) throw new Error("oauth_grants needs redirect_host or revoke");
    const { rows } = await db.query(
      `select f.family_id, c.client_name, f.resource, f.scope, a.kind as account_kind,
              f.created_at, f.absolute_expires_at,
              (select max(m.created_at) from mcp_call_audit m
                where m.oauth_family_id = f.family_id) as last_mcp_call
         from oauth_family f
         join oauth_client c on c.client_id = f.client_id
         join account a on a.account_id = f.account_id
        where f.revoked_at is null and f.absolute_expires_at > now()
          and c.redirect_uris::text like '%' || $1 || '%'
        order by f.created_at`,
      [host],
    );
    return { grants: rows };
  } finally {
    await db.end();
  }
}
