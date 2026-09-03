import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";

// The knob is read at import time, so set it before the module loads
// (own test file = own process; static imports would hoist past this).
process.env.ELIXIR_CLAN_SCOPE_REQUIRES = "verified";
const { resolveSubject } = await import("../src/entitlements.mjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_entv_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const CLAN = "#J2RGCRVG";

let db;
let alice;

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
  const { rows } = await db.query(
    `insert into account (email_hash, status, is_owner) values ('entv-owner', 'approved', true)
     returning account_id`,
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by) values ('clan', $1, $2)`,
    [CLAN, rows[0].account_id],
  );
  const a = await db.query(
    `insert into account (email_hash, status, is_owner) values ('entv-alice', 'approved', false)
     returning account_id, is_owner`,
  );
  alice = { accountId: a.rows[0].account_id, isOwner: false };
  for (const tag of ["#YYYYYYYY", "#RRRRRRRR"]) {
    await db.query(`insert into player (player_tag) values ($1)`, [tag]);
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
       values ($1, $2, now(), 'member')`,
      [CLAN, tag],
    );
  }
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary)
     values ($1, '#YYYYYYYY', 'unverified', true)`,
    [alice.accountId],
  );
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("flipped knob: a soft claim keeps rule 1 but loses clan cover", async () => {
  // Own full history never depends on verification.
  const own = await resolveSubject(db, alice, "#YYYYYYYY", "full");
  assert.equal(own.scope, "own");

  // Clan cover through an unverified claim is refused.
  await assert.rejects(
    () => resolveSubject(db, alice, "#RRRRRRRR", "summary"),
    (e) => e.code === "not_entitled",
  );

  // Verifying the claim restores clan cover.
  await db.query(
    `update claim set status = 'verified', verified_method = 'favourite_card'
     where account_id = $1`,
    [alice.accountId],
  );
  const s = await resolveSubject(db, alice, "#RRRRRRRR", "summary");
  assert.equal(s.scope, "clanmate");
});
