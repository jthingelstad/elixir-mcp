/** The versioned JSON API (/api/v1): Elixir's public product beside MCP
 *  (Jamie, 2026-09-23). Two kinds of caller: an integration, by its `svt_`
 *  key (identity is the integration, never its human sponsor), and a person,
 *  by an OAuth grant whose audience is /api/v1 (an `eat_` token; an MCP
 *  token is refused here, as this door's token is refused at MCP). Each
 *  operation declares which kinds it admits (`x-principals`). A
 *  first-party client (the family's own apps) is not metered. */
import { randomUUID } from "node:crypto";
import {
  validateServiceToken,
  validateAccessToken,
  checkRateLimit,
} from "@elixir-mcp/auth";
import { describeIdentity, principalBlock } from "@elixir-mcp/tools/identity";
import { myPlayers } from "@elixir-mcp/record/players";
import { makeRegistry } from "@elixir-mcp/tools";
import { makeInvoker } from "@elixir-mcp/tools/invoker";
import { toolDeadlineMs } from "./deadline.mjs";
import { makeLive } from "@elixir-mcp/tools/live";
import { ERROR_CLASS } from "@elixir-mcp/contracts";
import { normalizeTag } from "@elixir-mcp/contracts";
import { gameClock } from "@elixir-mcp/record/game-clock";
import { readRecordedProfile } from "@elixir-mcp/record/recorded-profile";
import { enqueueJob, takeLiveToken } from "@elixir-mcp/ledger";
import { json, bearer, UUID_RE } from "./http.mjs";
import {
  removeClanFact,
  removeClanFactAsApp,
  writeClanFact,
  writeClanFactAsApp,
  writePlayerFact,
} from "./attested-facts.mjs";
import { sendClanMail } from "./clan-mail.mjs";

/** The audience a person's grant for this door carries (0160). */
const API_RESOURCE = "https://elixir.poapkings.com/api/v1";

/** A person calling v1 through a third-party OAuth client: metered per
 *  account per hour. First-party clients are not (Jamie, 2026-09-23). */
const PERSON_HOURLY_LIMIT = 600;

/** The tools behind the person operations run in the same registry and
 *  invoker as MCP (one data layer): the same facts, the same query
 *  budget, the same live lane, and none of the agent's 48,000-character
 *  cap (2026-09-23: the eight-week clan read crossed it at 48 members). */
let registry = null;
const toolRegistry = () => (registry ??= makeRegistry());
const live = makeLive({ enqueue: (db, job) => enqueueJob(db, job) });
const PERSON_TOOL_BUDGET_MS = 15_000;

/** HTTP status for a tool refusal, by the error code's class. */
const STATUS_OF_CLASS = {
  input: 400,
  subject: 404,
  budget: 429,
  retry: 503,
  server: 502,
};

const flag = (v) => v === "1" || v === "true";

/** A clan's recorded war weeks (2.8.0), for either caller: the
 *  war_history tool over a number of seasons, never one member's. */
function warHistoryRoute(clanTag, query) {
  const seasons =
    query.seasons === undefined ? undefined : Number(query.seasons);
  return {
    operation: "clans.war_history",
    tool: "war_history",
    args: {
      clan_tag: clanTag,
      ...(seasons === undefined ? {} : { seasons }),
    },
  };
}

/** Feedback over the JSON API (3.1.0), for either caller: the MCP tools,
 *  so the record, the checks on what attaches and the answers are the
 *  ones every door shares (@elixir-mcp/feedback). */
const FEEDBACK_FIELDS = [
  "message",
  "category",
  "context",
  "request_id",
  "request_ids",
  "refs",
  "follows_id",
];
const FEEDBACK_QUERY = ["status", "since", "area"];
function feedbackRoute(method, query, body) {
  if (method === "POST")
    return {
      operation: "feedback.send",
      tool: "elixir_send_feedback",
      args: Object.fromEntries(
        FEEDBACK_FIELDS.filter((k) => body[k] !== undefined).map((k) => [
          k,
          body[k],
        ]),
      ),
    };
  return {
    operation: "feedback.list",
    tool: "elixir_my_feedback",
    args: {
      ...Object.fromEntries(
        FEEDBACK_QUERY.filter((k) => query[k] !== undefined).map((k) => [
          k,
          String(query[k]),
        ]),
      ),
      ...(query.limit === undefined ? {} : { limit: Number(query.limit) }),
      ...(query.offset === undefined ? {} : { offset: Number(query.offset) }),
    },
  };
}

/** The operations a person may call, by method and path: each is one
 *  read the family's apps make, answered with the tool's structured
 *  result (Elixir Clan's reads, plan clan-app-api phases 1-3). */
function personRoute(db, account, method, path, query, body) {
  let m;
  if (method === "GET" && path === "/api/v1/me")
    return {
      operation: "me.read",
      run: async () => ({
        principal: principalBlock(
          "person",
          await describeIdentity(db, account),
        ),
        players: await myPlayers(db, account.accountId),
        // The address, for a family app holding account:email (JSON API
        // 2.1.0): the Elixir family's own apps only, as at /oauth/userinfo.
        ...(account.firstParty &&
        (account.scopes ?? []).includes("account:email")
          ? {
              email:
                (
                  await db.query(
                    `select email from account where account_id = $1`,
                    [account.accountId],
                  )
                ).rows[0]?.email ?? null,
            }
          : {}),
      }),
    };
  // Track a player as the signed-in person (JSON API 2.1.0): the
  // elixir_track_player add, for a family app signing a person in (Elixir
  // Drop adds the tag the person saved there, as an alt).
  if (method === "POST" && path === "/api/v1/me/players") {
    const relationship = body.relationship ?? "watching";
    if (!["alt", "friend", "watching"].includes(relationship))
      throw new ApiError(
        400,
        "bad_request",
        "relationship must be alt, friend or watching (the primary is chosen in the console).",
      );
    return {
      operation: "me.players.add",
      tool: "elixir_track_player",
      args: {
        player_tag: String(body.player_tag ?? ""),
        action: "add",
        relationship,
      },
    };
  }
  if (
    method === "GET" &&
    (m =
      /^\/api\/v1\/clans\/([^/]+)\/(participation|roster|war-history|live)$/.exec(
        path,
      ))
  ) {
    const clanTag = tag(decodeURIComponent(m[1]));
    if (m[2] === "war-history") return warHistoryRoute(clanTag, query);
    if (m[2] === "participation") {
      const weeks = query.weeks === undefined ? undefined : Number(query.weeks);
      return {
        operation: "clans.participation",
        tool: "clans_participation",
        args: { clan_tag: clanTag, ...(weeks === undefined ? {} : { weeks }) },
      };
    }
    if (m[2] === "roster")
      return {
        operation: "clans.roster",
        tool: "clans_roster",
        args: { clan_tag: clanTag },
      };
    return {
      operation: "clans.live",
      tool: "live_fetch",
      args: { path: `/clans/${encodeURIComponent(clanTag)}` },
    };
  }
  // Attested facts (2.2.0): what the person did in their clan, through a
  // family app holding clans:attest (attested-facts.mjs checks both).
  if (
    method === "POST" &&
    (m = /^\/api\/v1\/clans\/([^/]+)\/facts$/.exec(path))
  ) {
    const clan = decodeURIComponent(m[1]);
    return {
      operation: "clans.facts.write",
      run: () => writeClanFact(db, account, clan, body),
      statusOf: (r) => (r.created ? 201 : 200),
    };
  }
  if (
    method === "DELETE" &&
    (m = /^\/api\/v1\/clans\/([^/]+)\/facts\/([^/]+)$/.exec(path))
  ) {
    const clan = decodeURIComponent(m[1]);
    const ref = decodeURIComponent(m[2]);
    return {
      operation: "clans.facts.remove",
      run: () => removeClanFact(db, account, clan, ref),
    };
  }
  if ((method === "GET" || method === "POST") && path === "/api/v1/feedback")
    return feedbackRoute(method, query, body);
  if (method === "POST" && path === "/api/v1/players/names") {
    if (!Array.isArray(body.player_tags))
      throw new ApiError(400, "bad_request", "player_tags must be an array.");
    return {
      operation: "players.names",
      tool: "players_names",
      args: { player_tags: body.player_tags },
    };
  }
  if (
    method === "GET" &&
    (m = /^\/api\/v1\/players\/([^/]+)\/(profile|battles)$/.exec(path))
  ) {
    const playerTag = tag(decodeURIComponent(m[1]));
    const fresh = flag(query.fresh);
    if (m[2] === "profile")
      return {
        operation: "players.profile",
        tool: "players_profile",
        args: { player_tag: playerTag, ...(fresh ? { live: true } : {}) },
      };
    const limit = query.limit === undefined ? 25 : Number(query.limit);
    return {
      operation: "players.battles",
      tool: "battles_query",
      args: {
        player_tag: playerTag,
        limit,
        verbosity: "compact",
        ...(fresh ? { live: true } : {}),
      },
    };
  }
  return null;
}

/** A person operation's tool needs its own capability, as the MCP door
 *  checks it (handler.mjs): a read-only grant never runs a write (2.1.0
 *  added the first one). Checked before the tool runs, so the refusal is
 *  audited as the operation (the tool never ran to audit itself). */
function requirePersonToolScope(account, tool) {
  const need = toolRegistry().requiredScope(tool);
  if (need && !(account.scopes ?? []).includes(need))
    throw new ApiError(
      403,
      "insufficient_scope",
      `This grant lacks the capability ${need}.`,
    );
}

/** A failure the caller should retry: the database refused or dropped the
 *  connection, or a statement ran out of time or into a lock or deadlock.
 *  Anything else unexpected is a defect, answered 500 with no Retry-After:
 * a deterministic bug used to answer 503 with
 *  `Retry-After: 5`, asking every caller to retry it forever. */
const TRANSIENT_SQLSTATES = new Set([
  "57014", // statement_timeout
  "55P03", // lock_not_available (lock_timeout)
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "53300", // too_many_connections
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);
const TRANSIENT_NODE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
]);
function isTransientDbError(error) {
  const code = String(error?.code ?? "");
  if (TRANSIENT_SQLSTATES.has(code) || code.startsWith("08")) return true;
  if (TRANSIENT_NODE_CODES.has(code)) return true;
  // node-postgres raises these without a code.
  return /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error|Connection terminated due to connection timeout/i.test(
    String(error?.message ?? ""),
  );
}

/** One tool, as the caller (a person, or an integration whose permission
 *  was checked): the same registry, invoker and budget as MCP. */
async function runTool(db, account, route, event) {
  const invoke = makeInvoker({
    db,
    account,
    registry: toolRegistry(),
    live,
    surface: "rest",
    queryBudgetMs: PERSON_TOOL_BUDGET_MS,
    // The request's deadline reaches every read-only tool, not only the
    // analytical ones the budget covers: clans_participation (p95 10.2 s)
    // ran unbounded here.
    deadlineMs: toolDeadlineMs(event),
  });
  const result = await invoke(route.tool, route.args);
  if (result.isError) {
    const e = result.body?.error ?? {};
    const code = e.code ?? "internal";
    const status = STATUS_OF_CLASS[ERROR_CLASS[code]] ?? 502;
    throw new ApiError(
      code === "not_entitled" ? 403 : status,
      code,
      e.message,
      e.retry_after_s ?? (status === 503 ? 5 : undefined),
      {
        ...(e.hint ? { hint: e.hint } : {}),
        ...(e.retry_after_s !== undefined
          ? { retry_after_s: e.retry_after_s }
          : {}),
      },
    );
  }
  return result.body;
}

class ApiError extends Error {
  constructor(status, code, detail, retryAfter, extra) {
    super(detail ?? code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.extra = extra;
  }
}
export function integrationProblem(
  status,
  code,
  requestId,
  detail,
  retryAfter,
  extra,
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
      ...(extra ?? {}),
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
    if (!job) {
      job = await enqueueJob(db, {
        endpoint: "player",
        entity_key: playerTag,
        lane: "live",
      });
      // A new live row is charged one token from the one global budget;
      // promoting a queued bulk row was paid for
      // when the planner inserted it. With no token the whole transaction
      // rolls back - the job, the refresh and this day's quota count - and
      // the answer is when the budget refills.
      if (job.inserted) {
        const token = await takeLiveToken(db);
        if (!token.ok)
          throw new ApiError(
            429,
            "rate_limited",
            "The shared Clash Royale budget has no room for a live refresh until the next scheduler tick; nothing was charged.",
            token.retry_after_s,
            { retry_after_s: token.retry_after_s },
          );
      }
    }
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

/** `deps.mail` ({ enqueue, secret, archive }) sends a family app's mail
 *  (2.4.0); without it the mail operation answers 503. */
export async function integrationApi(db, event, body, deps = {}) {
  const requestId = randomUUID(),
    started = Date.now();
  let account,
    operation = "unknown",
    response,
    // A person operation that ran a tool is audited by the invoker.
    toolAudited = false;
  const method =
    event.requestContext?.http?.method ?? event.httpMethod ?? "GET";
  try {
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError(400, "invalid_json");
    const token = bearer(event);
    const path = event.rawPath ?? event.path;
    if (String(token ?? "").startsWith("eat_")) {
      // A person, by an OAuth grant for THIS door (audience /api/v1).
      account = await validateAccessToken(db, token, {
        resource: API_RESOURCE,
      });
      if (!account || (account.kind ?? "person") !== "person")
        throw new ApiError(401, "unauthenticated");
      const query = event.queryStringParameters ?? {};
      const route = personRoute(db, account, method, path, query, body);
      if (!route) throw new ApiError(404, "not_found");
      operation = route.operation;
      if (!account.firstParty) {
        const ok = await checkRateLimit(db, {
          bucket: `rest-person-hour:${account.accountId}`,
          max: PERSON_HOURLY_LIMIT,
        });
        if (!ok)
          throw new ApiError(
            429,
            "rate_limited",
            undefined,
            3600 - new Date().getUTCMinutes() * 60,
          );
      }
      if (route.tool) {
        requirePersonToolScope(account, route.tool);
        // From here the invoker audits the call as the tool.
        toolAudited = true;
      }
      const answer = route.tool
        ? await runTool(db, account, route, event)
        : await route.run();
      response = json(
        route.statusOf ? route.statusOf(answer) : 200,
        { data: answer, request_id: requestId },
        { "x-request-id": requestId },
      );
    } else {
      account = await validateServiceToken(db, token, {
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
        method === "GET" &&
        (match =
          /^\/api\/v1\/clans\/([^/]+)\/(participation|roster|war-history)$/.exec(
            path,
          ))
      ) {
        // A family app's scheduled read of a clan (2.3.0, clans:read):
        // Elixir Clan evaluating a clan's policy with nobody signed in.
        // The same tool answers a person's read of the same path.
        scope = "clans:read";
        const clanTag = tag(decodeURIComponent(match[1]));
        const query = event.queryStringParameters ?? {};
        const weeks =
          query.weeks === undefined ? undefined : Number(query.weeks);
        const route =
          match[2] === "war-history"
            ? warHistoryRoute(clanTag, query)
            : match[2] === "participation"
              ? {
                  operation: "clans.participation",
                  tool: "clans_participation",
                  args: {
                    clan_tag: clanTag,
                    ...(weeks === undefined ? {} : { weeks }),
                  },
                }
              : {
                  operation: "clans.roster",
                  tool: "clans_roster",
                  args: { clan_tag: clanTag },
                };
        operation = route.operation;
        run = () => {
          toolAudited = true;
          return runTool(db, account, route, event);
        };
      } else if (
        method === "POST" &&
        (match = /^\/api\/v1\/clans\/([^/]+)\/mail$/.exec(path))
      ) {
        // A family app's own mail, sent through Elixir (2.4.0): Elixir
        // Clan's "actions waiting for you", by player tag, never by address.
        operation = "clans.mail.send";
        scope = "mail:send";
        const clan = decodeURIComponent(match[1]);
        run = () =>
          sendClanMail(
            db,
            { name: policy.name, accountId: account.accountId },
            clan,
            body,
            deps.mail ?? {},
          );
      } else if (
        method === "POST" &&
        (match = /^\/api\/v1\/players\/([^/]+)\/facts$/.exec(path))
      ) {
        // A family app's own game fact for a player (2.2.0): Elixir
        // Drop's personal records, on its integration key.
        operation = "players.facts.write";
        scope = "facts:write";
        const playerTag = decodeURIComponent(match[1]);
        run = async () => {
          const r = await writePlayerFact(
            db,
            { name: policy.name, accountId: account.accountId },
            playerTag,
            body,
          );
          status = r.created ? 201 : 200;
          return r;
        };
      } else if (
        (method === "POST" &&
          (match = /^\/api\/v1\/clans\/([^/]+)\/facts$/.exec(path))) ||
        (method === "DELETE" &&
          (match = /^\/api\/v1\/clans\/([^/]+)\/facts\/([^/]+)$/.exec(path)))
      ) {
        // A family app's own computed clan fact (2.6.0): Elixir Clan's
        // award standings, on its integration key, labelled as the app's.
        scope = "facts:write";
        const clan = decodeURIComponent(match[1]);
        const app = { name: policy.name, accountId: account.accountId };
        if (method === "POST") {
          operation = "clans.facts.write";
          run = async () => {
            const r = await writeClanFactAsApp(db, app, clan, body);
            status = r.created ? 201 : 200;
            return r;
          };
        } else {
          operation = "clans.facts.remove";
          const ref = decodeURIComponent(match[2]);
          run = () => removeClanFactAsApp(db, app, clan, ref);
        }
      } else if (
        (method === "GET" || method === "POST") &&
        path === "/api/v1/feedback"
      ) {
        // An integration's own feedback (3.1.0), filed as itself.
        scope = "feedback:write";
        const route = feedbackRoute(
          method,
          event.queryStringParameters ?? {},
          body,
        );
        operation = route.operation;
        run = () => {
          toolAudited = true;
          return runTool(db, account, route, event);
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
    }
  } catch (error) {
    if (!error.status && !(error instanceof URIError))
      console.error("integration_api_failed", {
        request_id: requestId,
        operation,
        error: error.name,
        code: error.code,
      });
    const status =
      error.status ??
      (error instanceof URIError ? 400 : isTransientDbError(error) ? 503 : 500);
    response = integrationProblem(
      status,
      error.status
        ? error.code
        : status === 400
          ? "bad_request"
          : status === 503
            ? "temporarily_unavailable"
            : "internal",
      requestId,
      error.status ? error.message : undefined,
      error.retryAfter ?? (status === 503 ? 5 : undefined),
      error.extra,
    );
  }
  if (account && !toolAudited)
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
