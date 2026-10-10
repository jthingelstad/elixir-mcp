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
  reconcileRecording,
  addClan,
  removeClan,
  followClanForPlayer,
  pooledUsage,
  setAgentStatus,
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

beforeEach(async () => {
  await db.query(`delete from account_event`);
  await db.query(`delete from claim`);
  await db.query(`delete from account_clan`);
  await db.query(`delete from recording`);
  await db.query(`delete from account`);
  await db.query(`delete from player_profile_membership`);
  await db.query(`update player set last_known_clan_tag = null`);
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

test("removing the primary while others are tracked is refused, never leaves none", async () => {
  await addPlayer(db, alice, { tag: A, via: "test" });
  await addPlayer(db, alice, { tag: B, via: "test" });
  // Reported: B was left is_primary=false and default-player tools then
  // answered "No primary claimed tag on this account". It used to promote
  // one silently; Jamie, 2026-09-25: refuse, and the person chooses first.
  const r = await removePlayer(db, alice, { tag: A, via: "test" });
  assert.equal(r.removed, false);
  assert.equal(r.refused, "primary_in_use");
  assert.equal(r.promotedPrimary, null);
  assert.deepEqual(await claims(alice), [
    { player_tag: B, is_primary: false },
    { player_tag: A, is_primary: true },
  ]);
  // Choosing first makes the removal an ordinary one.
  await addPlayer(db, alice, { tag: B, via: "test", makePrimary: true });
  const after = await removePlayer(db, alice, { tag: A, via: "test" });
  assert.equal(after.removed, true);
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

test("an owner and their agent share one pool of player slots, under one lock", async () => {
  // Jamie, 2026-09-23: agents use the person's recording slots. A player
  // both track is one slot; and the owner and the agent adding at once on
  // separate connections cannot both take the last one.
  const owner = await account(`pool-${Math.random()}`, { slots: 2 });
  const {
    rows: [row],
  } = await db.query(
    `insert into account (status, role, kind, owned_by_account_id, public_id)
     values ('approved', 'member', 'agent', $1, $2) returning account_id`,
    [owner.accountId, `pool${String(Math.random()).slice(2, 10)}`],
  );
  const agent = { accountId: row.account_id };
  assert.equal((await addPlayer(db, owner, { tag: A, via: "test" })).ok, true);
  // The same player on the agent costs nothing.
  assert.equal((await addPlayer(db, agent, { tag: A, via: "test" })).ok, true);
  const conns = await Promise.all(
    [0, 1].map(async () => {
      const c = new pg.Client({ connectionString: URL });
      await c.connect();
      return c;
    }),
  );
  try {
    const results = await Promise.all([
      addPlayer(conns[0], owner, { tag: C, via: "test" }),
      addPlayer(conns[1], agent, { tag: D, via: "test" }),
    ]);
    assert.equal(
      results.filter((r) => r.ok).length,
      1,
      "one of the two takes the last slot",
    );
    assert.equal(results.filter((r) => r.error === "quota_exceeded").length, 1);
  } finally {
    await Promise.all(conns.map((c) => c.end()));
  }
});

test("only active agents count: suspending frees the slot and stops its recording", async () => {
  // Jamie, 2026-10-10: "Only active ones should count against usage
  // slots." A suspended agent's subjects are out of the pool and out of
  // recording, so suspending cannot be a way to record without a slot.
  const owner = await account(`active-${Math.random()}`, { slots: 3 });
  const {
    rows: [row],
  } = await db.query(
    `insert into account (status, role, kind, owned_by_account_id, public_id)
     values ('approved', 'member', 'agent', $1, $2) returning account_id`,
    [owner.accountId, `act${String(Math.random()).slice(2, 10)}`],
  );
  const agent = { accountId: row.account_id };
  assert.equal((await addPlayer(db, owner, { tag: A, via: "test" })).ok, true);
  assert.equal((await addPlayer(db, agent, { tag: C, via: "test" })).ok, true);
  // Bob tracks D too, so D outlives the agent's suspension.
  assert.equal((await addPlayer(db, bob, { tag: D, via: "test" })).ok, true);
  await addPlayer(db, agent, { tag: D, via: "test" });
  assert.equal((await pooledUsage(db, owner.accountId)).players_used, 3);

  const off = await setAgentStatus(
    db,
    owner.accountId,
    agent.accountId,
    "disabled",
  );
  assert.equal(off.ok, true);
  assert.equal(off.recordings_stopped, 1, "C stops; D is still Bob's");
  assert.equal(await isRecording(C), false);
  assert.equal(await isRecording(D), true);
  assert.equal((await pooledUsage(db, owner.accountId)).players_used, 1);

  // The freed slot is the owner's to spend; with a ceiling of 2, resuming
  // would be 4 of 2.
  assert.equal((await addPlayer(db, owner, { tag: B, via: "test" })).ok, true);
  await db.query(
    `update account set max_player_recordings = 2 where account_id = $1`,
    [owner.accountId],
  );
  const refused = await setAgentStatus(
    db,
    owner.accountId,
    agent.accountId,
    "approved",
  );
  assert.equal(refused.error, "quota_exceeded");
  assert.equal(refused.limit, 2);
  assert.match(refused.message, /Free 2 first/);
  const {
    rows: [still],
  } = await db.query(`select status from account where account_id = $1`, [
    agent.accountId,
  ]);
  assert.equal(still.status, "disabled", "a refused resume changes nothing");
  assert.equal(await isRecording(C), false);

  // With room again, resuming counts it and records it again.
  await removePlayer(db, owner, { tag: B, via: "test" });
  await db.query(
    `update account set max_player_recordings = 3 where account_id = $1`,
    [owner.accountId],
  );
  const on = await setAgentStatus(
    db,
    owner.accountId,
    agent.accountId,
    "approved",
  );
  assert.equal(on.ok, true, JSON.stringify(on));
  assert.equal(on.recordings_started, 1);
  assert.equal(await isRecording(C), true);
  assert.equal((await pooledUsage(db, owner.accountId)).players_used, 3);

  // Somebody else's agent is not found.
  assert.equal(
    (await setAgentStatus(db, bob.accountId, agent.accountId, "disabled"))
      .error,
    "not_found",
  );
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

// --------------------------------------------------------------- #17

// --------------------------------------------------------------- #18

// --------------------------------------------------------------- #19

// ------------------------------------------- clan reasons are shared
// Jamie, 2026-09-07: removing clans he had personally added, which were
// also in a collection. settleClanRecording counted account_clan and
// nothing else, so the removal stopped a clan the collection still
// curated. reconcileRecording is now the single authority for both
// subject types, and these pin every reason against every other.
const CLAN = "#J2RGCRVG";

const addedClan = async (acct, tag, scope = "comprehensive") =>
  db.query(
    `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, $3)
     on conflict do nothing`,
    [acct.accountId, tag, scope],
  );

const clanRecording = async (tag) =>
  (
    await db.query(
      `select status, scope, origin from recording
       where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
      [tag],
    )
  ).rows[0];

test("an ops clan recording survives losing every reason", async () => {
  await addedClan(bob, CLAN);
  await reconcileRecording(db, "clan", CLAN, bob.accountId);
  await db.query(
    `update recording set origin = 'ops'
     where subject_type = 'clan' and subject_tag = $1 and status = 'active'`,
    [CLAN],
  );
  await db.query(`delete from account_clan where clan_tag = $1`, [CLAN]);
  const r = await reconcileRecording(db, "clan", CLAN, null);
  assert.equal(r.stopped, false);
  assert.equal((await clanRecording(CLAN)).status, "active");
});

test("retired Collection-origin recordings stop unless directly followed", async () => {
  await db.query(
    `insert into recording (subject_type,subject_tag,requested_by,origin) select 'player',unnest($1::text[]),$2,'collection'`,
    [[A, B], alice.accountId],
  );
  await addPlayer(db, bob, { tag: B });
  assert.equal((await reconcileRecording(db, "player", A, null)).stopped, true);
  assert.equal(
    (await reconcileRecording(db, "player", B, null)).stopped,
    false,
  );
  assert.equal(await isRecording(A), false);
  assert.equal(await isRecording(B), true);
  assert.equal(
    (await removePlayer(db, bob, { tag: B })).recordingStopped,
    true,
    "Collection cannot keep the last personal follow recording",
  );
});

test("a direct clan follow determines recording depth and removal", async () => {
  await addedClan(bob, CLAN, "activity");
  await reconcileRecording(db, "clan", CLAN, bob.accountId);
  assert.equal((await clanRecording(CLAN)).scope, "activity");
  await db.query("delete from account_clan where clan_tag=$1", [CLAN]);
  assert.equal(
    (await reconcileRecording(db, "clan", CLAN, null)).stopped,
    true,
  );
});

// ------------------------------------- the primary player's clan (0205)
// Jamie, 2026-10-08: "it should follow it automatically for the primary
// player assuming they have a clan set (not all players are in a clan)."
// Each rule in followPrimaryClan's comment is one test here.
const OTHER = "#GCYQR9VY";
const THIRD = "#GJ09RJP8";

/** What the latest admitted profile said: in `clan`, or in none. */
const profile = async (tag, clan, { retained = clan } = {}) => {
  await db.query(
    `insert into player (player_tag, last_known_clan_tag) values ($1, $2)
     on conflict (player_tag) do update set last_known_clan_tag = excluded.last_known_clan_tag`,
    [tag, retained],
  );
  await db.query(
    `insert into player_profile_membership (player_tag, state, observed_at)
     values ($1, $2, now() - interval '1 minute')
     on conflict (player_tag) do update
       set state = excluded.state, observed_at = excluded.observed_at`,
    [tag, clan ? "member" : "none"],
  );
};

const follows = async (acct) =>
  (
    await db.query(
      `select clan_tag, scope, auto_followed_at is not null as auto
         from account_clan where account_id = $1 order by clan_tag`,
      [acct.accountId],
    )
  ).rows;

test("adding a primary in a known clan follows it at activity scope", async () => {
  await profile(A, CLAN);
  const r = await addPlayer(db, alice, { tag: A, via: "console" });
  assert.equal(r.clanFollowed, CLAN);
  assert.deepEqual(await follows(alice), [
    { clan_tag: CLAN, scope: "activity", auto: true },
  ]);
  assert.equal((await clanRecording(CLAN)).scope, "activity");
  const { rows: events } = await db.query(
    `select kind, detail from account_event where account_id = $1 and kind = 'clan_added'`,
    [alice.accountId],
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].detail.auto, true);
});

test("a primary whose first profile lands later is followed then", async () => {
  const r = await addPlayer(db, alice, { tag: A, via: "console" });
  assert.equal(r.clanFollowed, null, "no profile yet: nothing to follow");
  assert.deepEqual(await follows(alice), []);
  await profile(A, CLAN);
  await followClanForPlayer(db, A);
  assert.deepEqual(await follows(alice), [
    { clan_tag: CLAN, scope: "activity", auto: true },
  ]);
  const again = await followClanForPlayer(db, A);
  assert.deepEqual(again, [], "idempotent: already following");
  assert.equal((await follows(alice)).length, 1);
});

test("a primary in no clan follows nothing, retained tag or not", async () => {
  await profile(A, null, { retained: CLAN });
  await addPlayer(db, alice, { tag: A, via: "console" });
  await followClanForPlayer(db, A);
  assert.deepEqual(await follows(alice), []);
});

test("only the primary: a watched player's clan is never followed", async () => {
  await profile(A, CLAN);
  await profile(B, OTHER);
  await addPlayer(db, alice, { tag: A, via: "console" });
  await addPlayer(db, alice, { tag: B, via: "console" });
  await followClanForPlayer(db, B);
  assert.deepEqual(
    (await follows(alice)).map((f) => f.clan_tag),
    [CLAN],
  );
});

test("already following the clan, at any scope, changes nothing", async () => {
  await db.query(`update account set role = 'leader' where account_id = $1`, [
    alice.accountId,
  ]);
  await addClan(db, alice, {
    tag: CLAN,
    scope: "comprehensive",
    via: "console",
  });
  await profile(A, CLAN);
  const r = await addPlayer(db, alice, { tag: A, via: "console" });
  assert.equal(r.clanFollowed, null);
  assert.deepEqual(await follows(alice), [
    { clan_tag: CLAN, scope: "comprehensive", auto: false },
  ]);
});

test("a full slot is never displaced", async () => {
  // A member's one activity slot is taken by a clan they chose.
  await db.query(
    `update account set max_player_recordings = null where account_id = $1`,
    [alice.accountId],
  );
  const own = await addClan(db, alice, {
    tag: OTHER,
    scope: "activity",
    via: "console",
  });
  assert.equal(own.ok, true);
  await profile(A, CLAN);
  const r = await addPlayer(db, alice, { tag: A, via: "console" });
  assert.equal(r.ok, true, "the add itself always stands");
  assert.equal(r.clanFollowed, null);
  assert.deepEqual(await follows(alice), [
    { clan_tag: OTHER, scope: "activity", auto: false },
  ]);
  assert.equal(await clanRecording(CLAN), undefined);
});

test("a clan the person stopped tracking is never followed again", async () => {
  await profile(A, CLAN);
  await addPlayer(db, alice, { tag: A, via: "console" });
  assert.equal((await follows(alice)).length, 1);
  await removeClan(db, alice, { tag: CLAN, via: "console" });
  await followClanForPlayer(db, A);
  assert.deepEqual(await follows(alice), []);
  // Tracking it by hand still works, and is the person's own follow.
  const back = await addClan(db, alice, {
    tag: CLAN,
    scope: "activity",
    via: "console",
  });
  assert.equal(back.ok, true);
  assert.deepEqual(await follows(alice), [
    { clan_tag: CLAN, scope: "activity", auto: false },
  ]);
});

test("a clan change moves Elixir's follow and never the person's", async () => {
  await db.query(`update account set role = 'family' where account_id = $1`, [
    alice.accountId,
  ]);
  await addClan(db, alice, { tag: THIRD, scope: "activity", via: "console" });
  await profile(A, CLAN);
  await addPlayer(db, alice, { tag: A, via: "console" });
  await profile(A, OTHER);
  await followClanForPlayer(db, A);
  assert.deepEqual(await follows(alice), [
    { clan_tag: OTHER, scope: "activity", auto: true },
    { clan_tag: THIRD, scope: "activity", auto: false },
  ]);
  assert.equal(await clanRecording(CLAN), undefined, "the old clan stops");
  const { rows: declined } = await db.query(
    `select clan_tag from account_clan_declined where account_id = $1`,
    [alice.accountId],
  );
  assert.deepEqual(declined, [], "a move is not a decline");
  // Leaving the clan for none leaves the follow as it was.
  await profile(A, null, { retained: OTHER });
  await followClanForPlayer(db, A);
  assert.equal((await follows(alice)).length, 2);
});

test("a follow the person changed is theirs and is not moved", async () => {
  await profile(A, CLAN);
  await addPlayer(db, alice, { tag: A, via: "console" });
  await addClan(db, alice, { tag: CLAN, scope: "activity", via: "console" });
  await profile(A, OTHER);
  await followClanForPlayer(db, A);
  assert.deepEqual(await follows(alice), [
    { clan_tag: CLAN, scope: "activity", auto: false },
  ]);
});

test("an account with auto_follow_clan off is not followed", async () => {
  await db.query(
    `update account set auto_follow_clan = false where account_id = $1`,
    [alice.accountId],
  );
  await profile(A, CLAN);
  const r = await addPlayer(db, alice, { tag: A, via: "console" });
  assert.equal(r.clanFollowed, null);
  await followClanForPlayer(db, A);
  assert.deepEqual(await follows(alice), []);
});

test("every account whose primary it is follows; nobody else", async () => {
  await profile(A, CLAN);
  await addPlayer(db, alice, { tag: A, via: "console" });
  await addPlayer(db, bob, { tag: B, via: "console" });
  await addPlayer(db, bob, { tag: A, via: "console" });
  assert.equal((await follows(alice)).length, 1);
  assert.deepEqual(await follows(bob), [], "A is bob's watched player");
});
