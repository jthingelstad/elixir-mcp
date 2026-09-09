import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { createSession, emailHash } from "../../auth/src/index.mjs";
import { makeHandler } from "../src/handler.mjs";

const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const name = `elixir_mcp_test_first_answer_${process.pid}`;
const databaseUrl = adminUrl.replace(/\/postgres$/, `/${name}`);
let db, handler, cookie, accountId, otherId;
const read = (authenticated = true) =>
  handler({
    rawPath: "/api/me/first-answer",
    requestContext: { http: { method: "GET" } },
    headers: authenticated ? { cookie } : {},
  });

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
  const hash = emailHash("first-answer@example.com");
  ({
    rows: [{ account_id: accountId }],
  } = await db.query(
    "insert into account (email_hash, status) values ($1, 'approved') returning account_id",
    [hash],
  ));
  ({
    rows: [{ account_id: otherId }],
  } = await db.query(
    "insert into account (email_hash, status) values ($1, 'approved') returning account_id",
    [emailHash("other@example.com")],
  ));
  const session = await createSession(db, {
    secret: "test",
    accountId,
    emailHash: hash,
  });
  cookie = `__Host-elixir_session=${session.token}`;
  handler = makeHandler({
    databaseUrl,
    secret: "test",
    sendLoginEmail: async () => {},
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database ${name} with (force)`);
  await admin.end();
});

test("first-answer requires a personal session", async () => {
  assert.equal((await read(false)).statusCode, 401);
});

test("first-answer follows actual capture and distinguishes authorization from natural data reads", async () => {
  const res = await read();
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).player, null);
  await db.query(
    "insert into player (player_tag) values ('#2PP0V90Y'), ('#J2RGCRVG')",
  );
  await db.query(
    "insert into claim (account_id, player_tag, is_primary) values ($1, '#2PP0V90Y', true), ($2, '#J2RGCRVG', true)",
    [accountId, otherId],
  );
  await db.query(
    "insert into recording (subject_type, subject_tag, requested_by) values ('player', '#2PP0V90Y', $1)",
    [accountId],
  );
  let data = JSON.parse((await read()).body);
  assert.equal(data.player.player_tag, "#2PP0V90Y");
  assert.equal(data.player.profile_observed_at, null);
  assert.equal(data.player.profile_available, false);
  assert.equal(data.player.battles_30d, 0);
  assert.equal(data.connection.active_connections, 0);

  await db.query(
    "insert into poll_state (subject_tag, endpoint, last_admitted_at) values ('#2PP0V90Y', 'player', now()), ('#2PP0V90Y', 'player_battlelog', now() - interval '3 hours')",
  );
  // A poll is not proof of a projected profile. Conversely, retained profile
  // observations survive receipt/poll retention and are still useful data.
  data = JSON.parse((await read()).body);
  assert.equal(data.player.profile_observed_at, null);
  await db.query(
    "insert into player_snapshot_daily (player_tag, snapshot_date, trophies, observed_at) values ('#2PP0V90Y', current_date, 9000, now())",
  );
  for (const [id, tag, days, deck] of [
    ["recent", "#2PP0V90Y", 1, "a"],
    ["second", "#2PP0V90Y", 2, "b"],
    ["previous", "#2PP0V90Y", 9, "a"],
    ["old", "#2PP0V90Y", 31, "a"],
    ["foreign", "#J2RGCRVG", 1, "a"],
  ]) {
    await db.query(
      "insert into battle (battle_id, battle_time, type, type_class) values ($1, now() - $2 * interval '1 day', 'PvP', 'pvp')",
      [id, days],
    );
    await db.query(
      "insert into battle_participant (battle_id, player_tag, side, battle_time, deck_hash) values ($1, $2, 0, now() - $3 * interval '1 day', $4)",
      [id, tag, days, deck],
    );
  }
  await db.query(
    "insert into oauth_client (client_id, client_name, redirect_uris, expires_at) values ('first-answer', 'Test', '[]', now() + interval '1 day')",
  );
  await db.query(
    "insert into oauth_family (client_id, account_id, absolute_expires_at) values ('first-answer', $1, now() + interval '1 day'), ('first-answer', $1, now() - interval '1 day'), ('first-answer', $2, now() + interval '1 day')",
    [accountId, otherId],
  );
  data = JSON.parse((await read()).body);
  assert.ok(data.player.profile_observed_at);
  assert.equal(data.player.battles_30d, 3);
  assert.equal(data.player.battles_7d, 2);
  assert.equal(data.player.battles_previous_7d, 1);
  assert.equal(data.player.distinct_decks_7d, 2);
  assert.ok(data.player.last_battle_at);
  assert.equal(data.player.profile_available, true);
  assert.ok(
    new Date(data.player.battlelog_observed_at) <
      new Date(data.player.profile_observed_at),
  );
  assert.equal(data.connection.active_connections, 1);
  assert.equal(data.connection.successful_data_calls_7d, 0);

  // Web previews, service principals, failures, oversize responses, setup
  // calls, other accounts and old calls do not count as personal MCP reads.
  for (const [owner, surface, tool, error, truncated, days] of [
    [accountId, "mcp", "players_summary", null, false, 0],
    [accountId, "mcp", "battles_performance", null, false, 2],
    [accountId, "web", "players_summary", null, false, 0],
    [accountId, "svc:bot", "players_summary", null, false, 0],
    [accountId, "mcp", "players_summary", "bad_request", false, 0],
    [accountId, "mcp", "players_summary", null, true, 0],
    [accountId, "mcp", "elixir_status", null, false, 0],
    [otherId, "mcp", "players_summary", null, false, 0],
    [accountId, "mcp", "players_summary", null, false, 8],
  ]) {
    await db.query(
      "insert into mcp_call_audit (account_id, surface, tool, error_code, truncated, created_at) values ($1,$2,$3,$4,$5,now() - $6 * interval '1 day')",
      [owner, surface, tool, error, truncated, days],
    );
  }
  data = JSON.parse((await read()).body);
  assert.equal(data.connection.successful_data_calls_7d, 2);
  assert.equal(data.connection.data_read_days_7d, 2);
  assert.ok(data.connection.last_data_read_at);
  await db.query(
    "update oauth_family set revoked_at = now() where account_id = $1",
    [accountId],
  );
  assert.equal(
    JSON.parse((await read()).body).connection.active_connections,
    0,
  );
  await db.query(
    "delete from player_snapshot_daily where player_tag = '#2PP0V90Y'",
  );
  await db.query(
    "delete from battle_participant where player_tag = '#2PP0V90Y' and battle_id <> 'old'",
  );
  data = JSON.parse((await read()).body);
  assert.equal(data.player.profile_available, false);
  assert.equal(data.player.battles_30d, 0);
  assert.ok(
    data.player.last_battle_at,
    "older retained history is still a capture",
  );
});
