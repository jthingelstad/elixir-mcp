/**
 * {verified_tag_census} (2026-10-12, #556): a read. Counts the tags one
 * account verified that another account also claims, by what the other
 * claim says, and writes nothing. Collisions made before the rule are
 * inserted directly here, as they exist in production.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { verifiedTagCensusOp } from "../src/ops-verified-tag-census.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_verified_tag_census_${process.pid}`;
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

test("only a dry run is accepted", async () => {
  assert.match((await verifiedTagCensusOp(SCRATCH_URL, {})).error, /a read/);
  assert.match(
    (await verifiedTagCensusOp(SCRATCH_URL, { dry_run: false })).error,
    /a read/,
  );
});

test("counts collisions on verified tags by relationship, counts only, and writes nothing", async () => {
  const empty = await verifiedTagCensusOp(SCRATCH_URL, { dry_run: true });
  assert.equal(empty.verified_tags, 0);
  assert.equal(empty.colliding_tags, 0);
  assert.equal(empty.self.claims, 0);

  const acct = async (h) =>
    (
      await db.query(
        `insert into account (email_hash, status, role) values ($1, 'approved', 'member') returning account_id`,
        [h],
      )
    ).rows[0].account_id;
  const [v1, v2, a, b, c] = [
    await acct("census-v1"),
    await acct("census-v2"),
    await acct("census-a"),
    await acct("census-b"),
    await acct("census-c"),
  ];
  const T1 = "#2PP0V90Y";
  const T2 = "#8QU2PJ8C";
  const T3 = "#9VUP08YL"; // verified, nobody else
  const T4 = "#YQ2PG0LR"; // claimed twice, verified by nobody
  for (const t of [T1, T2, T3, T4])
    await db.query(`insert into player (player_tag) values ($1)`, [t]);
  const claim = (acc, tag, status, primary, rel) =>
    db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship)
       values ($1, $2, $3, $4, $5)`,
      [acc, tag, status, primary, rel],
    );
  await claim(v1, T1, "verified", true, "primary");
  await claim(v2, T2, "verified", true, "primary");
  await claim(v1, T3, "verified", false, "alt");
  await claim(a, T1, "unverified", true, "primary");
  await claim(b, T1, "unverified", false, "alt");
  await claim(c, T1, "unverified", false, "friend");
  await claim(a, T2, "unverified", false, "alt");
  await claim(b, T2, "unverified", false, "watching");
  await claim(c, T4, "unverified", true, "primary");
  await claim(b, T4, "unverified", false, "alt");

  const before = (await db.query(`select count(*)::int as n from claim`))
    .rows[0].n;
  const r = await verifiedTagCensusOp(SCRATCH_URL, { dry_run: true });
  assert.deepEqual(r, {
    dry_run: true,
    verified_tags: 3,
    colliding_tags: 2,
    by_relationship: {
      primary: { claims: 1, tags: 1, accounts: 1 },
      alt: { claims: 2, tags: 2, accounts: 2 },
      friend: { claims: 1, tags: 1, accounts: 1 },
      watching: { claims: 1, tags: 1, accounts: 1 },
    },
    self: { claims: 3, tags: 2, accounts: 2, accounts_whose_primary: 1 },
  });
  assert.ok(!JSON.stringify(r).includes("#"), "no tag in the answer");
  assert.equal(
    (await db.query(`select count(*)::int as n from claim`)).rows[0].n,
    before,
  );
});
