/**
 * Creating and listing the non-person principals an account owns.
 *
 * AGENTS are open to every role. The gate is not a tier, it is a fact: you may
 * create an agent for a clan you have already added. That makes the entitlement
 * fall out of clan slots you already paid for, and it means the agent's clan is
 * always a subset of its owner's — so no second recording is started and no
 * slot is consumed twice. Jamie, 2026-09-08: "this is actually a feature all
 * clan leaders should have available."
 *
 * INTEGRATIONS are partner+. They have no "me", they consume the corpus for
 * their own userbase, and their call volume is a function of THEIR users rather
 * than their owner's habits — which is why they carry a per-key quota and why
 * the count is a role entitlement.
 */

import { randomBytes } from "node:crypto";
import { roleQuotas, ROLE_ORDER } from "@elixir-mcp/contracts";
import { issueServiceToken } from "@elixir-mcp/auth";

/**
 * An agent is never as privileged as an admin owner.
 *
 * Jamie: "I'm an admin but my agent for poap kings is not." A clan agent needs
 * one comprehensive clan and a working call budget, which is exactly `leader`;
 * anything above that is authority it has no use for. Owners below leader keep
 * their own tier, so a member's agent gets a member's single activity clan.
 */
const AGENT_MAX_ROLE = "leader";

function clampRole(ownerRole) {
  const owner = ROLE_ORDER.indexOf(ownerRole);
  const ceiling = ROLE_ORDER.indexOf(AGENT_MAX_ROLE);
  if (owner === -1) return "member";
  return ROLE_ORDER[Math.min(owner, ceiling)];
}

/** Opaque, random, and never sequential: a counter would tell anyone holding
 *  one id how many principals exist. Matches the 0053 CHECK. */
function publicId() {
  return randomBytes(8).toString("hex").slice(0, 12);
}

const NAME_SHAPE = /^[a-z0-9][a-z0-9-]{1,40}$/;

function normalizeName(value) {
  const name = String(value ?? "")
    .trim()
    .toLowerCase();
  return NAME_SHAPE.test(name) ? name : null;
}

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

async function countKind(db, ownerAccountId, kind) {
  const { rows } = await db.query(
    `select count(*)::int as n from account
     where owned_by_account_id = $1 and kind = $2 and status = 'approved'`,
    [ownerAccountId, kind],
  );
  return rows[0].n;
}

/**
 * Create an agent for one of the owner's clans, and mint its first key.
 *
 * The raw token is returned ONCE and never stored. Everything happens in one
 * transaction: a half-created agent with no clan is a principal with no "me",
 * which is precisely the state this whole model exists to make impossible.
 */
export async function createAgent(db, owner, { name, clanTag, scope = null }) {
  const cleanName = normalizeName(name);
  if (!cleanName) return { ok: false, error: "invalid_name" };
  if (owner.kind && owner.kind !== "person")
    return { ok: false, error: "not_entitled", reason: "owner_not_person" };

  await db.query("begin");
  try {
    const { rows: held } = await db.query(
      `select clan_tag, scope from account_clan
       where account_id = $1 and clan_tag = $2`,
      [owner.accountId, clanTag],
    );
    if (held.length === 0) {
      await db.query("rollback");
      // Deliberately the same shape as a quota refusal: "add the clan first"
      // is the entitlement, not a tier upgrade.
      return { ok: false, error: "clan_not_added", clan_tag: clanTag };
    }

    const { rows: dupe } = await db.query(
      `select 1 from service_token t
       join account a on a.account_id = t.account_id
       where a.owned_by_account_id = $1 and t.name = $2 and t.revoked_at is null`,
      [owner.accountId, cleanName],
    );
    if (dupe.length > 0) {
      await db.query("rollback");
      return { ok: false, error: "name_taken" };
    }

    const { rows: created } = await db.query(
      `insert into account (kind, owned_by_account_id, public_id, role, status)
       values ('agent', $1, $2, $3, 'approved')
       returning account_id, public_id, role`,
      [owner.accountId, publicId(), clampRole(owner.role)],
    );
    const agent = created[0];

    // The agent's clan is one the owner already added, so the recording exists
    // and its scope is already settled — this row points at it, it does not
    // start anything.
    await db.query(
      `insert into account_clan (account_id, clan_tag, scope, notify, is_primary)
       values ($1, $2, $3, true, true)`,
      [agent.account_id, held[0].clan_tag, held[0].scope],
    );

    const token = await issueServiceToken(db, {
      accountId: agent.account_id,
      name: cleanName,
      scope,
    });
    await db.query("commit");
    return { ok: true, agent, token };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    return { ok: false, error: "internal", detail: err.message };
  }
}

/** Create an integration: no clan, no "me", partner+ and counted. */
export async function createIntegration(db, owner, { name, scope = null }) {
  const cleanName = normalizeName(name);
  if (!cleanName) return { ok: false, error: "invalid_name" };
  if (owner.kind && owner.kind !== "person")
    return { ok: false, error: "not_entitled", reason: "owner_not_person" };

  const limit = roleQuotas(owner.role).integrations;
  if (limit === 0)
    return { ok: false, error: "not_entitled", limit, role: owner.role };
  if (
    limit !== Infinity &&
    (await countKind(db, owner.accountId, "integration")) >= limit
  )
    return { ok: false, error: "quota_exceeded", limit, role: owner.role };

  await db.query("begin");
  try {
    const { rows: created } = await db.query(
      `insert into account (kind, owned_by_account_id, public_id, role, status)
       values ('integration', $1, $2, $3, 'approved')
       returning account_id, public_id, role`,
      [owner.accountId, publicId(), owner.role],
    );
    const integration = created[0];
    const token = await issueServiceToken(db, {
      accountId: integration.account_id,
      name: cleanName,
      scope,
    });
    await db.query("commit");
    return { ok: true, integration, token };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    return { ok: false, error: "internal", detail: err.message };
  }
}
