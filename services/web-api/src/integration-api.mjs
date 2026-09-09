import integrationContract from "@elixir-mcp/contracts/integration-api.openapi.json" with { type: "json" };
/** Versioned platform API. Identity is an integration, never its human sponsor. */
import { randomUUID } from "node:crypto";
import { validateServiceToken, checkRateLimit } from "@elixir-mcp/auth";
import { normalizeTag } from "@elixir-mcp/contracts";
import { setCollectionMembers } from "@elixir-mcp/claims";
import { gameClock } from "../../ingest/src/game-clock.mjs";
import { readRecordedProfile } from "../../ingest/src/recorded-profile.mjs";
import { enqueueJob } from "../../scheduler/src/ledger.mjs";
import { json, bearer, UUID_RE } from "./http.mjs";

export const INTEGRATION_SCOPES = [
  ...new Set(
    Object.values(integrationContract.paths).flatMap((methods) =>
      Object.values(methods).map((operation) => operation["x-permission"]),
    ),
  ),
];

class ApiError extends Error {
  constructor(status, code, detail, retryAfter) {
    super(detail ?? code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}
export function integrationProblem(
  status,
  code,
  requestId,
  detail,
  retryAfter,
) {
  return json(
    status,
    {
      type: `https://elixir.poapkings.com/docs/integrations/#${code}`,
      title: code,
      status,
      code,
      detail: detail ?? code,
      request_id: requestId,
    },
    {
      "content-type": "application/problem+json",
      "x-request-id": requestId,
      ...(retryAfter ? { "retry-after": String(retryAfter) } : {}),
    },
  );
}
function tag(value) {
  try {
    return normalizeTag(value);
  } catch {
    throw new ApiError(400, "invalid_tag");
  }
}

async function profile(db, playerTag) {
  const row = await readRecordedProfile(db, playerTag);
  const { rows } = await db.query(
    "select max(fetched_at) as observed_at from api_receipt where endpoint='player' and entity_key=$1 and admission='admitted'",
    [playerTag],
  );
  if (!row?.snapshot_date || !rows[0]?.observed_at)
    throw new ApiError(404, "not_recorded");
  return {
    player_tag: row.player_tag,
    name: row.name,
    clan: row.last_known_clan_tag
      ? {
          clan_tag: row.last_known_clan_tag,
          name: row.clan_name,
          badge_id: row.clan_badge_id,
          role: row.last_known_clan_role,
        }
      : null,
    attributes: {
      years_played: row.years_played,
      account_age_days: row.account_age_days,
    },
    observed_at: rows[0].observed_at.toISOString(),
  };
}

async function refreshStatus(db, accountId, id) {
  const { rows } = await db.query(
    `select f.*, j.status as job_status,
   r.admission, r.fetched_at from integration_profile_refresh f
   left join job j on j.job_id=f.job_id
   left join lateral (select admission,fetched_at from api_receipt
      where job_id=f.job_id and endpoint='player' and entity_key=f.player_tag
      order by receipt_id desc limit 1) r on true
   where f.account_id=$1 and f.refresh_id=$2 and f.created_at > now() - interval '1 day'`,
    [accountId, id],
  );
  const row = rows[0];
  if (!row) throw new ApiError(404, "not_found");
  let status = "pending",
    result;
  if (row.admission === "admitted") {
    try {
      result = await profile(db, row.player_tag);
      status = "complete";
    } catch (e) {
      if (e.code !== "not_recorded") throw e;
    }
  } else if (
    row.admission === "rejected" ||
    row.job_status === "dead" ||
    Date.now() - row.created_at.getTime() > 15 * 60_000
  )
    status = "failed";
  return {
    id: row.refresh_id,
    player_tag: row.player_tag,
    status,
    created_at: row.created_at.toISOString(),
    expires_at: new Date(row.created_at.getTime() + 86400_000).toISOString(),
    ...(result ? { profile: result } : {}),
    ...(status === "failed" ? { error: "refresh_unavailable" } : {}),
  };
}
async function requestRefresh(db, account, policy, body, event) {
  const playerTag = tag(body.player_tag);
  const key = event.headers?.["idempotency-key"];
  if (typeof key !== "string" || !key.length || key.length > 128)
    throw new ApiError(400, "idempotency_key_required");
  await db.query("begin");
  try {
    // Serializes retries, quota spending, and tag-level job sharing without
    // changing the collector's global lane budget or leasing protocol.
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [
      `integration:${account.accountId}`,
    ]);
    await db.query(
      "delete from integration_profile_refresh where account_id=$1 and idempotency_key=$2 and created_at <= now() - interval '1 day'",
      [account.accountId, key],
    );
    const prior = (
      await db.query(
        "select * from integration_profile_refresh where account_id=$1 and idempotency_key=$2",
        [account.accountId, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.player_tag !== playerTag)
        throw new ApiError(409, "idempotency_conflict");
      await db.query("commit");
      return refreshStatus(db, account.accountId, prior.refresh_id);
    }
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [
      `profile-refresh:${playerTag}`,
    ]);
    // A repeated request with a new key may share an active request, but a
    // completed old observation is never passed off as a new live refresh.
    let job = (
      await db.query(
        "select job_id from job where endpoint='player' and entity_key=$1 and lane='live' and status in ('queued','leased') order by job_id limit 1",
        [playerTag],
      )
    ).rows[0];
    const usage = (
      await db.query(
        `insert into integration_usage(account_id,day,refreshes) values ($1,(now() at time zone 'UTC')::date,1)
     on conflict(account_id,day) do update set refreshes=integration_usage.refreshes+1 returning refreshes`,
        [account.accountId],
      )
    ).rows[0];
    if (usage.refreshes > policy.refresh_limit)
      throw new ApiError(429, "refresh_quota_exceeded", undefined, 3600);
    if (!job)
      job = await enqueueJob(db, {
        endpoint: "player",
        entity_key: playerTag,
        lane: "live",
      });
    const row = (
      await db.query(
        "insert into integration_profile_refresh(account_id,player_tag,idempotency_key,job_id) values($1,$2,$3,$4) returning refresh_id",
        [account.accountId, playerTag, key, job.job_id],
      )
    ).rows[0];
    await db.query("commit");
    return refreshStatus(db, account.accountId, row.refresh_id);
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}

export async function integrationApi(db, event, body) {
  const requestId = randomUUID(),
    started = Date.now();
  let account,
    operation = "unknown",
    response;
  const method =
    event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
  try {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError(400, "invalid_json");
    account = await validateServiceToken(db, bearer(event), {
      audience: "integration_api",
    });
    if (!account || account.kind !== "integration")
      throw new ApiError(401, "unauthenticated");
    const policy = (
      await db.query("select * from integration where account_id=$1", [
        account.accountId,
      ])
    ).rows[0];
    if (!policy) throw new ApiError(401, "unauthenticated");
    const ok = await checkRateLimit(db, {
      bucket: `rest-hour:${account.accountId}`,
      max: policy.hourly_limit,
    });
    if (!ok)
      throw new ApiError(
        429,
        "rate_limited",
        undefined,
        3600 - new Date().getUTCMinutes() * 60,
      );
    const usage = (
      await db.query(
        `insert into integration_usage(account_id,day,calls) values($1,(now() at time zone 'UTC')::date,1)
    on conflict(account_id,day) do update set calls=integration_usage.calls+1 returning calls`,
        [account.accountId],
      )
    ).rows[0];
    if (usage.calls > policy.daily_limit)
      throw new ApiError(
        429,
        "daily_quota_exceeded",
        undefined,
        86400 - (Math.floor(Date.now() / 1000) % 86400),
      );
    const path = event.rawPath ?? event.path;
    let match,
      scope,
      run,
      status = 200,
      headers = {};
    if (method === "GET" && path === "/api/v1/game/clock") {
      operation = "game.clock";
      scope = "game:read";
      run = () => ({ ...gameClock(), source: "policy" });
    } else if (
      method === "GET" &&
      (match = /^\/api\/v1\/players\/([^/]+)$/.exec(path))
    ) {
      operation = "players.read";
      scope = "players:read";
      const playerTag = tag(decodeURIComponent(match[1]));
      run = () => profile(db, playerTag);
    } else if (method === "POST" && path === "/api/v1/profile-refreshes") {
      operation = "profiles.refresh";
      scope = "profiles:refresh";
      status = 202;
      run = async () => {
        const r = await requestRefresh(db, account, policy, body, event);
        headers = {
          location: `/api/v1/profile-refreshes/${r.id}`,
          "retry-after": "5",
        };
        return r;
      };
    } else if (
      method === "GET" &&
      (match = /^\/api\/v1\/profile-refreshes\/([^/]+)$/.exec(path))
    ) {
      operation = "profiles.status";
      scope = "profiles:refresh";
      const id = match[1];
      if (!UUID_RE.test(id)) throw new ApiError(404, "not_found");
      run = () => refreshStatus(db, account.accountId, id);
    } else if (
      (method === "PUT" || method === "POST") &&
      (match = /^\/api\/v1\/collections\/([^/]+)\/members(?:\/([^/]+))?$/.exec(
        path,
      ))
    ) {
      if ((method === "PUT") !== Boolean(match[2]))
        throw new ApiError(404, "not_found");
      operation = "collections.members.add";
      scope = "collections:members:add";
      const id = decodeURIComponent(match[1]);
      const values =
        method === "PUT" ? [decodeURIComponent(match[2])] : body.tags;
      if (!Array.isArray(values) || values.length < 1 || values.length > 500)
        throw new ApiError(400, "invalid_members");
      const tags = values.map(tag);
      run = async () => {
        const grant = (
          await db.query(
            `select c.*,g.member_limit from integration_collection_grant g join collection c using(collection_id)
        where g.account_id=$1 and (c.collection_id::text=$2 or c.slug=$2) and c.kind='player'`,
            [account.accountId, id],
          )
        ).rows[0];
        if (!grant) throw new ApiError(404, "not_found");
        const result = await setCollectionMembers(
          db,
          {
            collectionId: grant.collection_id,
            kind: grant.kind,
            ownerAccount: grant.owner_account,
          },
          tags,
          {
            mode: "add",
            reconcileProvided: true,
            memberLimit: grant.member_limit,
            integrationId: account.accountId,
          },
        );
        return {
          collection_id: grant.collection_id,
          added: result.added,
          already_present: new Set(tags).size - result.added,
          total: result.total,
          enrollment_established: true,
          recordings_started: result.recordingsStarted,
        };
      };
    } else throw new ApiError(404, "not_found");
    if (!policy.scopes.includes(scope))
      throw new ApiError(403, "insufficient_scope");
    const result = await run();
    response = json(
      status,
      { data: result, request_id: requestId },
      { "x-request-id": requestId, ...headers },
    );
  } catch (error) {
    if (
      !error.status &&
      error.code !== "enrollment_limit" &&
      !(error instanceof URIError)
    )
      console.error("integration_api_failed", {
        request_id: requestId,
        operation,
        error: error.name,
        code: error.code,
      });
    const status =
      error.status ??
      (error.code === "enrollment_limit"
        ? 409
        : error instanceof URIError
          ? 400
          : 503);
    response = integrationProblem(
      status,
      error.status || error.code === "enrollment_limit"
        ? error.code
        : status === 400
          ? "bad_request"
          : "temporarily_unavailable",
      requestId,
      error.status ? error.message : undefined,
      error.retryAfter ?? (status === 503 ? 5 : undefined),
    );
  }
  if (account)
    await db
      .query(
        `insert into mcp_call_audit(account_id,token_id,request_id,surface,tool,args,duration_ms,result_bytes,error_code,http_status)
   values($1,$2,$3,'rest',$4,'{}',$5,$6,$7,$8)`,
        [
          account.accountId,
          account.tokenId,
          requestId,
          operation,
          Date.now() - started,
          Buffer.byteLength(response.body),
          response.statusCode >= 400 ? JSON.parse(response.body).code : null,
          response.statusCode,
        ],
      )
      .catch(() => {});
  return response;
}
