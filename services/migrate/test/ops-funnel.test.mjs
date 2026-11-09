/**
 * {funnel} (2026-11-09): a read. Of the person accounts made in the
 * window, how many signed in, added a primary, got a first read (the
 * first-answer rule), verified, connected an agent and came back, with
 * the wait from adding the primary to its first read. Counts only, and
 * it writes nothing.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { funnelOp } from "../src/ops-funnel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_funnel_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

const ago = (days, seconds = 0) =>
  new Date(Date.now() - days * 86_400_000 - seconds * 1000).toISOString();

test("days is bounded", async () => {
  for (const days of [0, -1, 1.5, "90", 3651])
    assert.match((await funnelOp(SCRATCH_URL, { days })).error, /days must/);
});

test("an empty database answers zeros and null timings", async () => {
  const r = await funnelOp(SCRATCH_URL, true);
  assert.equal(r.days, 90);
  assert.equal(r.overall.accounts, 0);
  assert.deepEqual(r.by_week, []);
  assert.deepEqual(r.time_to_first_read, {
    measured: 0,
    already_recorded: 0,
    median_seconds: null,
    p90_seconds: null,
  });
});

test("counts each funnel step for people only, and writes nothing", async () => {
  const person = async (h, createdAt) =>
    (
      await db.query(
        `insert into account (email_hash, status, role, created_at)
         values ($1, 'approved', 'member', $2) returning account_id`,
        [h, createdAt],
      )
    ).rows[0].account_id;
  const event = (acc, kind, at) =>
    db.query(
      `insert into account_event (account_id, kind, created_at) values ($1, $2, $3)`,
      [acc, kind, at],
    );
  const claim = (acc, tag, status, at) =>
    db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship, created_at)
       values ($1, $2, $3, true, 'primary', $4)`,
      [acc, tag, status, at],
    );

  // A: signed in, never added a player.
  const a = await person("funnel-a", ago(3));
  await event(a, "signed_in", ago(3));
  // B: enrolled by the op with a primary, never signed in, no read yet.
  const b = await person("funnel-b", ago(3));
  await event(b, "enrolled", ago(3));
  // C: a profile read landed 120 s after the add; verified; an agent with
  // a live MCP token; signed in again two days later.
  const c = await person("funnel-c", ago(10));
  await event(c, "signed_in", ago(10));
  await event(c, "signed_in", ago(8));
  // D: battles only, the first stored 600 s after the add.
  const d = await person("funnel-d", ago(10));
  await event(d, "signed_in", ago(10));
  // Outside the 90-day window.
  const old = await person("funnel-old", ago(200));
  await event(old, "signed_in", ago(200));

  const [TB, TC, TD, TO, TX] = [
    "#2PP0V90Y",
    "#8QU2PJ8C",
    "#9VUP08YL",
    "#YQ2PG0LR",
    "#2PYLQGC",
  ];
  for (const t of [TB, TC, TD, TO, TX])
    await db.query(`insert into player (player_tag) values ($1)`, [t]);
  await claim(b, TB, "unverified", ago(3));
  await claim(c, TC, "verified", ago(10));
  await claim(d, TD, "unverified", ago(10));
  await claim(old, TO, "unverified", ago(200));

  await db.query(
    `insert into player_snapshot_daily (player_tag, snapshot_date, profile_observed_at)
     values ($1, current_date, now())`,
    [TC],
  );
  const {
    rows: [gw],
  } = await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, 'funnel-gw', '127.0.0.1', 'active') returning gateway_id`,
    [c],
  );
  await db.query(
    `insert into api_receipt (endpoint, entity_key, fetched_at, payload_hash, gateway_id, admission)
     values ('player', $1, $2, 'h1', $3, 'admitted')`,
    [TC, ago(10, -120), gw.gateway_id],
  );
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('funnel-1', $1, 'PvP', 'pvp', $2)`,
    [ago(11), ago(10, -600)],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, outcome, battle_time, type, type_class, crowns)
     values ('funnel-1', $1, 0, 'win', $3, 'PvP', 'pvp', 1),
            ('funnel-1', $2, 1, 'loss', $3, 'PvP', 'pvp', 0)`,
    [TD, TX, ago(11)],
  );

  // Principals are excluded: C's agent (with a live MCP token, which
  // counts for C) and an integration, both with sign-in events.
  const agent = (
    await db.query(
      `insert into account (status, role, kind, owned_by_account_id, public_id, created_at)
       values ('approved', 'member', 'agent', $1, 'funnelagent1', $2) returning account_id`,
      [c, ago(5)],
    )
  ).rows[0].account_id;
  await event(agent, "signed_in", ago(5));
  await db.query(
    `insert into service_token (account_id, name, token_hash, audience)
     values ($1, 'funnel-agent', 'th1', 'mcp')`,
    [agent],
  );
  const integration = (
    await db.query(
      `insert into account (status, role, kind, owned_by_account_id, public_id, created_at)
       values ('approved', 'member', 'integration', $1, 'funnelinteg1', $2) returning account_id`,
      [d, ago(5)],
    )
  ).rows[0].account_id;
  await event(integration, "signed_in", ago(5));

  const count = async () =>
    (
      await db.query(
        `select (select count(*) from account) + (select count(*) from claim)
              + (select count(*) from account_event) as n`,
      )
    ).rows[0].n;
  const before = await count();
  const r = await funnelOp(SCRATCH_URL, { days: 90 });
  assert.equal(await count(), before);

  const { by_status, ...overall } = r.overall;
  assert.deepEqual(by_status, { approved: 4 });
  assert.deepEqual(overall, {
    accounts: 4,
    signed_in: 3,
    enrolled: 1,
    enrolled_never_signed_in: 1,
    primary_player: 3,
    first_read: 2,
    verified: 1,
    agent_connected: 1,
    came_back_7d: 1,
    open_7d: 2,
    came_back_30d: 1,
    open_30d: 4,
  });
  assert.deepEqual(r.time_to_first_read, {
    measured: 2,
    already_recorded: 0,
    median_seconds: 360,
    p90_seconds: 552,
  });
  // Weeks newest first, and they add up to the whole.
  const starts = r.by_week.map((w) => w.week_starting);
  assert.deepEqual(starts, [...starts].sort().reverse());
  assert.equal(
    r.by_week.reduce((n, w) => n + w.accounts, 0),
    4,
  );
  for (const w of r.by_week)
    assert.match(w.week_starting, /^\d{4}-\d{2}-\d{2}$/);

  // Counts only: no tag, account id or hash anywhere in the answer.
  const text = JSON.stringify(r);
  assert.ok(!text.includes("#"), "no tag");
  for (const id of [a, b, c, d, agent, integration])
    assert.ok(!text.includes(id), "no account id");
  assert.ok(!text.includes("funnel-"), "no email hash");

  // The whole history is in a long enough window.
  const all = await funnelOp(SCRATCH_URL, { days: 3650 });
  assert.equal(all.overall.accounts, 5);
});

test("a primary recorded before it was claimed has no wait to measure", async () => {
  const e = (
    await db.query(
      `insert into account (email_hash, status, role, created_at)
       values ('funnel-e', 'approved', 'member', $1) returning account_id`,
      [ago(1)],
    )
  ).rows[0].account_id;
  // C's tag, read ten days ago, claimed by E today.
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, created_at)
     values ($1, '#8QU2PJ8C', 'unverified', true, 'primary', $2)`,
    [e, ago(1)],
  );
  const r = await funnelOp(SCRATCH_URL, { days: 90 });
  assert.equal(r.overall.first_read, 3);
  assert.equal(r.time_to_first_read.measured, 2);
  assert.equal(r.time_to_first_read.already_recorded, 1);
});

test("a return through OAuth consent outlasts its session", async () => {
  const before = (await funnelOp(SCRATCH_URL, { days: 90 })).overall;
  const f = (
    await db.query(
      `insert into account (email_hash, status, role, created_at)
       values ('funnel-f', 'approved', 'member', $1) returning account_id`,
      [ago(20)],
    )
  ).rows[0].account_id;
  await db.query(
    `insert into account_event (account_id, kind, created_at) values ($1, 'signed_in', $2)`,
    [f, ago(20)],
  );
  // Consent by code three days later: it minted a session (since cleaned
  // up) and no signed_in event; the family it opened is all that is left.
  await db.query(
    `insert into oauth_client (client_id, client_name, redirect_uris, expires_at)
     values ('funnel-client', 'A client', '{}', now() + interval '1 day')`,
  );
  await db.query(
    `insert into oauth_family (client_id, account_id, created_at, absolute_expires_at, revoked_at)
     values ('funnel-client', $1, $2, $3, $3)`,
    [f, ago(17), ago(10)],
  );
  const after = (await funnelOp(SCRATCH_URL, { days: 90 })).overall;
  assert.equal(after.accounts, before.accounts + 1);
  assert.equal(after.came_back_7d, before.came_back_7d + 1);
  assert.equal(after.came_back_30d, before.came_back_30d + 1);
  assert.equal(after.agent_connected, before.agent_connected);
});
