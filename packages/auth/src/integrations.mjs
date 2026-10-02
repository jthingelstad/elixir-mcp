import integrationContract from "@elixir-mcp/contracts/integration-api.openapi.json" with { type: "json" };
/** Integration accounts: the permissions an integration may hold, and the
 *  admin actions that create and manage one. Two callers: the admin route
 *  (web-api, a signed-in owner) and the migrate Lambda's IAM-only
 *  `integration` op, which passes a locally minted digest. Each answer is
 *  `{ status, body }`; the route turns it into HTTP. */
import { randomBytes } from "node:crypto";
import { mintServiceTokenValue } from "./oauth.mjs";

/** Who an operation admits; an operation that says nothing is the
 *  integration API it was before people could call v1. */
const principalsOf = (operation) =>
  operation["x-principals"] ?? ["integration"];

/** An operation both kinds may call names the integration's permission
 *  apart from the person's scope (2.3.0: `clans:read`). */
export const INTEGRATION_SCOPES = [
  ...new Set(
    Object.values(integrationContract.paths).flatMap((methods) =>
      Object.values(methods)
        .filter((operation) => principalsOf(operation).includes("integration"))
        .map(
          (operation) =>
            operation["x-integration-permission"] ?? operation["x-permission"],
        ),
    ),
  ),
];

/** Permissions that act on people (write facts about them, send them
 *  mail) are granted only when an admin names them; an integration
 *  created without a list gets the rest (2026-09-25). */
const EXPLICIT_INTEGRATION_SCOPES = ["facts:write", "mail:send"];
export const DEFAULT_INTEGRATION_SCOPES = INTEGRATION_SCOPES.filter(
  (s) => !EXPLICIT_INTEGRATION_SCOPES.includes(s),
);

const reply = (status, body) => ({ status, body });

function settings(body) {
  if (
    body.collection_id !== undefined ||
    body.remove_collection_id !== undefined ||
    body.member_limit !== undefined
  )
    throw new Error("collections_retired");
  // Unnamed, the permissions that act on people are left out.
  const scopes = body.scopes ?? DEFAULT_INTEGRATION_SCOPES;
  if (
    !Array.isArray(scopes) ||
    scopes.some((s) => !INTEGRATION_SCOPES.includes(s))
  )
    throw new Error("invalid_scopes");
  const limits = {
    daily_limit: body.daily_limit ?? 10000,
    hourly_limit: body.hourly_limit ?? 2000,
    refresh_limit: body.refresh_limit ?? 1000,
  };
  for (const [key, value] of Object.entries(limits))
    if (
      !Number.isInteger(value) ||
      value < (key === "refresh_limit" ? 0 : 1) ||
      value > (key === "daily_limit" ? 1000000 : 100000)
    )
      throw new Error("invalid_limits");
  return { ...limits, scopes: [...new Set(scopes)] };
}

/** Every integration with its keys and today's use. */
export async function listIntegrations(db) {
  const { rows } = await db.query(`select i.*,a.public_id,a.status,
      (select coalesce(json_agg(json_build_object('token_id',t.token_id,'created_at',t.created_at,'last_used_at',t.last_used_at,'revoked_at',t.revoked_at)), '[]')
        from service_token t where t.account_id=i.account_id and t.audience='integration_api') as tokens,
      coalesce(u.calls,0) as calls_today, coalesce(u.refreshes,0) as refreshes_today
      from integration i join account a using(account_id)
      left join integration_usage u on u.account_id=i.account_id and u.day=(now() at time zone 'UTC')::date order by i.name`);
  return rows.map((row) => ({
    ...row,
    scopes: row.scopes.filter((scope) => INTEGRATION_SCOPES.includes(scope)),
  }));
}

/** create, configure, rotate, revoke, suspend or resume, as the admin
 *  `adminAccountId`. `mintToken` returns `{ hash, raw? }`; the raw key is
 *  answered once and never stored. */
export async function administerIntegration(
  db,
  adminAccountId,
  body,
  { mintToken = mintServiceTokenValue, logEvent },
) {
  const action = body.action ?? "create";
  if (
    !["create", "configure", "rotate", "revoke", "suspend", "resume"].includes(
      action,
    )
  )
    return reply(400, { error: "invalid_action" });
  let policy;
  try {
    if (action === "create" || action === "configure") policy = settings(body);
  } catch (e) {
    return reply(400, { error: e.message });
  }
  if (
    action === "create" &&
    (typeof body.name !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,63}$/.test(body.name))
  )
    return reply(400, { error: "invalid_name" });
  const minted =
    action === "create" || action === "rotate" ? mintToken() : null;
  await db.query("begin");
  try {
    let integration;
    if (action === "create") {
      const { rows } = await db.query(
        "insert into account(kind,owned_by_account_id,public_id,status,role) values('integration',$1,$2,'approved','partner') returning *",
        [adminAccountId, randomBytes(6).toString("hex")],
      );
      integration = rows[0];
      await db.query(
        "insert into integration(account_id,name,scopes,daily_limit,hourly_limit,refresh_limit) values($1,$2,$3,$4,$5,$6)",
        [
          integration.account_id,
          body.name,
          policy.scopes,
          policy.daily_limit,
          policy.hourly_limit,
          policy.refresh_limit,
        ],
      );
      integration.name = body.name;
    } else {
      integration = (
        await db.query(
          "select a.account_id,a.public_id,i.name from account a join integration i using(account_id) where a.public_id=$1 for update of a,i",
          [String(body.id ?? "")],
        )
      ).rows[0];
      if (!integration) {
        await db.query("rollback");
        return reply(404, { error: "not_found" });
      }
    }
    const id = integration.account_id;
    if (policy) {
      await db.query(
        "update integration set scopes=$2,daily_limit=$3,hourly_limit=$4,refresh_limit=$5 where account_id=$1",
        [
          id,
          policy.scopes,
          policy.daily_limit,
          policy.hourly_limit,
          policy.refresh_limit,
        ],
      );
    }
    if (action === "rotate" || action === "revoke")
      await db.query(
        "update service_token set revoked_at=now() where account_id=$1 and audience='integration_api' and revoked_at is null",
        [id],
      );
    if (action === "suspend" || action === "resume")
      await db.query("update account set status=$2 where account_id=$1", [
        id,
        action === "suspend" ? "disabled" : "approved",
      ]);
    if (minted)
      await db.query(
        "insert into service_token(account_id,name,token_hash,scope,audience) values($1,$2,$3,'','integration_api')",
        [id, integration.name, minted.hash],
      );
    await db.query("commit");
    await logEvent(db, adminAccountId, `integration_${action}`, {
      integration: integration.public_id,
    });
    return reply(action === "create" ? 201 : 200, {
      integration: {
        account_id: id,
        public_id: integration.public_id,
        name: integration.name,
      },
      ...(minted ? { token: minted.raw } : {}),
    });
  } catch (error) {
    await db.query("rollback");
    if (error.code === "23505") return reply(409, { error: "name_taken" });
    throw error;
  }
}
