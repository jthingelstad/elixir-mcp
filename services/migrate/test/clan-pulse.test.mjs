import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { clanPulse } from "../src/lambda.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_pulse_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const CLAN = "#PYLQ22"; // CR tag alphabet: 0289PYLQGRJCUV
const ACTIVE = "#P0P0P0P0";
const QUIET = "#P0P0P0P2";
const GHOST = "#P0P0P0P8"; // current member, no recorded history at all

let db;
let accountId;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();

  accountId = (
    await db.query(
      `insert into account (email_hash, status) values ('pulse-test', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);
  await db.query(
    `insert into account_clan (account_id, clan_tag, notify) values ($1, $2, true)`,
    [accountId, CLAN],
  );
  for (const [tag, name] of [
    [ACTIVE, "Busy"],
    [QUIET, "Sleepy"],
    [GHOST, "Ghost"],
  ]) {
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at)
       values ($1, $2, now() - interval '30 days')`,
      [CLAN, tag],
    );
  }
  // ACTIVE played two battles in the last 24h; QUIET's last battle was
  // 6 days ago; GHOST has never been recorded.
  const battles = [
    ["b-act-1", ACTIVE, "1 hour"],
    ["b-act-2", ACTIVE, "2 hours"],
    ["b-quiet", QUIET, "6 days"],
  ];
  for (const [id, tag, ago] of battles) {
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       values ($1, now() - $2::interval, 'PvP', 'pvp')`,
      [id, ago],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, clan_tag)
       values ($1, $2, 0, $3)`,
      [id, tag, CLAN],
    );
  }
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("clan_pulse: one digest per added clan per day, facts only", async () => {
  const r1 = await clanPulse(DB_URL);
  assert.deepEqual(
    { clans: r1.clans, emitted: r1.emitted, skipped: r1.skipped },
    { clans: 1, emitted: 1, skipped: 0 },
  );

  const { rows } = await db.query(
    `select payload from event_feed
     where account_id = $1 and topic = 'clan_pulse' and subject_tag = $2`,
    [accountId, CLAN],
  );
  assert.equal(rows.length, 1);
  const p = rows[0].payload;
  assert.equal(p.battles_24h, 2, "only ACTIVE's two recent battles count");
  assert.equal(p.members_active_24h, 1);
  assert.equal(p.members_total, 3);
  assert.deepEqual(p.top_24h[0], {
    player_tag: ACTIVE,
    name: "Busy",
    battles: 2,
  });
  assert.equal(p.quiet.length, 1, "only QUIET crosses the 5-day floor");
  assert.equal(p.quiet[0].player_tag, QUIET);
  assert.equal(p.quiet[0].days_quiet, 6);
  assert.equal(p.never_recorded, 1, "GHOST has no recorded history");
  assert.deepEqual(p.roster_changes_24h, { joined: 0, left: 0 });
  assert.equal(p.war, undefined, "no war anchor -> no war block");
  assert.match(p.note, /RECORDED/);

  // Idempotent per UTC day: a re-invoke never double-pulses.
  const r2 = await clanPulse(DB_URL);
  assert.equal(r2.emitted, 0);
  assert.equal(r2.skipped, 1);
  const { rows: again } = await db.query(
    `select count(*)::int as n from event_feed where topic = 'clan_pulse'`,
  );
  assert.equal(again[0].n, 1);
});

test("clan_pulse: notify-off clans get no pulse at all", async () => {
  await db.query(`update account_clan set notify = false`);
  await db.query(`delete from event_feed`);
  const r = await clanPulse(DB_URL);
  assert.deepEqual(
    { clans: r.clans, emitted: r.emitted },
    { clans: 0, emitted: 0 },
  );
  await db.query(`update account_clan set notify = true`);
});
