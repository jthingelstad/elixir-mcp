/**
 * Both doors, one set of facts (the structural assessment of 2026-09-28,
 * Phase 4). An /api/v1 operation and the MCP tool it answers beside read
 * the same @elixir-mcp/record function, so they can differ only in their
 * envelope. These pin that for the three operations web-api answers
 * itself rather than through the tool: /me, /game/clock and
 * /players/{tag}. A second derivation on either side fails here.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { processResult } from "../../../packages/ingest/src/pipeline.mjs";
import { makeInvoker } from "../../../packages/tools/src/invoker.mjs";
import { makeRegistry } from "../../../packages/tools/src/tools.mjs";
import { createSession, mintTokens, registerClient } from "@elixir-mcp/auth";
import { myPlayers } from "@elixir-mcp/record/players";
import { ensureSeasonsAround } from "@elixir-mcp/record/season";
import { makeHandler } from "../src/handler.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_record_parity_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
const PLAYER = "#JYRQ8U92C"; // fixtures/player/profile.json
let db, handler, invoke, cookie, person, personToken, integrationToken;

const request = (method, path, token) =>
  handler({
    rawPath: path,
    requestContext: { http: { method } },
    headers: token
      ? { authorization: `Bearer ${token}` }
      : { cookie, "x-elixir-client": "web" },
  });
const data = (r) => JSON.parse(r.body);
// What either door puts on the wire: a Date is its ISO string there.
const wire = (value) => JSON.parse(JSON.stringify(value));

before(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  await migrate({
    databaseUrl,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  await ensureSeasonsAround(db);

  const account = (
    await db.query(
      "insert into account(email_hash,status,role) values ('parity-test','approved','admin') returning account_id, email_hash, is_owner, timezone",
    )
  ).rows[0];
  person = account.account_id;
  cookie = `__Host-elixir_session=${
    (
      await createSession(db, {
        secret: "test",
        accountId: person,
        emailHash: account.email_hash,
      })
    ).token
  }`;

  // The player as ingest records it, claimed by the person.
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
      "insert into gateway(owner_account_id,name,static_ip,status) values ($1,'parity-gw','127.0.0.1','active') returning gateway_id",
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
    // Now, not the fixture's day: ingest moves a player's clan only
    // forward from the row's last_seen_at, which the insert above set.
    fetched_at: new Date().toISOString(),
    status: "ok",
    body_gzip_b64: gzipSync(Buffer.from(JSON.stringify(payload))).toString(
      "base64",
    ),
  });
  assert.equal(result.outcome, "admitted", JSON.stringify(result));

  handler = makeHandler({ databaseUrl, secret: "test" });
  invoke = makeInvoker({
    db,
    account: {
      accountId: person,
      emailHash: account.email_hash,
      isOwner: account.is_owner,
      timezone: account.timezone,
    },
    registry: makeRegistry(),
  });

  const client = await registerClient(db, {
    clientName: "Parity",
    redirectUris: ["https://example.org/callback"],
  });
  personToken = (
    await mintTokens(db, {
      clientId: client.clientId,
      accountId: person,
      scope: "cr:read",
      resource: "https://elixir.poapkings.com/api/v1",
    })
  ).accessToken;
  const created = await handler({
    rawPath: "/api/admin/integrations",
    requestContext: { http: { method: "POST" } },
    headers: { cookie, "x-elixir-client": "web" },
    body: JSON.stringify({
      name: "parity",
      scopes: ["game:read", "players:read"],
    }),
  });
  assert.equal(created.statusCode, 201, created.body);
  integrationToken = data(created).token;
});

after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database ${name} with (force)`);
  await admin.end();
});

test("/api/v1/me and elixir_my_players list the same players, from record's myPlayers", async () => {
  const me = await request("GET", "/api/v1/me", personToken);
  assert.equal(me.statusCode, 200, me.body);
  const tool = await invoke("elixir_my_players", {});
  assert.equal(tool.isError, false, JSON.stringify(tool.body));
  const record = wire(await myPlayers(db, person));
  assert.equal(record.length, 1);
  assert.equal(record[0].player_tag, PLAYER);
  assert.deepEqual(data(me).data.players, record);
  assert.deepEqual(wire(tool.body.players), record);
});

test("/api/v1/game/clock is game_clock's clock at the same instant", async () => {
  const r = await request("GET", "/api/v1/game/clock", integrationToken);
  assert.equal(r.statusCode, 200, r.body);
  const { source, ...door } = data(r).data;
  assert.equal(source, "policy");
  const tool = await invoke("game_clock", { at: door.as_of });
  assert.equal(tool.isError, false, JSON.stringify(tool.body));
  // The tool's envelope is not the clock.
  const clock = wire(tool.body);
  for (const key of ["applied", "docs", "meta"]) delete clock[key];
  assert.deepEqual(door, clock);
});

test("/api/v1/players/{tag} and players_profile agree on who the player is", async () => {
  const r = await request(
    "GET",
    `/api/v1/players/${encodeURIComponent(PLAYER)}`,
    integrationToken,
  );
  assert.equal(r.statusCode, 200, r.body);
  const door = data(r).data;
  const tool = await invoke("players_profile", { player_tag: PLAYER });
  assert.equal(tool.isError, false, JSON.stringify(tool.body));
  const profile = wire(tool.body);
  assert.equal(door.player_tag, PLAYER);
  assert.equal(door.player_tag, profile.player_tag);
  assert.equal(door.name, profile.name);
  assert.ok(door.clan, "the fixture's player is in a clan");
  assert.deepEqual(door.clan, {
    clan_tag: profile.clan.clan_tag,
    name: profile.clan.name,
    badge_id: profile.clan.badge_id,
    role: profile.clan.role,
  });
  assert.deepEqual(door.attributes, {
    years_played: profile.attributes.years_played,
    account_age_days: profile.attributes.account_age_days,
  });
});
