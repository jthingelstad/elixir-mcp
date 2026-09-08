/**
 * The console's half of principal creation: mint a key, hand it over once,
 * and never store it.
 *
 * The creation itself lives in @elixir-mcp/claims, shared with the ops lane —
 * which registers principals whose raw key was generated on an operator's
 * machine and never reaches the cloud. Keeping one insert means the two paths
 * cannot drift on the rules that matter (whose clan, which tier, how many).
 */

import { mintServiceTokenValue } from "@elixir-mcp/auth";
import { createPrincipal } from "@elixir-mcp/claims";
import { roleQuotas } from "@elixir-mcp/contracts";

/** Everything the owner has that a principal could be pointed at. */
export async function listPrincipals(db, ownerAccountId) {
  const { rows } = await db.query(
    `select a.account_id, a.kind, a.public_id, a.role, a.created_at,
            coalesce(
              (select json_agg(json_build_object('clan_tag', ac.clan_tag,
                                                 'scope', ac.scope,
                                                 'is_primary', ac.is_primary))
               from account_clan ac where ac.account_id = a.account_id), '[]'
            ) as clans,
            coalesce(
              (select json_agg(json_build_object('token_id', t.token_id,
                                                 'name', t.name,
                                                 'scope', t.scope,
                                                 'last_used_at', t.last_used_at,
                                                 'revoked_at', t.revoked_at))
               from service_token t where t.account_id = a.account_id), '[]'
            ) as tokens
     from account a
     where a.owned_by_account_id = $1
     order by a.created_at desc`,
    [ownerAccountId],
  );
  return rows;
}

async function create(db, owner, kind, { name, clanTag = null, scope = null }) {
  // Minted before the insert so the row is written with a digest and the raw
  // value exists only in this function and the response. There is no second
  // chance and no support path that ends in recovering it.
  const { raw, hash } = mintServiceTokenValue();
  const result = await createPrincipal(db, owner, {
    kind,
    name,
    clanTag,
    tokenHash: hash,
    scope,
  });
  return result.ok ? { ...result, token: raw } : result;
}

export const createAgent = (db, owner, opts) =>
  create(db, owner, "agent", {
    name: opts.name,
    clanTag: opts.clanTag,
    scope: opts.scope,
  });

export const createIntegration = (db, owner, opts) =>
  create(db, owner, "integration", { name: opts.name, scope: opts.scope });

export const mayCreateIntegration = (role) => roleQuotas(role).integrations > 0;
