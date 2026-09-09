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

/** Everything the owner has that a principal could be pointed at. */
export async function listPrincipals(db, ownerAccountId) {
  const { rows } = await db.query(
    `select a.account_id, a.kind, a.public_id, a.role, a.created_at, a.status,
            -- Calls in the last 7 days. An agent spends the OWNER's quota, so
            -- "which of my agents is eating my budget" has to be answerable
            -- from here; the owner's own usage view cannot see these rows.
            (select count(*)::int from mcp_call_audit m
              where m.account_id = a.account_id
                and m.created_at > now() - interval '7 days') as calls_7d,
            (select max(m.created_at) from mcp_call_audit m
              where m.account_id = a.account_id) as last_call_at,
            (select count(*)::int from event_feed ef
              where ef.account_id = a.account_id
                and ef.event_id > a.events_seen_through) as unread_events,
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

/**
 * Rotate an agent's key.
 *
 * Revoking used to be a dead end: the only way back was delete-and-recreate,
 * which throws away the account_id, the public_id in the agent's MCP URL, and
 * the events_seen_through cursor -- so the replacement either re-reads the
 * whole feed or silently skips it. Rotation keeps the principal and swaps the
 * credential, which is what "my key leaked" actually needs.
 *
 * The old token is revoked in the SAME transaction that inserts the new one:
 * a rotation that half-applied would either leave two live keys or none.
 */
export async function rotateToken(db, ownerAccountId, principalAccountId) {
  const { raw, hash } = mintServiceTokenValue();
  try {
    await db.query("begin");
    // Ownership is part of the WHERE, so rotating somebody else's agent finds
    // nothing rather than being refused after the fact.
    const { rows: owned } = await db.query(
      `select a.account_id from account a
        where a.account_id = $1 and a.owned_by_account_id = $2
          and a.kind = 'agent'`,
      [principalAccountId, ownerAccountId],
    );
    if (owned.length === 0) {
      await db.query("rollback");
      return { ok: false, error: "not_found" };
    }
    // Carry the name and scope forward: they are the agent's identity and its
    // grant, and a rotation is not a re-grant.
    const { rows: prior } = await db.query(
      `select name, scope from service_token
        where account_id = $1 and revoked_at is null
        order by created_at desc limit 1`,
      [principalAccountId],
    );
    if (prior.length === 0) {
      await db.query("rollback");
      return { ok: false, error: "no_active_token" };
    }
    await db.query(
      `update service_token set revoked_at = now()
        where account_id = $1 and revoked_at is null`,
      [principalAccountId],
    );
    await db.query(
      `insert into service_token (account_id, name, token_hash, scope)
       values ($1, $2, $3, $4)`,
      [principalAccountId, prior[0].name, hash, prior[0].scope],
    );
    await db.query("commit");
    return { ok: true, token: raw };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/**
 * Suspend or resume an owned principal.
 *
 * Both doors -- validateAccessToken and the service-token path -- already
 * require `a.status = 'approved'`, so flipping the row to 'disabled' makes
 * every credential stop working through the ORDINARY not-found path. Jamie's
 * call: a suspended agent looks exactly like an invalid token. Nothing tells
 * the caller the principal exists and is switched off, which is the same
 * answer an unknown token gets.
 *
 * Deliberately NOT a token revocation: resuming restores the same key, so a
 * suspension is reversible without redistributing a credential.
 */
export async function setPrincipalStatus(
  db,
  ownerAccountId,
  principalAccountId,
  status,
) {
  if (status !== "approved" && status !== "disabled")
    return { ok: false, error: "bad_status" };
  const { rowCount } = await db.query(
    `update account set status = $3
      where account_id = $1 and owned_by_account_id = $2
        and kind = 'agent'`,
    [principalAccountId, ownerAccountId, status],
  );
  return rowCount === 1
    ? { ok: true, status }
    : { ok: false, error: "not_found" };
}
