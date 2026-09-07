import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../../migrate/src/migrate.mjs";
import {
  emailHash,
  startMagicLogin,
  redeemMagicToken,
  verifyMagicCode,
  MAX_CODE_ATTEMPTS,
  createSessionToken,
  verifySessionToken,
  createSession,
  resolveSession,
  revokeSession,
  checkRateLimit,
  requestAccess,
  decideAccess,
  approvedAccount,
  pendingRequests,
  setAccountRole,
} from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_auth_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const SECRET = "test-session-secret";

let db;
const JAMIE = emailHash("Owner.Test@example.com ");

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: URL });
  await db.connect();
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

test("email hashing normalizes case and whitespace", () => {
  assert.equal(JAMIE, emailHash("owner.test@example.com"));
});

test("access gate: request -> pending -> approve; duplicates are quiet", async () => {
  const first = await requestAccess(db, {
    emailHash: JAMIE,
    playerTag: "#20JJJ2CCRU",
    note: "owner",
  });
  assert.equal(first.created, true);
  const dup = await requestAccess(db, { emailHash: JAMIE });
  assert.equal(dup.created, false, "repeat request is a quiet no-op");
  assert.equal(
    await approvedAccount(db, JAMIE),
    null,
    "pending is not approved",
  );
  const pending = await pendingRequests(db);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requested_player_tag, "#20JJJ2CCRU");
  const decided = await decideAccess(db, {
    emailHash: JAMIE,
    decision: "approved",
    actorRole: "owner",
  });
  assert.equal(decided.status, "approved");
  assert.ok(await approvedAccount(db, JAMIE));
});

test("access decisions obey the role hierarchy, not just isAdmin", async () => {
  const OWNER = emailHash("hierarchy-owner@example.com");
  const ADMIN = emailHash("hierarchy-admin@example.com");
  const OTHER_ADMIN = emailHash("hierarchy-admin-two@example.com");
  const MEMBER = emailHash("hierarchy-member@example.com");
  for (const [hash, role] of [
    [OWNER, "owner"],
    [ADMIN, "admin"],
    [OTHER_ADMIN, "admin"],
    [MEMBER, "member"],
  ]) {
    await requestAccess(db, { emailHash: hash });
    await db.query(
      `update account set role = $2, status = 'approved',
         is_owner = ($2 = 'owner') where email_hash = $1`,
      [hash, role],
    );
  }

  // The reported break: an admin denying the owner out of the service.
  const atOwner = await decideAccess(db, {
    emailHash: OWNER,
    decision: "denied",
    actorRole: "admin",
  });
  assert.equal(atOwner.refused, "owner_protected");
  assert.ok(await approvedAccount(db, OWNER), "owner keeps their access");

  // Nor may an admin unseat a peer.
  const atPeer = await decideAccess(db, {
    emailHash: OTHER_ADMIN,
    decision: "denied",
    actorRole: "admin",
  });
  assert.equal(atPeer.refused, "admin_protected");
  assert.ok(await approvedAccount(db, OTHER_ADMIN));

  // Re-approval is the same power and is refused the same way.
  await db.query(`update account set status = 'denied' where email_hash = $1`, [
    OTHER_ADMIN,
  ]);
  assert.equal(
    (
      await decideAccess(db, {
        emailHash: OTHER_ADMIN,
        decision: "approved",
        actorRole: "admin",
      })
    ).refused,
    "admin_protected",
    "an admin cannot re-approve a peer either",
  );

  // Not even the owner may deny the owner: availability outranks it.
  assert.equal(
    (
      await decideAccess(db, {
        emailHash: OWNER,
        decision: "denied",
        actorRole: "owner",
      })
    ).refused,
    "owner_protected",
  );

  // The owner still governs admins, and admins still govern members.
  assert.equal(
    (
      await decideAccess(db, {
        emailHash: OTHER_ADMIN,
        decision: "approved",
        actorRole: "owner",
      })
    ).status,
    "approved",
  );
  assert.equal(
    (
      await decideAccess(db, {
        emailHash: MEMBER,
        decision: "denied",
        actorRole: "admin",
      })
    ).status,
    "denied",
    "ordinary moderation is untouched",
  );

  // A non-console caller decides nothing, whatever the route thought.
  assert.equal(
    (
      await decideAccess(db, {
        emailHash: MEMBER,
        decision: "approved",
        actorRole: "family",
      })
    ).refused,
    "not_entitled",
  );
  // And an unknown target is still absent, not refused.
  assert.equal(
    await decideAccess(db, {
      emailHash: emailHash("nobody@example.com"),
      decision: "approved",
      actorRole: "owner",
    }),
    null,
  );
});

test("magic link: single-use, races lose the second redemption", async () => {
  const { token } = await startMagicLogin(db, { emailHash: JAMIE });
  const first = await redeemMagicToken(db, token);
  assert.equal(first.email_hash, JAMIE);
  assert.equal(
    await redeemMagicToken(db, token),
    null,
    "burned rows stay burned",
  );
});

test("magic code: wrong guesses count, cap locks, right code burns the shared row", async () => {
  const { token, code } = await startMagicLogin(db, { emailHash: JAMIE });
  for (let i = 0; i < 3; i += 1) {
    assert.equal(
      await verifyMagicCode(db, { emailHash: JAMIE, code: "000000" }),
      null,
    );
  }
  const ok = await verifyMagicCode(db, { emailHash: JAMIE, code });
  assert.equal(ok.email_hash, JAMIE);
  assert.equal(
    await redeemMagicToken(db, token),
    null,
    "code burned the same row the link uses",
  );
});

test("magic code: attempt cap is enforced before comparison", async () => {
  const { code } = await startMagicLogin(db, { emailHash: JAMIE });
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i += 1) {
    await verifyMagicCode(db, { emailHash: JAMIE, code: "999999" });
  }
  assert.equal(
    await verifyMagicCode(db, { emailHash: JAMIE, code }),
    null,
    "even the correct code fails once the cap is hit",
  );
});

test("session tokens: sign/verify round-trip, tamper and expiry rejected", () => {
  const { token } = createSessionToken({ secret: SECRET, sub: JAMIE });
  const claims = verifySessionToken({ secret: SECRET, token });
  assert.equal(claims.sub, JAMIE);
  assert.equal(verifySessionToken({ secret: "wrong", token }), null);
  const [encoded, sig] = token.split(".");
  assert.equal(
    verifySessionToken({ secret: SECRET, token: `${encoded}x.${sig}` }),
    null,
  );
  // Sliding sessions (sol-6): the TOKEN lasts to the 90-day absolute
  // cap - the DB row (checked every request) owns the 9-day sliding
  // truth. A 10-day-old token still verifies; a 91-day-old one never.
  const aged = createSessionToken({
    secret: SECRET,
    sub: JAMIE,
    now: Date.now() - 10 * 24 * 3600 * 1000,
  });
  assert.ok(
    verifySessionToken({ secret: SECRET, token: aged.token }),
    "inside the absolute cap the token holds; the DB row does the sliding",
  );
  const expired = createSessionToken({
    secret: SECRET,
    sub: JAMIE,
    now: Date.now() - 91 * 24 * 3600 * 1000,
  });
  assert.equal(
    verifySessionToken({ secret: SECRET, token: expired.token }),
    null,
  );
});

test("session rows: resolve enforces the access gate and revocation", async () => {
  const account = await approvedAccount(db, JAMIE);
  const minted = await createSession(db, {
    secret: SECRET,
    accountId: account.account_id,
    emailHash: JAMIE,
  });
  const resolved = await resolveSession(db, {
    secret: SECRET,
    token: minted.token,
  });
  assert.equal(resolved.accountId, account.account_id);
  assert.equal(resolved.isOwner, false);

  await revokeSession(db, minted.sessionId);
  assert.equal(
    await resolveSession(db, { secret: SECRET, token: minted.token }),
    null,
    "sign-out revokes",
  );

  // Gate: a valid session for a non-approved account resolves to nothing.
  const minted2 = await createSession(db, {
    secret: SECRET,
    accountId: account.account_id,
    emailHash: JAMIE,
  });
  await db.query(
    `update account set status = 'disabled' where email_hash = $1`,
    [JAMIE],
  );
  assert.equal(
    await resolveSession(db, { secret: SECRET, token: minted2.token }),
    null,
    "gate on every request",
  );
  await db.query(
    `update account set status = 'approved' where email_hash = $1`,
    [JAMIE],
  );
});

test("rate limit: counts within the hourly window", async () => {
  for (let i = 0; i < 3; i += 1) {
    assert.equal(
      await checkRateLimit(db, { bucket: "ip#1.2.3.4", max: 3 }),
      true,
    );
  }
  assert.equal(
    await checkRateLimit(db, { bucket: "ip#1.2.3.4", max: 3 }),
    false,
  );
  assert.equal(
    await checkRateLimit(db, { bucket: "ip#5.6.7.8", max: 3 }),
    true,
    "buckets are independent",
  );
});

// --------------------------------------------------------------- #29
test("a role change cannot ride authorization that went stale mid-flight", async () => {
  const TARGET = emailHash("race-target@example.com");
  const {
    rows: [target],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
     returning account_id`,
    [TARGET],
  );

  // The ordinary case still works: an admin may move a member.
  const moved = await setAccountRole(db, {
    accountId: target.account_id,
    role: "leader",
    actorRole: "admin",
  });
  assert.equal(moved.role, "leader");

  // THE RACE. A second connection promotes the target to admin and
  // holds the row lock open. Our role change arrives while that is
  // uncommitted, so it blocks on the lock rather than reading a stale
  // role — this is exactly the window the old select-then-update had.
  const other = new pg.Client({ connectionString: URL });
  await other.connect();
  try {
    await other.query("begin");
    await other.query(
      `update account set role = 'admin' where account_id = $1`,
      [target.account_id],
    );

    const inFlight = setAccountRole(db, {
      accountId: target.account_id,
      role: "member",
      actorRole: "admin",
    });
    // Let it reach the lock before the promotion commits.
    await new Promise((r) => setTimeout(r, 100));
    await other.query("commit");

    const result = await inFlight;
    assert.deepEqual(
      result,
      { refused: "not_entitled" },
      "the target became an admin; an admin may not demote one",
    );
  } finally {
    await other.end();
  }

  // And the row is what the promotion made it, not what the stale
  // authorization would have written.
  const { rows } = await db.query(
    `select role from account where account_id = $1`,
    [target.account_id],
  );
  assert.equal(rows[0].role, "admin", "no stale write landed");

  // The owner outranks admin and may still move that account.
  const byOwner = await setAccountRole(db, {
    accountId: target.account_id,
    role: "partner",
    actorRole: "owner",
  });
  assert.equal(byOwner.role, "partner");
});

test("the owner account is untouchable, and owner is never granted", async () => {
  const OWNER_HASH = emailHash("role-owner@example.com");
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, role, is_owner)
     values ($1, 'approved', 'owner', true) returning account_id`,
    [OWNER_HASH],
  );
  assert.deepEqual(
    await setAccountRole(db, {
      accountId: owner.account_id,
      role: "member",
      actorRole: "owner",
    }),
    { refused: "owner_protected" },
    "not even the owner demotes the owner - availability outranks it",
  );
  assert.deepEqual(
    await setAccountRole(db, {
      accountId: owner.account_id,
      role: "member",
      actorRole: "admin",
    }),
    { refused: "owner_protected" },
    "and an admin certainly does not",
  );

  const TARGET = emailHash("never-owner@example.com");
  const {
    rows: [t],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', 'member')
     returning account_id`,
    [TARGET],
  );
  assert.deepEqual(
    await setAccountRole(db, {
      accountId: t.account_id,
      role: "owner",
      actorRole: "owner",
    }),
    { refused: "bad_role" },
    "exactly one owner, never assigned by API",
  );
  assert.deepEqual(
    await setAccountRole(db, {
      accountId: t.account_id,
      role: "admin",
      actorRole: "admin",
    }),
    { refused: "not_entitled" },
    "an admin cannot mint another admin",
  );
  assert.equal(
    await setAccountRole(db, {
      accountId: "00000000-0000-0000-0000-000000000000",
      role: "member",
      actorRole: "owner",
    }),
    null,
    "no such account is null, not a refusal",
  );
});
