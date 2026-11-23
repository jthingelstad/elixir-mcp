import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import {
  testAccountOp,
  parseTestAccountSpec,
} from "../src/ops-test-account.mjs";
import { funnelOp } from "../src/ops-funnel.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_test_account_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const CLAN = "#J2RGCRVG";
const hash = () => crypto.randomBytes(32).toString("hex");

let db;

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  const {
    rows: [owner],
  } = await db.query(
    `insert into account (email_hash, status, role, is_owner)
     values ('owner-hash', 'approved', 'owner', true) returning account_id`,
  );
  await db.query(`insert into clan (clan_tag) values ($1)`, [CLAN]);
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by)
     values ('clan', $1, $2)`,
    [CLAN, owner.account_id],
  );
});

after(async () => {
  await db.end();
  await dropScratch(SCRATCH);
});

const spec = (over = {}) => ({
  name: "acceptance",
  clan_tag: CLAN,
  token_hash: hash(),
  scope: "cr:read",
  hourly_rate_limit: 2400,
  mcp_daily_quota: 50000,
  ...over,
});

test("the spec refuses what a test key must never be", () => {
  assert.equal(
    parseTestAccountSpec(spec({ name: "No Spaces" })).error,
    "invalid_name",
  );
  assert.equal(
    parseTestAccountSpec(spec({ token_hash: "abc" })).error,
    "invalid_token_hash",
  );
  for (const scope of [
    "",
    "feedback:write",
    "cr:read account:email",
    "cr:read follows:write",
  ])
    assert.equal(
      parseTestAccountSpec(spec({ scope })).error,
      "invalid_scope",
      scope,
    );
  assert.equal(
    parseTestAccountSpec(spec({ clan_tag: "J2RGCRVG" })).error,
    "invalid_clan_tag",
  );
  assert.match(
    parseTestAccountSpec(spec({ hourly_rate_limit: 0 })).error,
    /hourly_rate_limit/,
  );
  assert.equal(
    parseTestAccountSpec(spec({ scope: "cr:read feedback:write" })).scope,
    "cr:read feedback:write",
  );
  assert.equal(parseTestAccountSpec(spec()).dryRun, true, "dry run by default");
});

test("a dry run writes nothing; an unrecorded clan and a used hash are refused", async () => {
  const plan = await testAccountOp(SCRATCH_URL, spec());
  assert.equal(plan.dry_run, true);
  assert.equal(plan.action, "create");
  const {
    rows: [{ n }],
  } = await db.query(
    `select count(*)::int as n from account where test_name is not null`,
  );
  assert.equal(n, 0);
  assert.deepEqual(
    await testAccountOp(
      SCRATCH_URL,
      spec({ clan_tag: "#0GRJCUV", dry_run: false }),
    ),
    { error: "clan_not_recorded", clan_tag: "#0GRJCUV" },
  );
});

test("create, then re-key: a person with no address, one clan, one live key", async () => {
  const first = spec({ dry_run: false });
  const made = await testAccountOp(SCRATCH_URL, first);
  assert.equal(made.ok, true);
  assert.equal(made.action, "create");
  assert.equal(made.revoked, 0);

  const {
    rows: [account],
  } = await db.query(
    `select account_id, kind, status, role, email, email_hash, newsletter_opt_in,
            onboarded_at is not null as onboarded, mcp_daily_quota
       from account where test_name = 'acceptance'`,
  );
  assert.equal(account.kind, "person");
  assert.equal(account.status, "approved");
  assert.equal(account.role, "member");
  assert.equal(account.email, null);
  assert.equal(account.email_hash, "test:acceptance");
  assert.equal(account.newsletter_opt_in, false);
  assert.equal(account.onboarded, true);
  assert.equal(account.mcp_daily_quota, 50000);

  assert.deepEqual(
    await testAccountOp(SCRATCH_URL, { ...first }),
    { error: "token_hash_in_use" },
    "a hash is never reused",
  );

  const rekey = await testAccountOp(
    SCRATCH_URL,
    spec({ dry_run: false, hourly_rate_limit: 1200 }),
  );
  assert.equal(rekey.action, "rekey");
  assert.equal(rekey.revoked, 1);
  const { rows: keys } = await db.query(
    `select token_hash, revoked_at is null as live, hourly_rate_limit, scope
       from service_token where account_id = $1 order by token_id`,
    [account.account_id],
  );
  assert.equal(keys.length, 2);
  assert.deepEqual(
    keys.map((k) => k.live),
    [false, true],
  );
  assert.equal(keys[0].token_hash, first.token_hash);
  assert.equal(keys[1].hourly_rate_limit, 1200);
  assert.equal(keys[1].scope, "cr:read");

  const { rows: clans } = await db.query(
    `select clan_tag, scope, notify, is_primary from account_clan where account_id = $1`,
    [account.account_id],
  );
  assert.deepEqual(clans, [
    { clan_tag: CLAN, scope: "activity", notify: true, is_primary: false },
  ]);
});

test("list reads back every test account without a hash; the funnel leaves them out", async () => {
  await testAccountOp(
    SCRATCH_URL,
    spec({
      name: "gym",
      scope: "cr:read feedback:write",
      hourly_rate_limit: 1000000,
      dry_run: false,
    }),
  );
  const { test_accounts } = await testAccountOp(SCRATCH_URL, { list: true });
  assert.deepEqual(
    test_accounts.map((a) => a.name),
    ["acceptance", "gym"],
  );
  const gym = test_accounts[1];
  assert.equal(gym.kind, "person");
  assert.equal(gym.has_address, false);
  assert.equal(gym.claims, 0);
  assert.deepEqual(
    gym.clans.map((c) => c.clan_tag),
    [CLAN],
  );
  assert.equal(gym.live_keys.length, 1);
  assert.equal(gym.live_keys[0].scope, "cr:read feedback:write");
  assert.doesNotMatch(JSON.stringify(test_accounts), /token_hash|[0-9a-f]{64}/);

  const funnel = await funnelOp(SCRATCH_URL, { days: 30 });
  // The owner alone: test accounts are not people signing up.
  assert.equal(funnel.overall.accounts, 1);
});
