/**
 * Regression tests for issues #8, #9 and #10, against a real PostgreSQL
 * database. Each one reproduces the reported sequence first, so a
 * revert of the fix fails here rather than in production.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import { addPlayer, removePlayer } from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_claims_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const A = "#2YG98VVQ";
const B = "#20JJJ2CCRU";
const C = "#PYLQGRJC";
const D = "#9VUP08YL";

let db;
let alice;
let bob;

async function account(hash, patch = {}) {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
     returning account_id, role, is_owner`,
    [hash],
  );
  const id = a.account_id;
  if (patch.slots !== undefined) {
    await db.query(
      `update account set max_player_recordings = $2 where account_id = $1`,
      [id, patch.slots],
    );
  }
  return { accountId: id, role: a.role, isOwner: a.is_owner };
}

const claims = async (acct) =>
  (
    await db.query(
      `select player_tag, is_primary from claim where account_id = $1 order by player_tag`,
      [acct.accountId],
    )
  ).rows;

const recording = async (tag) =>
  (
    await db.query(
      `select status, origin from recording where subject_type = 'player' and subject_tag = $1`,
      [tag],
    )
  ).rows[0];

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  db = new pg.Client({ connectionString: URL });
  await db.connect();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

beforeEach(async () => {
  await db.query(`delete from account_event`);
  await db.query(`delete from claim`);
  await db.query(`delete from recording`);
  await db.query(`delete from account`);
  alice = await account(`alice-${Math.random()}`, { slots: 10 });
  bob = await account(`bob-${Math.random()}`, { slots: 10 });
});

// ---------------------------------------------------------------- #8
test("adding a second player as primary switches instead of failing", async () => {
  await addPlayer(db, alice, { tag: A, via: "test" });
  // Reported: this raised 23505 on claim_one_primary_per_account,
  // because the new primary was inserted before the old one was cleared.
  const r = await addPlayer(db, alice, {
    tag: B,
    makePrimary: true,
    via: "test",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(await claims(alice), [
    { player_tag: B, is_primary: true },
    { player_tag: A, is_primary: false },
  ]);
});

test("make_primary on an already-claimed player switches to it", async () => {
  await addPlayer(db, alice, { tag: A, via: "test" });
  await addPlayer(db, alice, { tag: B, via: "test" });
  const r = await addPlayer(db, alice, {
    tag: B,
    makePrimary: true,
    via: "test",
  });
  assert.equal(r.added, false, "a re-add stays idempotent");
  const rows = await claims(alice);
  assert.equal(rows.find((c) => c.player_tag === B).is_primary, true);
  assert.equal(rows.find((c) => c.player_tag === A).is_primary, false);
});

test("removing the primary promotes a replacement, never leaves none", async () => {
  await addPlayer(db, alice, { tag: A, via: "test" });
  await addPlayer(db, alice, { tag: B, via: "test" });
  // Reported: B was left is_primary=false and default-player tools then
  // answered "No primary claimed tag on this account".
  const r = await removePlayer(db, alice, { tag: A, via: "test" });
  assert.equal(r.promotedPrimary, B);
  assert.deepEqual(await claims(alice), [{ player_tag: B, is_primary: true }]);
});

test("removing the last player leaves nothing to promote", async () => {
  await addPlayer(db, alice, { tag: A, via: "test" });
  const r = await removePlayer(db, alice, { tag: A, via: "test" });
  assert.equal(r.removed, true);
  assert.equal(r.promotedPrimary, null);
  assert.deepEqual(await claims(alice), []);
});

test("removing a non-primary leaves the primary alone", async () => {
  await addPlayer(db, alice, { tag: A, via: "test" });
  await addPlayer(db, alice, { tag: B, via: "test" });
  const r = await removePlayer(db, alice, { tag: B, via: "test" });
  assert.equal(r.promotedPrimary, null);
  assert.deepEqual(await claims(alice), [{ player_tag: A, is_primary: true }]);
});

// ---------------------------------------------------------------- #9
test("a shared recording stops with its LAST subscriber, either order", async () => {
  await addPlayer(db, alice, { tag: A, via: "test" });
  await addPlayer(db, bob, { tag: A, via: "test" });

  // The creator leaves first: the recording must survive for bob.
  const first = await removePlayer(db, alice, { tag: A, via: "test" });
  assert.equal(first.recordingStopped, false);
  assert.equal((await recording(A)).status, "active");

  // Reported: this left it active forever, because requested_by was alice.
  const last = await removePlayer(db, bob, { tag: A, via: "test" });
  assert.equal(last.recordingStopped, true);
  assert.equal((await recording(A)).status, "stopped");
});

test("three subscribers: only the final removal stops it", async () => {
  const carol = await account(`carol-${Math.random()}`, { slots: 10 });
  for (const who of [alice, bob, carol]) {
    await addPlayer(db, who, { tag: A, via: "test" });
  }
  assert.equal(
    (await removePlayer(db, bob, { tag: A, via: "test" })).recordingStopped,
    false,
  );
  assert.equal(
    (await removePlayer(db, alice, { tag: A, via: "test" })).recordingStopped,
    false,
  );
  assert.equal(
    (await removePlayer(db, carol, { tag: A, via: "test" })).recordingStopped,
    true,
  );
});

test("an ops recording survives losing every subscriber", async () => {
  // Pros and clan fan-out are recorded deliberately, with no subscribers.
  await addPlayer(db, alice, { tag: A, via: "test" });
  await db.query(`update recording set origin = 'ops' where subject_tag = $1`, [
    A,
  ]);
  const r = await removePlayer(db, alice, { tag: A, via: "test" });
  assert.equal(r.removed, true);
  assert.equal(
    r.recordingStopped,
    false,
    "ops recordings are not subscriber-owned",
  );
  assert.equal((await recording(A)).status, "active");
});

// --------------------------------------------------------------- #10
test("concurrent adds cannot exceed the slot limit", async () => {
  const capped = await account(`capped-${Math.random()}`, { slots: 3 });
  await addPlayer(db, capped, { tag: A, via: "test" });
  await addPlayer(db, capped, { tag: B, via: "test" });

  // Reported: three concurrent adds on separate connections each saw two
  // existing claims and all three succeeded, leaving 5 against a limit of 3.
  const conns = await Promise.all(
    [C, D, "#2PP"].map(async () => {
      const c = new pg.Client({ connectionString: URL });
      await c.connect();
      return c;
    }),
  );
  try {
    const results = await Promise.all(
      [C, D, "#2PP"].map((tag, i) =>
        addPlayer(conns[i], capped, { tag, via: "test" }),
      ),
    );
    const ok = results.filter((r) => r.ok).length;
    assert.equal(ok, 1, "exactly one of three may take the last slot");
    const rejected = results.filter((r) => r.error === "quota_exceeded");
    assert.equal(rejected.length, 2);
  } finally {
    await Promise.all(conns.map((c) => c.end()));
  }
  const { rows } = await db.query(
    `select count(*)::int as n from claim where account_id = $1`,
    [capped.accountId],
  );
  assert.equal(rows[0].n, 3, "never more claims than slots");
});

test("owner and admin stay exempt from slots", async () => {
  const owner = await account(`owner-${Math.random()}`);
  await db.query(
    `update account set is_owner = true, max_player_recordings = 1 where account_id = $1`,
    [owner.accountId],
  );
  const o = { ...owner, isOwner: true };
  for (const tag of [A, B, C, D]) {
    assert.equal((await addPlayer(db, o, { tag, via: "test" })).ok, true);
  }
});

test("removal frees a slot", async () => {
  const capped = await account(`freed-${Math.random()}`, { slots: 1 });
  assert.equal((await addPlayer(db, capped, { tag: A, via: "test" })).ok, true);
  assert.equal(
    (await addPlayer(db, capped, { tag: B, via: "test" })).error,
    "quota_exceeded",
  );
  await removePlayer(db, capped, { tag: A, via: "test" });
  assert.equal((await addPlayer(db, capped, { tag: B, via: "test" })).ok, true);
});
