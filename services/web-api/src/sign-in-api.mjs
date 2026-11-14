/** /api/v1, what Sign in with Elixir needs and nothing more (Jamie,
 *  2026-11-13: "Keep only sign-in"): `GET /api/v1/me`, who a signed-in
 *  person is and their players, for a person's OAuth grant whose audience
 *  is /api/v1 (an `eat_` token). An MCP token is refused here, as this
 *  door's token is refused at MCP. A first-party client (the family's own
 *  apps, Elixir Drop) is not metered; any other is, per person per hour.
 *
 *  The integration keys, the tool mirrors and the social reads that used
 *  to answer here went in JSON API 5.0.0 ("No integrations: Elixir has
 *  users and agents"). */
import { randomUUID } from "node:crypto";
import {
  validateAccessToken,
  checkRateLimit,
  WINDOW_SECONDS,
} from "@elixir-mcp/auth";
import { describeIdentity, principalBlock } from "@elixir-mcp/tools/identity";
import { myPlayers } from "@elixir-mcp/record/players";
import { avatarCrop } from "@elixir-mcp/ui/avatar-crops";
import contract from "@elixir-mcp/contracts/integration-api.openapi.json" with { type: "json" };
import { json, bearer } from "./http.mjs";

/** The audience a person's grant for this door carries (0160). */
const API_RESOURCE = "https://elixir.poapkings.com/api/v1";

/** A person calling through a third-party OAuth client: metered per
 *  account per hour. First-party clients are not (Jamie, 2026-09-23). */
const PERSON_HOURLY_LIMIT = 600;

/** Where the card art lives: Elixir's mirror, on Elixir's own origin, so
 *  an app on another origin draws the same file Elixir does. */
const ORIGIN = new URL(API_RESOURCE).origin;

/** Where a problem's `type` points: the page that lists the codes. */
const DOCS = "https://elixir.poapkings.com/docs/sign-in-with-elixir";

/** What a 404 for a path no operation answers says (review 2026-10-21). */
const UNKNOWN_OPERATION = `No /api/v1 operation answers this method at this path. /api/v1 serves only GET /api/v1/me, for Sign in with Elixir: ${DOCS} and https://elixir.poapkings.com/docs/integration-api.json.`;

/** Every operation, by method and path, as the OpenAPI document declares
 *  it: the one list. It names the operation on the door's request line,
 *  and a path no operation answers gets a 404 before any credential is
 *  read (review 2026-10-21: OpenAI-style clients' `GET /api/v1/models`
 *  was answered 401, as if a key would have helped). */
const OPERATIONS = Object.entries(contract.paths).flatMap(
  ([template, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      method: method.toUpperCase(),
      path: `/api/v1${template}`,
      operationId: operation.operationId,
    })),
);

/** The operationId a request names, or null when no operation answers
 *  this method at this path. */
export function v1Operation(method, path) {
  const m = String(method ?? "GET").toUpperCase();
  const p = String(path ?? "");
  return (
    OPERATIONS.find((op) => op.method === m && op.path === p)?.operationId ??
    null
  );
}

/** Seconds until the hourly windows of checkRateLimit roll over: the
 *  Retry-After of an hourly 429. Seconds as well as minutes, so a 429 at
 *  12:59:50 says 10, not 60, and never 0. */
export function secondsLeftInHour(now = Date.now()) {
  return Math.max(
    1,
    WINDOW_SECONDS - (Math.floor(now / 1000) % WINDOW_SECONDS),
  );
}

/** A failure the caller should retry: the database refused or dropped the
 *  connection, or a statement ran out of time or into a lock or deadlock.
 *  Anything else unexpected is a defect, answered 500 with no Retry-After. */
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

class ApiError extends Error {
  constructor(status, code, detail, retryAfter) {
    super(detail ?? code);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** The door's error shape (RFC 9457 problem details). */
export function apiProblem(status, code, requestId, detail, retryAfter) {
  return json(
    status,
    {
      type: `${DOCS}/#errors`,
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

/** The account's profile image (5.1.0), or null when it has none: the
 *  card, its name, the art's address and where Elixir crops it, so an app
 *  draws the circle Elixir draws without Elixir's crop table. */
async function avatarOf(db, accountId) {
  const { rows } = await db.query(
    `select a.avatar_card_id, c.name
       from account a
       left join card c on c.card_id = a.avatar_card_id
      where a.account_id = $1`,
    [accountId],
  );
  const id = rows[0]?.avatar_card_id;
  if (id == null) return null;
  const { x, y, scale } = avatarCrop(id);
  return {
    card_id: id,
    name: rows[0].name ?? null,
    art_url: `${ORIGIN}/assets/cards/${id}.png`,
    crop: { x, y, scale },
  };
}

/** Who the signed-in person is: the principal block MCP initialize
 *  carries, the account id (userinfo's `sub`, stable for the account's
 *  life, 5.0.0), the players they follow, the profile image (5.1.0), and
 *  for a family app holding account:email the address (2.1.0), as at
 *  /oauth/userinfo. */
async function me(db, account) {
  return {
    account_id: account.accountId,
    principal: principalBlock("person", await describeIdentity(db, account)),
    players: await myPlayers(db, account.accountId),
    avatar: await avatarOf(db, account.accountId),
    ...(account.firstParty && (account.scopes ?? []).includes("account:email")
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
  };
}

export async function signInApi(db, event, body) {
  const requestId = randomUUID(),
    started = Date.now();
  let account, response;
  const method = event.method ?? "GET";
  const operation = v1Operation(method, event.path);
  try {
    if (!operation) throw new ApiError(404, "not_found", UNKNOWN_OPERATION);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new ApiError(400, "invalid_json");
    const token = bearer(event);
    // A person, by an OAuth grant for THIS door (audience /api/v1); any
    // other credential, an old integration key included, is unknown here.
    account = String(token ?? "").startsWith("eat_")
      ? await validateAccessToken(db, token, { resource: API_RESOURCE })
      : null;
    if (!account || (account.kind ?? "person") !== "person") {
      account = null;
      throw new ApiError(401, "unauthenticated");
    }
    if (!account.firstParty) {
      const ok = await checkRateLimit(db, {
        bucket: `rest-person-hour:${account.accountId}`,
        max: PERSON_HOURLY_LIMIT,
      });
      if (!ok)
        throw new ApiError(429, "rate_limited", undefined, secondsLeftInHour());
    }
    response = json(
      200,
      { data: await me(db, account), request_id: requestId },
      { "x-request-id": requestId },
    );
  } catch (error) {
    if (!error.status)
      console.error("sign_in_api_failed", {
        request_id: requestId,
        operation,
        error: error.name,
        code: error.code,
      });
    const status = error.status ?? (isTransientDbError(error) ? 503 : 500);
    response = apiProblem(
      status,
      error.status
        ? error.code
        : status === 503
          ? "temporarily_unavailable"
          : "internal",
      requestId,
      error.status ? error.message : undefined,
      error.retryAfter ?? (status === 503 ? 5 : undefined),
    );
  }
  if (account)
    await db
      .query(
        `insert into mcp_call_audit(account_id,token_id,request_id,surface,tool,args,duration_ms,result_bytes,error_code,http_status)
   values($1,$2,$3,'rest','me.read','{}',$4,$5,$6,$7)`,
        [
          account.accountId,
          account.tokenId,
          requestId,
          Date.now() - started,
          Buffer.byteLength(response.body),
          response.statusCode >= 400 ? JSON.parse(response.body).code : null,
          response.statusCode,
        ],
      )
      .catch(() => {});
  return response;
}
