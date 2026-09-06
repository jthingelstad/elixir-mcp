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
import {
  addPlayer,
  removePlayer,
  setCollectionMembers,
} from "../src/index.mjs";

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

// A re-add after a stop creates a NEW recording row, so a tag can carry
// several. "Is this player being recorded?" is a question about the
// ACTIVE one, never about whichever row comes back first.
const isRecording = async (tag) =>
  (
    await db.query(
      `select count(*)::int as n from recording
       where subject_type = 'player' and subject_tag = $1 and status = 'active'`,
      [tag],
    )
  ).rows[0].n > 0;

const latestRecording = async (tag) =>
  (
    await db.query(
      `select status, origin from recording
       where subject_type = 'player' and subject_tag = $1
       order by created_at desc, recording_id desc limit 1`,
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

async function collection(kind = "player", owner, scope = "comprehensive") {
  const {
    rows: [c],
  } = await db.query(
    `insert into collection (slug, title, kind, owner_account, scope)
     values ($1, 'A collection', $2, $3, $4) returning collection_id`,
    [
      `c-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      owner.accountId,
      scope,
    ],
  );
  return { collectionId: c.collection_id, kind, ownerAccount: owner.accountId };
}

const scopeOf = async (tag, kind = "player") =>
  (
    await db.query(
      `select scope from recording
       where subject_type = $2 and subject_tag = $1 and status = 'active'`,
      [tag, kind],
    )
  ).rows[0]?.scope;

const members = async (col) =>
  (
    await db.query(
      `select subject_tag from collection_member where collection_id = $1 order by subject_tag`,
      [col.collectionId],
    )
  ).rows.map((r) => r.subject_tag);

beforeEach(async () => {
  await db.query(`delete from collection_member`);
  await db.query(`delete from collection`);
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
  assert.equal(await isRecording(A), true);

  // Reported: this left it active forever, because requested_by was alice.
  const last = await removePlayer(db, bob, { tag: A, via: "test" });
  assert.equal(last.recordingStopped, true);
  assert.equal(await isRecording(A), false);
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
  assert.equal(await isRecording(A), true);
  assert.equal((await latestRecording(A)).origin, "ops");
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

// --------------------------------------------------------------- #12
// The account lock protects the slot count; the recording is shared by
// tag. These drive the exact interleavings from the report, on separate
// connections, with a barrier so both transactions are genuinely open at
// the same time.
async function conn() {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  return c;
}

test("a concurrent add cannot be stranded by another account's last removal", async () => {
  await addPlayer(db, alice, { tag: A, via: "test" });
  const [ca, cb] = [await conn(), await conn()];
  try {
    // Both start together; the subject lock decides the order.
    const removing = removePlayer(ca, alice, { tag: A, via: "test" });
    const adding = addPlayer(cb, bob, { tag: A, via: "test" });
    const [rem, add] = await Promise.all([removing, adding]);
    assert.equal(rem.removed, true);
    assert.equal(add.ok, true);
  } finally {
    await Promise.all([ca.end(), cb.end()]);
  }
  // Reported outcome was one claim with the recording stopped: bob
  // subscribed to a player nobody was recording.
  const { rows } = await db.query(
    `select count(*)::int as n from claim where player_tag = $1`,
    [A],
  );
  assert.equal(rows[0].n, 1, "bob still holds a claim");
  assert.equal(
    await isRecording(A),
    true,
    "a remaining subscriber must never be left unrecorded",
  );
});

test("two accounts removing the last two claims still stop the recording", async () => {
  await addPlayer(db, alice, { tag: A, via: "test" });
  await addPlayer(db, bob, { tag: A, via: "test" });
  const [ca, cb] = [await conn(), await conn()];
  try {
    await Promise.all([
      removePlayer(ca, alice, { tag: A, via: "test" }),
      removePlayer(cb, bob, { tag: A, via: "test" }),
    ]);
  } finally {
    await Promise.all([ca.end(), cb.end()]);
  }
  // Reported outcome: each saw the other's uncommitted claim, both
  // declined to stop, and the recording outlived every subscriber.
  const { rows } = await db.query(
    `select count(*)::int as n from claim where player_tag = $1`,
    [A],
  );
  assert.equal(rows[0].n, 0);
  assert.equal(
    await isRecording(A),
    false,
    "the last removal must stop it whichever transaction gets there second",
  );
});

test("simultaneous first additions create exactly one recording", async () => {
  const [ca, cb] = [await conn(), await conn()];
  try {
    const [ra, rb] = await Promise.all([
      addPlayer(ca, alice, { tag: C, via: "test" }),
      addPlayer(cb, bob, { tag: C, via: "test" }),
    ]);
    assert.equal(ra.ok && rb.ok, true);
    // Exactly one of them created it; the other joined.
    assert.equal(
      [ra, rb].filter((r) => r.recordingStarted).length,
      1,
      "one starts the recording, the other shares it",
    );
  } finally {
    await Promise.all([ca.end(), cb.end()]);
  }
  const { rows } = await db.query(
    `select count(*)::int as n from recording
     where subject_type = 'player' and subject_tag = $1 and status = 'active'`,
    [C],
  );
  assert.equal(rows[0].n, 1, "never two active recordings for one player");
});

test("a mutation waits for another account's in-flight change to the same player", async () => {
  // The two previous tests assert the invariant under natural
  // interleaving; this one proves the mechanism, deterministically.
  // Holding the subject lock stands in for any mutation mid-flight.
  await addPlayer(db, alice, { tag: D, via: "test" });
  const holder = await conn();
  const adder = await conn();
  try {
    await holder.query("begin");
    await holder.query(`select pg_advisory_xact_lock(hashtext($1))`, [D]);

    let settled = false;
    const pending = addPlayer(adder, bob, { tag: D, via: "test" }).then((r) => {
      settled = true;
      return r;
    });
    // Give it a real chance to finish if it were not blocked.
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(
      settled,
      false,
      "an add must wait on a subject another transaction is mutating",
    );

    await holder.query("commit"); // releases the subject lock
    const r = await pending;
    assert.equal(r.ok, true);
    assert.equal(await isRecording(D), true);
  } finally {
    await Promise.all([holder.end(), adder.end()]);
  }
});

test("an account lock still holds under cross-subject concurrency", async () => {
  // The subject lock must not weaken #10: one slot, two different tags.
  const capped = await account(`race2-${Math.random()}`, { slots: 1 });
  const [ca, cb] = [await conn(), await conn()];
  try {
    const results = await Promise.all([
      addPlayer(ca, capped, { tag: A, via: "test" }),
      addPlayer(cb, capped, { tag: B, via: "test" }),
    ]);
    assert.equal(results.filter((r) => r.ok).length, 1);
  } finally {
    await Promise.all([ca.end(), cb.end()]);
  }
});

// ------------------------------------------- collections are recorded
test("naming a player in a collection records it", async () => {
  const col = await collection("player", alice);
  // Jamie, 2026-09-06: curating a tag used to record nothing, so you had
  // to add the player to your account as well to get any data.
  const r = await setCollectionMembers(db, col, [A, B]);
  assert.equal(r.added, 2);
  assert.equal(r.recordingsStarted, 2);
  assert.equal(await isRecording(A), true);
  assert.equal((await latestRecording(A)).origin, "collection");
});

test("a collection edit is a set: absent tags leave and stop recording", async () => {
  const col = await collection("player", alice);
  await setCollectionMembers(db, col, [A, B, C]);
  const r = await setCollectionMembers(db, col, [B, D]);
  assert.deepEqual(await members(col), [D, B].sort());
  assert.equal(r.added, 1);
  assert.equal(r.removed, 2);
  assert.equal(await isRecording(A), false, "dropped from the collection");
  assert.equal(await isRecording(B), true, "still a member");
  assert.equal(await isRecording(D), true, "newly a member");
});

test("a collection keeps recording a player somebody also claims", async () => {
  const col = await collection("player", alice);
  await addPlayer(db, bob, { tag: A, via: "test" });
  await setCollectionMembers(db, col, [A]);
  // Two reasons to record; removing one must not stop it.
  await setCollectionMembers(db, col, []);
  assert.equal(await isRecording(A), true, "bob still claims it");
  const r = await removePlayer(db, bob, { tag: A, via: "test" });
  assert.equal(r.recordingStopped, true, "the last reason is gone");
});

test("a claim removal leaves a collected player recorded", async () => {
  const col = await collection("player", alice);
  await addPlayer(db, bob, { tag: A, via: "test" });
  await setCollectionMembers(db, col, [A]);
  const r = await removePlayer(db, bob, { tag: A, via: "test" });
  assert.equal(r.removed, true);
  assert.equal(r.recordingStopped, false, "the collection still wants it");
  assert.equal(await isRecording(A), true);
});

test("an ops recording is never touched by collection edits", async () => {
  const col = await collection("player", alice);
  await setCollectionMembers(db, col, [A]);
  await db.query(`update recording set origin = 'ops' where subject_tag = $1`, [
    A,
  ]);
  const r = await setCollectionMembers(db, col, []);
  assert.equal(r.recordingsStopped, 0);
  assert.equal(await isRecording(A), true);
});

test("re-setting the same membership changes nothing", async () => {
  const col = await collection("player", alice);
  await setCollectionMembers(db, col, [A, B]);
  const r = await setCollectionMembers(db, col, [B, A]);
  assert.deepEqual([r.added, r.removed], [0, 0]);
  assert.equal(r.total, 2);
});

test("a collection records at the depth it asks for", async () => {
  const deep = await collection("player", alice, "comprehensive");
  const shallow = await collection("player", bob, "activity");
  await setCollectionMembers(db, deep, [A]);
  await setCollectionMembers(db, shallow, [B]);
  assert.equal(await scopeOf(A), "comprehensive", "battles too");
  assert.equal(await scopeOf(B), "activity", "profile only");
});

test("depth is upgraded by a deeper collection, never downgraded", async () => {
  const shallow = await collection("player", alice, "activity");
  const deep = await collection("player", bob, "comprehensive");
  await setCollectionMembers(db, shallow, [A]);
  assert.equal(await scopeOf(A), "activity");
  // A second collection wanting more deepens it...
  await setCollectionMembers(db, deep, [A]);
  assert.equal(await scopeOf(A), "comprehensive");
  // ...and the shallow one re-saving must not take the battles away.
  await setCollectionMembers(db, shallow, [A]);
  assert.equal(await scopeOf(A), "comprehensive");
});

test("a claim always means full capture", async () => {
  const shallow = await collection("player", alice, "activity");
  await setCollectionMembers(db, shallow, [A]);
  assert.equal(await scopeOf(A), "activity");
  // Adding the player to an account is an explicit ask for their data.
  await addPlayer(db, bob, { tag: A, via: "test" });
  assert.equal(await scopeOf(A), "comprehensive");
});

test("a clan collection records clans at its chosen depth", async () => {
  const col = await collection("clan", alice, "comprehensive");
  const CLAN = "#J2RGCRVG";
  await db.query(
    `insert into clan (clan_tag) values ($1) on conflict do nothing`,
    [CLAN],
  );
  await setCollectionMembers(db, col, [CLAN]);
  assert.equal(await scopeOf(CLAN, "clan"), "comprehensive");
  const { rows } = await db.query(
    `select origin from recording where subject_type = 'clan' and subject_tag = $1`,
    [CLAN],
  );
  assert.equal(rows[0].origin, "collection");
});
