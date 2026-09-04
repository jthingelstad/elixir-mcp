import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import { projectRiverRaceLog } from "../../ingest/src/war.mjs";
import { ingestClanRoster } from "../../ingest/src/roster.mjs";
import { makeRegistry } from "../src/tools.mjs";
import { makeInvoker } from "../src/invoker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_wartools_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const CLAN = "#J2RGCRVG";

let db;
let invoke; // as alice, a plain member
let invokeOutsider;

async function fixture(rel) {
  return JSON.parse(
    await readFile(path.join(repoRoot, "fixtures", rel), "utf8"),
  );
}

async function call(fn, name, args = {}) {
  const { body, isError } = await fn(name, args);
  return { body, isError };
}

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
  await db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);

  // Owner + clan recording; roster from the real fixture; war history from
  // the real riverracelog.
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('wt-owner', 'approved', true) returning account_id`,
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('clan', $1, $2)`,
    [CLAN, owner.account_id],
  );
  const roster = await fixture("clan/roster.json");
  await ingestClanRoster(db, {
    payload: roster,
    observedAt: "2026-09-03T14:40:34Z",
  });
  const log = await fixture("riverracelog/log.json");
  await projectRiverRaceLog(db, { clanTag: CLAN, payload: log });

  // Alice claims a real roster member tag.
  const aliceTag = roster.memberList[0].tag;
  const {
    rows: [alice],
  } = await db.query(
    `insert into account (email_hash, status) values ('wt-alice', 'approved') returning account_id, is_owner`,
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary) values ($1, $2, 'unverified', true)`,
    [alice.account_id, aliceTag],
  );
  const registry = makeRegistry();
  invoke = makeInvoker({
    db,
    account: {
      accountId: alice.account_id,
      isOwner: false,
      timezone: "America/Chicago",
    },
    registry,
  });
  const {
    rows: [out],
  } = await db.query(
    `insert into account (email_hash, status) values ('wt-out', 'approved') returning account_id`,
  );
  invokeOutsider = makeInvoker({
    db,
    account: { accountId: out.account_id, isOwner: false, timezone: null },
    registry,
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("get_clan: roster with roles, snapshots slots, membership tenure", async () => {
  const { body, isError } = await call(invoke, "get_clan", {});
  assert.equal(isError, false);
  assert.equal(body.clan_tag, CLAN);
  assert.equal(body.member_count, 49);
  const leader = body.members.find((m) => m.role === "leader");
  assert.ok(leader, "leader present from roster");
  assert.ok(
    body.members.every((m) => m.member_since_observed),
    "observed tenure on every member",
  );
});

test("get_war: latest recorded week with standings, points, note", async () => {
  const { body, isError } = await call(invoke, "get_war", {});
  assert.equal(isError, false);
  assert.equal(body.season_id, 134, "latest week in the log fixture");
  assert.ok(body.standings.length >= 5);
  assert.ok(body.standings.every((s) => typeof s.fame === "number"));
  assert.ok(body.participants.length > 10);
  assert.match(body.note, /points are per-member/);
});

test("get_war_history: ranks per week and one member focus with attendance", async () => {
  const { body } = await call(invoke, "get_war_history", { seasons: 3 });
  assert.ok(body.weeks.length >= 9, "the log fixture spans ten weeks");
  assert.ok(body.weeks.every((w) => w.our_rank >= 1 && w.our_rank <= 5));
  const focusTag = (
    await db.query(
      `select player_tag from war_participation where clan_tag = $1 and points > 0 limit 1`,
      [CLAN],
    )
  ).rows[0].player_tag;
  // focus member must be a current open member for entitlement; add if missing
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     select $1, $2, now(), 'member'
     where not exists (select 1 from clan_membership where player_tag = $2 and left_observed_at is null)`,
    [CLAN, focusTag],
  );
  const focused = await call(invoke, "get_war_history", {
    player_tag: focusTag,
    seasons: 3,
  });
  assert.equal(focused.isError, false, JSON.stringify(focused.body));
  assert.ok(focused.body.member_weeks.length > 0);
  assert.ok(
    focused.body.member_weeks.every(
      (w) =>
        typeof w.points === "number" && typeof w.war_days_battled === "number",
    ),
  );
});

test("compare_players: two clanmates side by side", async () => {
  const roster = await fixture("clan/roster.json");
  const { body, isError } = await call(invoke, "compare_players", {
    player_tags: [roster.memberList[0].tag, roster.memberList[1].tag],
  });
  assert.equal(isError, false);
  assert.equal(body.players.length, 2);
  assert.ok(body.players.every((p) => p.window));
});

test("entitlements hold: outsiders get structured refusals on every clan tool", async () => {
  for (const name of ["get_clan", "get_war", "get_war_history"]) {
    const { body, isError } = await call(invokeOutsider, name, {});
    assert.equal(isError, true, name);
    assert.equal(body.error.code, "not_entitled", name);
  }
  const cmp = await call(invokeOutsider, "compare_players", {
    player_tags: ["#YYYYYYYY", "#RRRRRRRR"],
  });
  assert.equal(cmp.body.error.code, "not_entitled");
});

test("the registry now declares 16 tools", () => {
  assert.equal(makeRegistry().declarations().length, 16);
});
