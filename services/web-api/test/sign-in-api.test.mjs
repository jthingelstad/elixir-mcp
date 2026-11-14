/**
 * /api/v1 is Sign in with Elixir's one read, `GET /api/v1/me` (JSON API
 * 5.0.0; Jamie, 2026-11-13: "Keep only sign-in"). These pin what Elixir
 * Drop's sign-in reads today, unchanged by the cut: a family app's grant
 * with `cr:read account:email` reads who the person is, their players
 * and their address; the account id (userinfo's `sub`) rides beside them
 * since 5.0.0, and the profile image since 5.1.0. Every other path,
 * the ones 4.x served included, is the unknown operation's 404 whatever
 * the credential, and an old integration key is no credential at all.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { makeInvoker } from "../../../packages/tools/src/invoker.mjs";
import { makeRegistry } from "../../../packages/tools/src/tools.mjs";
import {
  mintServiceTokenValue,
  mintTokens,
  registerClient,
  validateAccessToken,
} from "@elixir-mcp/auth";
import { myPlayers } from "@elixir-mcp/record/players";
import { avatarCrop } from "@elixir-mcp/ui/avatar-crops";
import { ensureSeasonsAround } from "@elixir-mcp/record/season";
import { makeHandler } from "../src/handler.mjs";
import { signInApi, secondsLeftInHour } from "../src/sign-in-api.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_sign_in_api_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
const API = "https://elixir.poapkings.com/api/v1";
const PLAYER = "#0QRVVG22J"; // fixtures/player/profile.json
let db, handler, person, drop, outside, keyRaw;

const call = (method, path, token, body) =>
  handler({
    path,
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const data = (r) => JSON.parse(r.body);
const wire = (value) => JSON.parse(JSON.stringify(value));
const grant = async (client, scope, resource = API) =>
  (
    await mintTokens(db, {
      clientId: client.clientId,
      accountId: person,
      scope,
      resource,
    })
  ).accessToken;

before(async () => {
  await createScratch(name);
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await ensureSeasonsAround(db);
  person = (
    await db.query(
      "insert into account(email_hash,email,status,role) values ('sign-in-api','person@example.org','approved','member') returning account_id",
    )
  ).rows[0].account_id;

  // The person's verified primary, as ingest records it.
  await db.query("insert into player(player_tag) values ($1)", [PLAYER]);
  await db.query(
    "insert into claim(account_id,player_tag,status,is_primary) values ($1,$2,'verified',true)",
    [person, PLAYER],
  );
  await db.query(
    "insert into recording(subject_type,subject_tag,requested_by) values ('player',$1,$2)",
    [PLAYER, person],
  );
  const gateway = (
    await db.query(
      "insert into gateway(owner_account_id,name,static_ip,status) values ($1,'sign-in-gw','127.0.0.1','active') returning gateway_id",
      [person],
    )
  ).rows[0].gateway_id;
  const payload = JSON.parse(
    await readFile(
      new URL("../../../fixtures/player/profile.json", import.meta.url),
      "utf8",
    ),
  );
  const result = await processResult(db, {
    v: 1,
    job: { endpoint: "player", entity_key: PLAYER, lane: "bulk" },
    gateway_id: gateway,
    fetched_at: new Date().toISOString(),
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  });
  assert.equal(result.outcome, "admitted", JSON.stringify(result));

  // Elixir Drop: a provisioned family client (0185).
  drop = await registerClient(db, {
    clientName: "Elixir Drop",
    redirectUris: ["https://drop.poapkings.com/auth/elixir/callback"],
  });
  await db.query(
    "insert into family_oauth_client (client_id, app) values ($1, 'test-drop')",
    [drop.clientId],
  );
  outside = await registerClient(db, {
    clientName: "Someone's app",
    redirectUris: ["https://example.org/callback"],
  });

  // An integration key as 4.x minted one: the row stays, the door is gone.
  const integration = (
    await db.query(
      "insert into account(kind,owned_by_account_id,public_id,status,role) values ('integration',$1,'0a1b2c3d4e5f','approved','partner') returning account_id",
      [person],
    )
  ).rows[0].account_id;
  const key = mintServiceTokenValue();
  keyRaw = key.raw;
  await db.query(
    "insert into service_token(account_id,name,token_hash,scope,audience) values ($1,'old-site',$2,'','integration_api')",
    [integration, key.hash],
  );
  handler = makeHandler({ databaseUrl, secret: "test" });
});
after(async () => {
  await db?.end();
  await dropScratch(name);
});

test("Drop's sign-in read: who the person is, their account id, their players and their address", async () => {
  const token = await grant(drop, "cr:read account:email");
  const me = await call("GET", "/api/v1/me", token);
  assert.equal(me.statusCode, 200, me.body);
  const body = data(me);
  assert.ok(body.request_id);
  assert.equal(me.headers["x-request-id"], body.request_id);
  // The id /oauth/userinfo answers as sub: the grant's own account.
  const account = await validateAccessToken(db, token, { resource: API });
  assert.equal(body.data.account_id, account.accountId);
  assert.equal(body.data.account_id, person);
  assert.equal(body.data.principal.kind, "person");
  assert.equal(body.data.email, "person@example.org");
  // What Drop reads of each player: its tag, name and clan.
  const [primary] = body.data.players;
  assert.equal(primary.player_tag, PLAYER);
  assert.equal(primary.relationship, "primary");
  for (const field of ["name", "clan_tag", "clan_name", "clan_role"])
    assert.ok(field in primary, field);
  // And the players are record's myPlayers, as elixir_my_players lists them.
  const listed = wire(await myPlayers(db, person));
  assert.deepEqual(body.data.players, listed);
  const tool = await makeInvoker({
    db,
    account: { accountId: person, emailHash: "sign-in-api" },
    registry: makeRegistry(),
  })("elixir_my_players", {});
  assert.equal(tool.isError, false, JSON.stringify(tool.body));
  assert.deepEqual(wire(tool.body.players), listed);
});

test("the profile image: null until chosen, then the card, its art and Elixir's crop (5.1.0)", async () => {
  const token = await grant(drop, "cr:read");
  const before = data(await call("GET", "/api/v1/me", token)).data;
  assert.equal(before.avatar, null);
  assert.ok("avatar" in before);

  // Mirror carries Elixir's own crop; Knight carries Drop's.
  await db.query(
    `insert into card (card_id, name, kind, icon_medium, in_catalog)
     values (28000006, 'Mirror', 'card', 'https://example.invalid/m.png', true),
            (26000000, 'Knight', 'card', 'https://example.invalid/k.png', true)
     on conflict (card_id) do nothing`,
  );
  try {
    for (const [id, name, crop] of [
      [28000006, "Mirror", avatarCrop(28000006)],
      [26000000, "Knight", { x: 43, y: 40, scale: 1.39 }],
    ]) {
      await db.query(
        "update account set avatar_card_id = $2, avatar_set_at = now() where account_id = $1",
        [person, id],
      );
      const me = data(await call("GET", "/api/v1/me", token)).data;
      assert.deepEqual(me.avatar, {
        card_id: id,
        name,
        art_url: `https://elixir.poapkings.com/assets/cards/${id}.png`,
        crop,
      });
    }
    // Elixir's Mirror row, not the default.
    assert.notDeepEqual(avatarCrop(28000006), avatarCrop(28000025));
  } finally {
    await db.query(
      "update account set avatar_card_id = null, avatar_set_at = null where account_id = $1",
      [person],
    );
  }
});

test("the primary player and its game name, as Drop shows it, stored as the game sent it", async () => {
  const hostile = `<img src=x onerror=alert(1)>"&'`;
  const { rows } = await db.query(
    "select name from player where player_tag = $1",
    [PLAYER],
  );
  await db.query("update player set name = $2 where player_tag = $1", [
    PLAYER,
    hostile,
  ]);
  try {
    const token = await grant(drop, "cr:read");
    const me = data(await call("GET", "/api/v1/me", token)).data;
    const primary = me.players.find((p) => p.is_primary);
    assert.equal(primary.player_tag, PLAYER);
    assert.equal(primary.claim_status, "verified");
    // Unchanged: the client escapes at output, Elixir never rewrites it.
    assert.equal(primary.name, hostile);
    assert.deepEqual(me.principal.subject, {
      type: "player",
      tag: PLAYER,
      name: hostile,
    });
  } finally {
    await db.query("update player set name = $2 where player_tag = $1", [
      PLAYER,
      rows[0].name,
    ]);
  }
});

test("the address only for a family app holding account:email", async () => {
  for (const token of [
    await grant(drop, "cr:read"),
    await grant(outside, "cr:read account:email"),
  ]) {
    const me = await call("GET", "/api/v1/me", token);
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(data(me).data.email, undefined);
    assert.equal(data(me).data.account_id, person);
  }
});

test("only a person's grant for this door: an MCP grant, an old integration key or none is 401, and this grant is refused at MCP", async () => {
  const mcp = await grant(drop, "cr:read", "https://elixir.poapkings.com/mcp");
  for (const token of [undefined, "sk-not-an-elixir-key", mcp, keyRaw]) {
    const r = await call("GET", "/api/v1/me", token);
    assert.equal(r.statusCode, 401, r.body);
    assert.equal(data(r).code, "unauthenticated");
    assert.equal(r.headers["content-type"], "application/problem+json");
  }
  const token = await grant(drop, "cr:read");
  assert.equal(
    await validateAccessToken(db, token, {
      resource: "https://elixir.poapkings.com/mcp",
    }),
    null,
  );
});

test("every other path, 4.x's operations included, is the unknown operation's 404 whatever the credential", async () => {
  const { rows: mark } = await db.query(
    `select coalesce(max(audit_id), 0) as last from mcp_call_audit`,
  );
  const drops = await grant(drop, "cr:read account:email follows:write");
  for (const [method, path, body] of [
    ["POST", "/api/v1/me/players", { player_tag: "#0QRVVG22J" }],
    ["GET", "/api/v1/me/cheers"],
    ["GET", "/api/v1/game/clock"],
    ["GET", `/api/v1/players/${encodeURIComponent(PLAYER)}`],
    ["GET", `/api/v1/players/${encodeURIComponent(PLAYER)}/profile`],
    ["POST", `/api/v1/players/${encodeURIComponent(PLAYER)}/facts`, {}],
    ["POST", "/api/v1/profile-refreshes", { player_tag: PLAYER }],
    ["GET", "/api/v1/clans/%23J2RGCRVG/roster"],
    ["GET", "/api/v1/clans/directory"],
    ["POST", "/api/v1/players/names", { player_tags: [PLAYER] }],
    ["GET", "/api/v1/feedback"],
    ["GET", "/api/v1/models"],
    ["POST", "/api/v1/me"],
  ])
    for (const token of [undefined, drops, keyRaw]) {
      const r = await call(method, path, token, body);
      assert.equal(r.statusCode, 404, `${method} ${path}: ${r.body}`);
      const problem = data(r);
      assert.equal(problem.code, "not_found");
      assert.match(problem.detail, /docs\/sign-in-with-elixir/);
      assert.equal(r.headers["content-type"], "application/problem+json");
    }
  // A body that is not JSON does not change that answer (Codex on #621).
  const garbled = await handler({
    path: "/api/v1/chat/completions",
    method: "POST",
    headers: {},
    body: "{not json",
  });
  assert.equal(garbled.statusCode, 404, garbled.body);
  // Nothing was authenticated, so nothing was audited.
  const { rows } = await db.query(
    `select count(*)::int as n from mcp_call_audit where audit_id > $1`,
    [mark[0].last],
  );
  assert.equal(rows[0].n, 0);
});

test("a signed-in read is audited, and the request line names the operation", async () => {
  const token = await grant(drop, "cr:read");
  const lines = [];
  const info = console.info;
  console.info = (line) => lines.push(line);
  let r;
  try {
    r = await call("GET", "/api/v1/me", token);
  } finally {
    console.info = info;
  }
  const line = lines.find((l) => l?.http === "GET /api/v1/*");
  assert.ok(line, "no request line");
  assert.equal(line.operation, "me");
  assert.equal(line.status, 200);
  const { rows } = await db.query(
    "select tool, http_status from mcp_call_audit where request_id = $1",
    [data(r).request_id],
  );
  assert.deepEqual(rows, [{ tool: "me.read", http_status: 200 }]);
});

/** The real client, with the read of the players made to fail. */
function failing(failure) {
  return {
    query: (sql, params) =>
      /from claim c/.test(String(sql))
        ? Promise.reject(failure())
        : db.query(sql, params),
  };
}

test("an unexpected exception is a 500 internal with no Retry-After; a connection or timeout failure a 503 to retry", async () => {
  const token = await grant(drop, "cr:read");
  const event = {
    path: "/api/v1/me",
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  };
  const error = console.error;
  console.error = () => {};
  try {
    const broken = await signInApi(
      failing(() => new TypeError("cannot read properties of undefined")),
      event,
      {},
    );
    assert.equal(broken.statusCode, 500, broken.body);
    assert.equal(data(broken).code, "internal");
    assert.equal(broken.headers["retry-after"], undefined);
    for (const failure of [
      () =>
        Object.assign(new Error("terminating connection"), { code: "57P01" }),
      () =>
        Object.assign(
          new Error("canceling statement due to statement timeout"),
          { code: "57014" },
        ),
      () => new Error("Connection terminated unexpectedly"),
    ]) {
      const r = await signInApi(failing(failure), event, {});
      assert.equal(r.statusCode, 503, r.body);
      assert.equal(data(r).code, "temporarily_unavailable");
      assert.equal(r.headers["retry-after"], "5");
    }
  } finally {
    console.error = error;
  }
});

test("an hourly 429 waits the seconds to the top of the hour, never 0", () => {
  const at = (iso) => secondsLeftInHour(Date.parse(iso));
  assert.equal(at("2026-10-21T12:59:50.000Z"), 10);
  assert.equal(at("2026-10-21T12:59:59.900Z"), 1);
  assert.equal(at("2026-10-21T12:00:00.000Z"), 3600);
  assert.equal(at("2026-10-21T12:30:15.500Z"), 1785);
});
