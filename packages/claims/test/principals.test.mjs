/**
 * createPrincipal against a real database.
 *
 * This is the shared half of two very different doors — a signed-in person in
 * the console, and an ops invocation registering a key minted on an operator's
 * machine. Testing it here rather than only through the routes is what stops
 * the two paths drifting on the rules that matter: whose clan, which tier, how
 * many, and what a duplicate name means.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import pg from "pg";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import { createPrincipal } from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_principals_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
let db;
let admin;
let member;

before(async () => {
  const a = new pg.Client({ connectionString: ADMIN_URL });
  await a.connect();
  await a.query(`drop database if exists ${NAME} with (force)`);
  await a.query(`create database ${NAME}`);
  await a.end();
  await migrate({
    databaseUrl: URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: URL });
  await db.connect();

  const mk = async (email, role, clans = []) => {
    const { rows } = await db.query(
      `insert into account (email_hash, status, role) values ($1, 'approved', $2)
       returning account_id, role, kind`,
      [hash(email), role],
    );
    for (const tag of clans)
      await db.query(
        `insert into account_clan (account_id, clan_tag, scope) values ($1, $2, 'comprehensive')`,
        [rows[0].account_id, tag],
      );
    return {
      accountId: rows[0].account_id,
      role: rows[0].role,
      kind: rows[0].kind,
    };
  };
  admin = await mk("admin@x", "admin", ["#J2RGCRVG"]);
  member = await mk("member@x", "member", ["#2GUCVLQR"]);
});

after(async () => {
  await db.end();
  const a = new pg.Client({ connectionString: ADMIN_URL });
  await a.connect();
  await a.query(`drop database if exists ${NAME} with (force)`);
  await a.end();
});

test("an agent takes its owner's clan as its primary subject", async () => {
  const r = await createPrincipal(db, admin, {
    kind: "agent",
    name: "poap-kings",
    clanTag: "#J2RGCRVG",
    tokenHash: hash("a"),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.principal.public_id, /^[a-z0-9]{8,16}$/);
  const { rows } = await db.query(
    `select clan_tag, is_primary from account_clan where account_id = $1`,
    [r.principal.account_id],
  );
  assert.deepEqual(rows, [{ clan_tag: "#J2RGCRVG", is_primary: true }]);
});

test("an admin's agent is not an admin, and a member's agent is a member", async () => {
  const { rows } = await db.query(
    `select role from account where owned_by_account_id = $1 and kind = 'agent'`,
    [admin.accountId],
  );
  assert.equal(rows[0].role, "leader");

  const r = await createPrincipal(db, member, {
    kind: "agent",
    name: "my-clan",
    clanTag: "#2GUCVLQR",
    tokenHash: hash("b"),
  });
  assert.equal(r.principal.role, "member");
});

test("a clan you have not added is refused, whichever door you came in by", async () => {
  const r = await createPrincipal(db, admin, {
    kind: "agent",
    name: "somebody-else",
    clanTag: "#2GUCVLQR",
    tokenHash: hash("c"),
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, "clan_not_added");
});

test("integrations are partner+, and counted", async () => {
  const refused = await createPrincipal(db, member, {
    kind: "integration",
    name: "app",
    tokenHash: hash("d"),
  });
  assert.equal(refused.error, "not_entitled");

  // admin is unlimited, so it can hold more than partner's single slot.
  for (const n of ["drop", "site"]) {
    const ok = await createPrincipal(db, admin, {
      kind: "integration",
      name: n,
      tokenHash: hash(n),
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
  }
});

test("a raw token can never be passed in by accident", async () => {
  // The signature takes a digest. Anything that is not one is refused before a
  // row is written, so a caller that reaches for the wrong variable fails loudly
  // rather than storing a secret in a hash column.
  for (const bad of ["svt_notahash", "", null, "abc", hash("x").slice(0, 63)]) {
    const r = await createPrincipal(db, admin, {
      kind: "agent",
      name: "nope",
      clanTag: "#J2RGCRVG",
      tokenHash: bad,
    });
    assert.equal(r.error, "invalid_token_hash", String(bad));
  }
});

test("one owner cannot reuse a name, another owner can", async () => {
  const dupe = await createPrincipal(db, admin, {
    kind: "agent",
    name: "poap-kings",
    clanTag: "#J2RGCRVG",
    tokenHash: hash("e"),
  });
  assert.equal(dupe.error, "name_taken");

  const other = await createPrincipal(db, member, {
    kind: "agent",
    name: "poap-kings",
    clanTag: "#2GUCVLQR",
    tokenHash: hash("f"),
  });
  assert.equal(other.ok, true, "uniqueness is per account, not global");
});

test("a refused create leaves nothing behind", async () => {
  const before = await db.query(`select count(*)::int as n from account`);
  await createPrincipal(db, admin, {
    kind: "agent",
    name: "ghost",
    clanTag: "#NOTMINE",
    tokenHash: hash("g"),
  });
  const after = await db.query(`select count(*)::int as n from account`);
  assert.equal(after.rows[0].n, before.rows[0].n, "no orphan account row");
});

test("agents are capped per owner by tier, under the account lock", async () => {
  const { roleQuotas } = await import("@elixir-mcp/contracts");
  const limit = roleQuotas("member").agents;
  assert.ok(Number.isFinite(limit) && limit >= 1);
  // The member already created one agent above ("my-clan").
  const { rows: existing } = await db.query(
    `select count(*)::int as n from account
     where owned_by_account_id = $1 and kind = 'agent' and status = 'approved'`,
    [member.accountId],
  );
  for (let i = existing[0].n; i < limit; i++) {
    const ok = await createPrincipal(db, member, {
      kind: "agent",
      name: `cap-${i}`,
      clanTag: "#2GUCVLQR",
      tokenHash: hash(`cap-${i}`),
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
  }
  const over = await createPrincipal(db, member, {
    kind: "agent",
    name: "one-too-many",
    clanTag: "#2GUCVLQR",
    tokenHash: hash("one-too-many"),
  });
  assert.equal(over.ok, false);
  assert.equal(over.error, "not_entitled");
  assert.equal(over.reason, "agent_limit");
  assert.equal(over.limit, limit);
  assert.equal(over.role, "member");
  // Nothing half-created: the refused agent left no account and no key.
  const { rows: after } = await db.query(
    `select count(*)::int as n from account
     where owned_by_account_id = $1 and kind = 'agent'`,
    [member.accountId],
  );
  assert.equal(after[0].n, limit);
  assert.equal(roleQuotas("admin").agents, Infinity);
});
