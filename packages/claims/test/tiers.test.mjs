/**
 * Tiers are earned in the game and read on every use (#530, #539):
 * Leader while a VERIFIED player of the account's own leads or co-leads a
 * clan the account tracks, Family while a collector it runs is active.
 * A stored hand grant of leader or family no longer counts, and losing a
 * tier never removes what the pool already records: only the next add is
 * refused.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ROLES, tierSql } from "@elixir-mcp/contracts";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import {
  addPlayer,
  addClan,
  poolOwner,
  poolLimits,
  pooledUsage,
} from "../src/index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_tiers_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const P = "#2YG98VVQ";
const Q = "#20JJJ2CCRU";
const CLAN = "#J2RGCRVG";
const OTHER = "#GCYQR9VY";

let db;
let n = 0;

async function person(role = "member") {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (email_hash, status, role) values ($1, 'approved', $2)
     returning account_id`,
    [`tier-${process.pid}-${++n}`, role],
  );
  return { accountId: a.account_id };
}

async function agent(owner, role = "leader") {
  const {
    rows: [a],
  } = await db.query(
    `insert into account (status, role, kind, owned_by_account_id, public_id)
     values ('approved', $2, 'agent', $1, $3) returning account_id`,
    [owner.accountId, role, `tierag${++n}`],
  );
  return { accountId: a.account_id };
}

const tier = async (acct) => (await poolOwner(db, acct.accountId)).role;

async function collector(acct, status) {
  await db.query(
    `insert into gateway (owner_account_id, name, static_ip, status)
     values ($1, $2, '127.0.0.1', $3)`,
    [acct.accountId, `gw-${++n}`, status],
  );
}

async function membership(tag, clan, role, open = true) {
  await db.query(
    `insert into clan (clan_tag) values ($1) on conflict do nothing`,
    [clan],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at, role)
     values ($1, $2, now() - interval '1 day', $3, $4)`,
    [clan, tag, open ? null : new Date(), role],
  );
}

const verify = (acct, tag) =>
  db.query(
    `update claim set status = 'verified' where account_id = $1 and player_tag = $2`,
    [acct.accountId, tag],
  );

/** A person whose primary P leads CLAN, with CLAN tracked; verified unless told not. */
async function leaderSetup({ verified = true, role = "leader" } = {}) {
  const a = await person();
  await addPlayer(db, a, { tag: P, via: "test", makePrimary: true });
  await addClan(db, a, { tag: CLAN, scope: "activity", via: "test" });
  await membership(P, CLAN, role);
  if (verified) await verify(a, P);
  return a;
}

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
  await db.query(`delete from clan_membership`);
  await db.query(`delete from gateway`);
  await db.query(`delete from account_event`);
  await db.query(`delete from claim`);
  await db.query(`delete from account_clan`);
  await db.query(`delete from recording`);
  await db.query(`delete from account where kind = 'agent'`);
  await db.query(`delete from account`);
});

test("a new person is a member", async () => {
  assert.equal(await tier(await person()), "member");
});

test("Family: only an active collector earns it, with no bonus on top", async () => {
  for (const status of ["pending", "probation", "draining", "revoked"]) {
    const a = await person();
    await collector(a, status);
    assert.equal(await tier(a), "member", status);
  }
  const op = await person();
  await collector(op, "revoked");
  await collector(op, "active");
  assert.equal(await tier(op), "family");
  const limits = poolLimits(await poolOwner(db, op.accountId));
  assert.equal(limits.player_slots, ROLES.family.player_slots);
  assert.equal(limits.activity, ROLES.family.activity_clans);
  assert.equal(limits.comprehensive, ROLES.family.comprehensive_clans);
});

test("Leader: a verified own player leading or co-leading a tracked clan", async () => {
  assert.equal(await tier(await leaderSetup()), "leader");
  await db.query(`delete from clan_membership`);
  await db.query(`delete from account_clan`);
  await db.query(`delete from claim`);
  assert.equal(await tier(await leaderSetup({ role: "coLeader" })), "leader");
});

test("Leader needs Verify: an unverified claim on a leader's tag earns nothing", async () => {
  assert.equal(await tier(await leaderSetup({ verified: false })), "member");
});

test("Leader needs the clan tracked, the membership open and the role leading", async () => {
  const elder = await leaderSetup({ role: "elder" });
  assert.equal(await tier(elder), "member", "elder is not a leader");

  await db.query(`update clan_membership set role = 'leader'`);
  assert.equal(await tier(elder), "leader");

  await db.query(`delete from account_clan where account_id = $1`, [
    elder.accountId,
  ]);
  assert.equal(await tier(elder), "member", "the clan is not tracked");

  await addClan(db, elder, { tag: OTHER, scope: "activity", via: "test" });
  assert.equal(
    await tier(elder),
    "member",
    "tracking another clan is no ground",
  );

  await db.query(`update clan_membership set left_observed_at = now()`);
  await addClan(db, elder, { tag: CLAN, scope: "activity", via: "test" });
  assert.equal(await tier(elder), "member", "a left membership is no ground");
});

test("a watched player who leads is no ground: only the person's own players", async () => {
  const a = await person();
  await addPlayer(db, a, { tag: P, via: "test", makePrimary: true });
  await addPlayer(db, a, { tag: Q, via: "test" });
  const { rows } = await db.query(
    `select is_primary, relationship from claim where account_id = $1 and player_tag = $2`,
    [a.accountId, Q],
  );
  assert.deepEqual(rows[0], { is_primary: false, relationship: "watching" });
  await addClan(db, a, { tag: CLAN, scope: "activity", via: "test" });
  await membership(Q, CLAN, "leader");
  // Even verified, a 'watching' claim is somebody else.
  await verify(a, Q);
  assert.equal(await tier(a), "member");
});

test("the higher earned tier wins: a leader who runs a collector is Family", async () => {
  const a = await leaderSetup();
  await collector(a, "active");
  assert.equal(await tier(a), "family");
});

test("a stored hand grant of leader or family no longer counts; partner does", async () => {
  assert.equal(await tier(await person("leader")), "member");
  assert.equal(await tier(await person("family")), "member");
  assert.equal(await tier(await person("partner")), "partner");
  const p = await person("partner");
  await collector(p, "active");
  assert.equal(await tier(p), "partner", "a grant above Family stands");
});

test("losing a tier cuts nothing: what is recorded stays, the next add is refused", async () => {
  const a = await leaderSetup();
  await collector(a, "active");
  assert.equal(await tier(a), "family");
  for (const tag of [OTHER, "#9VUP08YL"])
    assert.equal(
      (await addClan(db, a, { tag, scope: "activity", via: "test" })).ok,
      true,
      tag,
    );
  const held = await pooledUsage(db, a.accountId);
  assert.equal(held.activity_used, 3, "the Family ceiling, full");

  await db.query(`update gateway set status = 'draining'`);
  await db.query(`update clan_membership set role = 'member'`);
  assert.equal(await tier(a), "member", "the ground went");

  const after = await pooledUsage(db, a.accountId);
  assert.deepEqual(after, held, "nothing removed");
  const { rows } = await db.query(
    `select count(*)::int as n from account_clan where account_id = $1`,
    [a.accountId],
  );
  assert.equal(rows[0].n, 3);
  const refused = await addClan(db, a, {
    tag: "#PYLQGRJC",
    scope: "activity",
    via: "test",
  });
  assert.equal(refused.ok, false, "the live count refuses the next add");
});

test("an agent follows its owner's earned tier, never above leader", async () => {
  const owner = await person();
  const ag = await agent(owner, "leader");
  const agTier = async () =>
    (
      await db.query(
        `select ${tierSql("a")} as role
           from account a where a.account_id = $1`,
        [ag.accountId],
      )
    ).rows[0].role;
  assert.equal(await agTier(), "member", "a member's agent, stored leader");
  await collector(owner, "active");
  assert.equal(
    await agTier(),
    "leader",
    "a Family owner's agent is capped at leader",
  );
  assert.equal(await tier(ag), "family", "the pool spends the owner's tier");
});
