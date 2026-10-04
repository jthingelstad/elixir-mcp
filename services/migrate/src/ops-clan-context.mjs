/** {clan_context: {agents: [public_id], apply?, expected_sha256?, revoke?}}
 * IAM-only metadata preview, or explicitly authorized grant/revocation under
 * the production lease. At most three candidates; never returns credentials,
 * player identities or private policy. Apply rechecks the preview fingerprint
 * and only grants currently eligible candidates. No default scope changes. */
import pg from "pg";
import { createHash } from "node:crypto";
import { agentContextEligibility } from "@elixir-mcp/auth/clan-context";

export async function clanContextOp(databaseUrl, spec = {}) {
  const ids = spec.agents;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 3 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !/^[a-z0-9]{8,16}$/.test(id))
  )
    throw new Error(
      "clan_context requires one to three distinct agent public IDs",
    );
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin isolation level serializable");
    if (spec.apply !== true) await db.query("set transaction read only");
    const candidates = await agentContextEligibility(db, ids);
    const { rows: grants } = await db.query(
      `select grant_id, a.public_id,
      g.owner_account_id, g.clan_tag, g.token_id from agent_policy_context_grant g
      join account a on a.account_id = g.agent_account_id
      where a.public_id = any($1::text[]) and g.revoked_at is null order by a.public_id`,
      [ids],
    );
    const expected_sha256 = createHash("sha256")
      .update(JSON.stringify({ candidates, grants }))
      .digest("hex");
    if (spec.apply === true && spec.expected_sha256 !== expected_sha256)
      throw new Error("Context eligibility or grants changed; preview again");
    let changed = 0;
    if (spec.apply === true) {
      if (spec.revoke === true) {
        const r = await db.query(
          `update agent_policy_context_grant g set revoked_at = now(), revoke_reason = 'operator_revoked'
          from account a where a.account_id = g.agent_account_id and a.public_id = any($1::text[]) and g.revoked_at is null`,
          [ids],
        );
        changed = r.rowCount;
      } else {
        for (const c of candidates) {
          if (!c.eligible) continue;
          if (
            spec.expected_owner_account_id &&
            c.owner_account_id !== spec.expected_owner_account_id
          )
            throw new Error("Actual owner does not match approved owner");
          const r = await db.query(
            `insert into agent_policy_context_grant(agent_account_id,owner_account_id,clan_tag,token_id)
            values($1,$2,$3,$4) on conflict (agent_account_id) where revoked_at is null do nothing returning grant_id`,
            [c.agent_account_id, c.owner_account_id, c.clan_tag, c.token_id],
          );
          changed += r.rowCount;
        }
      }
    }
    await db.query("commit");
    return {
      applied: spec.apply === true,
      revoked: spec.revoke === true,
      expected_sha256,
      candidates,
      eligible: candidates.filter((c) => c.eligible).length,
      active_grants_before: grants.length,
      changed,
    };
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}
