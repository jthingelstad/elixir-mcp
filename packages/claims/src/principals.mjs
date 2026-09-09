/**
 * Creating the non-person principals an account owns.
 *
 * This lives in claims because that is what it is: an account bound to a
 * subject, under the same slot rules and the same ownership questions as a
 * player claim. It sits here rather than in either caller because there are two
 * of them — the console mints a key for a signed-in person, and the ops lane
 * registers one whose raw value was generated on an operator's machine and must
 * never reach the cloud.
 *
 * NOTHING HERE EVER SEES A RAW TOKEN. Callers hand in a sha256 and keep the
 * secret, which makes the ops path (hash travels, secret does not) the same
 * code as the console path rather than a parallel implementation of it.
 */

import { randomBytes } from "node:crypto";
import { roleQuotas, ROLE_ORDER } from "@elixir-mcp/contracts";

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

/** Opaque, random, never sequential: a counter would tell anyone holding one
 *  id how many principals exist. Matches the 0053 CHECK. */
function publicId() {
  return randomBytes(8).toString("hex").slice(0, 12);
}

const NAME_SHAPE = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function normalizePrincipalName(value) {
  const name = String(value ?? "")
    .trim()
    .toLowerCase();
  return NAME_SHAPE.test(name) ? name : null;
}

/**
 * Create an agent or integration owned by `owner`, and register its first key.
 *
 * One transaction throughout: a half-created agent with no clan is a principal
 * with no "me", which is the exact state this whole model exists to prevent.
 */
export async function createPrincipal(
  db,
  owner,
  { kind, name, clanTag = null, tokenHash, scope = null },
) {
  if (kind !== "agent" && kind !== "integration")
    return { ok: false, error: "invalid_kind" };
  const cleanName = normalizePrincipalName(name);
  if (!cleanName) return { ok: false, error: "invalid_name" };
  if (!/^[0-9a-f]{64}$/.test(tokenHash ?? ""))
    return { ok: false, error: "invalid_token_hash" };
  if (owner?.kind && owner.kind !== "person")
    return { ok: false, error: "not_entitled", reason: "owner_not_person" };

  await db.query("begin");
  try {
    // The same row lock the claim slot checks take: two concurrent creates
    // otherwise both read the same free capacity and both succeed.
    await db.query(`select 1 from account where account_id = $1 for update`, [
      owner.accountId,
    ]);
    let clan = null;
    if (kind === "agent") {
      const limit = roleQuotas(owner.role).agents;
      if (limit !== Infinity) {
        const { rows } = await db.query(
          `select count(*)::int as n from account
           where owned_by_account_id = $1 and kind = 'agent'
             and status = 'approved'`,
          [owner.accountId],
        );
        if (rows[0].n >= limit) {
          await db.query("rollback");
          return {
            ok: false,
            error: "not_entitled",
            reason: "agent_limit",
            limit,
            role: owner.role,
          };
        }
      }
      // The gate, and the reason agents need no tier: you may create one for a
      // clan you have ALREADY added. Its clan is therefore always a subset of
      // its owner's, so no second recording starts and no slot is spent twice.
      const { rows } = await db.query(
        `select clan_tag, scope from account_clan
         where account_id = $1 and clan_tag = $2`,
        [owner.accountId, clanTag],
      );
      if (rows.length === 0) {
        await db.query("rollback");
        return { ok: false, error: "clan_not_added", clan_tag: clanTag };
      }
      clan = rows[0];
    } else {
      const limit = roleQuotas(owner.role).integrations;
      if (limit === 0) {
        await db.query("rollback");
        return { ok: false, error: "not_entitled", limit, role: owner.role };
      }
      if (limit !== Infinity) {
        const { rows } = await db.query(
          `select count(*)::int as n from account
           where owned_by_account_id = $1 and kind = 'integration'
             and status = 'approved'`,
          [owner.accountId],
        );
        if (rows[0].n >= limit) {
          await db.query("rollback");
          return {
            ok: false,
            error: "quota_exceeded",
            limit,
            role: owner.role,
          };
        }
      }
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
       values ($1, $2, $3, $4, 'approved')
       returning account_id, public_id, role`,
      [
        kind,
        owner.accountId,
        publicId(),
        kind === "agent" ? clampRole(owner.role) : owner.role,
      ],
    );
    const principal = created[0];

    if (clan) {
      await db.query(
        `insert into account_clan (account_id, clan_tag, scope, notify, is_primary)
         values ($1, $2, $3, true, true)`,
        [principal.account_id, clan.clan_tag, clan.scope],
      );
    }

    await db.query(
      `insert into service_token (account_id, name, token_hash, scope)
       values ($1, $2, $3, $4)`,
      [principal.account_id, cleanName, tokenHash, scope],
    );

    await db.query("commit");
    return { ok: true, principal };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    return { ok: false, error: "internal", detail: err.message };
  }
}
