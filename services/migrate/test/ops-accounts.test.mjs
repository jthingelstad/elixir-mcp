import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { accountEnrollOp } from "../src/ops-accounts.mjs";
import { emailHash } from "../../auth/src/crypto.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_accounts_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${SCRATCH}`);
  await admin.end();
  await migrate({
    databaseUrl: SCRATCH_URL,
    migrationsDir: path.join(repoRoot, "db/migrations"),
  });
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  // An existing member with an account, a clan the record knows, and two
  // players it has seen: one in that clan, one it has no clan for.
  await db.query(`insert into clan (clan_tag) values ('#J2RGCRVG')`);
  await db.query(
    `insert into player (player_tag) values ('#2PP0V9PP'), ('#2PP0V9QQ'), ('#2PP0V9RR')`,
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at)
     values ('#J2RGCRVG', '#2PP0V9PP', now())`,
  );
  await db.query(
    `insert into account (email_hash, email, status, role, kind, decided_at)
     values ($1, 'existing@example.com', 'approved', 'member', 'person', now())`,
    [emailHash("existing@example.com")],
  );
});

after(async () => {
  await db.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.end();
});

const ENTRIES = [
  { email: "Existing@Example.com", player_tag: "#2PP0V9RR" },
  { email: "one@example.com", player_tag: "2pp0v9pp" },
  { email: "two@example.com", player_tag: "#2PP0V9QQ", clan_tag: null },
];

test("dry run plans without writing: exists is skipped, clan from the record, null defers", async () => {
  const out = await accountEnrollOp(SCRATCH_URL, {
    dry_run: true,
    accounts: ENTRIES,
  });
  assert.equal(out.dry_run, true);
  assert.equal(out.skipped, 1);
  assert.equal(out.created, 2);
  const [skip, one, two] = out.plan;
  assert.equal(skip.action, "skip");
  assert.equal(skip.reason, "exists");
  assert.equal(one.player_tag, "#2PP0V9PP");
  assert.equal(one.clan_tag, "#J2RGCRVG");
  assert.equal(one.clan, "from_record");
  assert.equal(one.recording_starts, true);
  assert.equal(two.clan, "deferred");
  assert.equal(two.clan_tag, null);
  const { rows } = await db.query(`select count(*)::int as n from account`);
  assert.equal(rows[0].n, 1);
  assert.ok(!("account_id" in one));
});

test("the real run creates approved member accounts, claims primaries, tracks the clan, and is idempotent", async () => {
  const out = await accountEnrollOp(SCRATCH_URL, {
    dry_run: false,
    source: "elixir-bot",
    accounts: ENTRIES,
  });
  assert.equal(out.created, 2);
  const one = out.plan[1];
  assert.ok(one.account_id);
  assert.equal(one.claimed, true);
  assert.equal(one.recording_started, true);

  const { rows: accts } = await db.query(
    `select email, status, role, kind, requested_player_tag,
            onboarded_at is not null as onboarded
     from account where email in ('one@example.com', 'two@example.com')
     order by email`,
  );
  assert.deepEqual(
    accts.map((a) => [
      a.status,
      a.role,
      a.kind,
      a.requested_player_tag,
      a.onboarded,
    ]),
    [
      ["approved", "member", "person", "#2PP0V9PP", true],
      ["approved", "member", "person", "#2PP0V9QQ", false],
    ],
  );
  const { rows: claims } = await db.query(
    `select c.player_tag, c.is_primary, c.relationship
     from claim c join account a on a.account_id = c.account_id
     where a.email = 'one@example.com'`,
  );
  assert.deepEqual(claims, [
    { player_tag: "#2PP0V9PP", is_primary: true, relationship: "primary" },
  ]);
  const { rows: clans } = await db.query(
    `select ac.clan_tag, ac.scope from account_clan ac
     join account a on a.account_id = ac.account_id
     where a.email = 'one@example.com'`,
  );
  assert.deepEqual(clans, [{ clan_tag: "#J2RGCRVG", scope: "activity" }]);
  const { rows: rec } = await db.query(
    `select subject_type, subject_tag from recording
     where status = 'active' order by subject_type, subject_tag`,
  );
  assert.deepEqual(
    rec.map((r) => `${r.subject_type}:${r.subject_tag}`),
    ["clan:#J2RGCRVG", "player:#2PP0V9PP", "player:#2PP0V9QQ"],
  );
  const { rows: ev } = await db.query(
    `select e.kind from account_event e join account a on a.account_id = e.account_id
     where a.email = 'one@example.com' order by event_id`,
  );
  assert.deepEqual(
    ev.map((e) => e.kind),
    ["enrolled", "claim_added", "recording_started"],
  );

  // Running it again touches nothing: everyone now exists.
  const again = await accountEnrollOp(SCRATCH_URL, {
    dry_run: false,
    accounts: ENTRIES,
  });
  assert.equal(again.created, 0);
  assert.equal(again.skipped, 3);
});

test("refuses an empty list and reports a bad tag without stopping the rest", async () => {
  assert.deepEqual(await accountEnrollOp(SCRATCH_URL, { accounts: [] }), {
    error: "accounts required",
  });
  const out = await accountEnrollOp(SCRATCH_URL, {
    dry_run: true,
    accounts: [
      { email: "bad@example.com", player_tag: "not a tag" },
      { email: "nope", player_tag: "#2PP0V9PP" },
    ],
  });
  assert.equal(out.plan[0].error, "bad player_tag");
  assert.equal(out.plan[1].error, "email required");
});
