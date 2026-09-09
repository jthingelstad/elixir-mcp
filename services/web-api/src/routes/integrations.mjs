import { randomBytes } from "node:crypto";
import { mintServiceTokenValue } from "@elixir-mcp/auth";
import { INTEGRATION_SCOPES } from "../integration-api.mjs";
import { json } from "../http.mjs";

function settings(body) {
  const scopes = body.scopes ?? INTEGRATION_SCOPES;
  if (
    !Array.isArray(scopes) ||
    scopes.some((s) => !INTEGRATION_SCOPES.includes(s))
  )
    throw new Error("invalid_scopes");
  const limits = {
    daily_limit: body.daily_limit ?? 10000,
    hourly_limit: body.hourly_limit ?? 2000,
    refresh_limit: body.refresh_limit ?? 1000,
    member_limit: body.member_limit ?? 10000,
  };
  for (const [key, value] of Object.entries(limits))
    if (
      !Number.isInteger(value) ||
      value < (key === "refresh_limit" ? 0 : 1) ||
      value > (key === "daily_limit" ? 1000000 : 100000)
    )
      throw new Error("invalid_limits");
  if (body.collection_id && !/^[0-9]+$/.test(String(body.collection_id)))
    throw new Error("invalid_collection");
  return { ...limits, scopes: [...new Set(scopes)] };
}

export function integrationsRoutes({
  resolveAccount,
  logEvent,
  mintToken = mintServiceTokenValue,
}) {
  const authorized = async (db, event) => {
    const a = await resolveAccount(db, event, {
      requireContractHeader: event.requestContext?.http?.method !== "GET",
    });
    return a?.isAdmin && a.kind === "person" ? a : null;
  };
  return {
    "GET /api/admin/integrations": async (db, event) => {
      if (!(await authorized(db, event)))
        return json(403, { error: "admin_required" });
      const { rows } = await db.query(`select i.*,a.public_id,a.status,
    (select coalesce(json_agg(json_build_object('collection_id',c.collection_id,'slug',c.slug,'scope',c.scope,'member_limit',g.member_limit,
      'members',(select count(*)::int from collection_member where collection_id=c.collection_id),
      'added_by_integration',(select count(*)::int from collection_member where collection_id=c.collection_id and added_by_integration=i.account_id))), '[]')
      from integration_collection_grant g join collection c using(collection_id) where g.account_id=i.account_id) as collections,
    (select coalesce(json_agg(json_build_object('token_id',t.token_id,'created_at',t.created_at,'last_used_at',t.last_used_at,'revoked_at',t.revoked_at)), '[]')
      from service_token t where t.account_id=i.account_id and t.audience='integration_api') as tokens,
    coalesce(u.calls,0) as calls_today, coalesce(u.refreshes,0) as refreshes_today
    from integration i join account a using(account_id)
    left join integration_usage u on u.account_id=i.account_id and u.day=(now() at time zone 'UTC')::date order by i.name`);
      return json(200, { integrations: rows });
    },
    "POST /api/admin/integrations": async (db, event, body) => {
      const admin = await authorized(db, event);
      if (!admin) return json(403, { error: "admin_required" });
      const action = body.action ?? "create";
      if (
        ![
          "create",
          "configure",
          "rotate",
          "revoke",
          "suspend",
          "resume",
        ].includes(action)
      )
        return json(400, { error: "invalid_action" });
      let policy;
      try {
        if (action === "create" || action === "configure")
          policy = settings(body);
      } catch (e) {
        return json(400, { error: e.message });
      }
      if (
        action === "create" &&
        (typeof body.name !== "string" ||
          !/^[a-z0-9][a-z0-9-]{1,63}$/.test(body.name))
      )
        return json(400, { error: "invalid_name" });
      const minted =
        action === "create" || action === "rotate" ? mintToken() : null;
      await db.query("begin");
      try {
        let integration;
        if (action === "create") {
          const { rows } = await db.query(
            "insert into account(kind,owned_by_account_id,public_id,status,role) values('integration',$1,$2,'approved','partner') returning *",
            [admin.accountId, randomBytes(6).toString("hex")],
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
            return json(404, { error: "not_found" });
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
          if (body.collection_id) {
            const collection = (
              await db.query(
                "select collection_id from collection where collection_id=$1 and kind='player' for update",
                [body.collection_id],
              )
            ).rows[0];
            if (!collection) {
              await db.query("rollback");
              return json(400, { error: "invalid_collection" });
            }
            await db.query(
              "insert into integration_collection_grant(account_id,collection_id,member_limit) values($1,$2,$3) on conflict(account_id,collection_id) do update set member_limit=excluded.member_limit",
              [id, body.collection_id, policy.member_limit],
            );
          }
          if (body.remove_collection_id) {
            if (!/^[0-9]+$/.test(String(body.remove_collection_id)))
              throw new Error("invalid_collection");
            await db.query(
              "delete from integration_collection_grant where account_id=$1 and collection_id=$2",
              [id, body.remove_collection_id],
            );
          }
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
        await logEvent(db, admin.accountId, `integration_${action}`, {
          integration: integration.public_id,
        });
        return json(action === "create" ? 201 : 200, {
          integration: {
            account_id: id,
            public_id: integration.public_id,
            name: integration.name,
          },
          ...(minted ? { token: minted.raw } : {}),
        });
      } catch (error) {
        await db.query("rollback");
        if (error.code === "23505") return json(409, { error: "name_taken" });
        throw error;
      }
    },
  };
}
