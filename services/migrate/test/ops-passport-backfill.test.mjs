/**
 * {passport_backfill} (#1015, 0272): the legacy Stamps for accounts made
 * before launch. A dry run writes nothing and answers what an apply
 * writes; batches follow a cursor to done; a second apply grants
 * nothing; accounts made after launch and removed accounts are
 * never read; the answer is counts only. Every tag is invented
 * (docs/invented-tags.json).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  cheersBeforeLaunch,
  passportBackfill,
  passportBackfillOp,
  readSpec,
} from "../src/ops-passport-backfill.mjs";
import { classifyOp } from "../../../infra/scripts/lib/ops-invoke.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_passport_backfill_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const ONE = "#0YRQJGCJL";
const TWO = "#0990UQVG";
const LAUNCH = "2026-09-01T00:00:00.000Z";
const BEFORE = "2026-07-02T00:00:00Z";
const AFTER = "2026-09-05T12:00:00Z";
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let db;
let seq = 0;
const ids = {};

async function account({ created = BEFORE, hash } = {}) {
  seq += 1;
  return (
    await db.query(
      `insert into account (email_hash, status, role, created_at)
       values ($1, 'approved', 'member', $2) returning account_id`,
      [hash ?? `backfill-${seq}`, created],
    )
  ).rows[0].account_id;
}

async function verified(accountId, tag) {
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship,
                        status, verified_at, created_at)
     values ($1, $2, true, 'primary', 'verified', $3, $3)`,
    [accountId, tag, BEFORE],
  );
}

const rows = async (sql, params) => (await db.query(sql, params)).rows;
const stored = () =>
  rows(
    `select (select count(*)::int from account_stamp_earned) as earned,
            (select count(*)::int from account_stamp_fact) as facts,
            (select count(*)::int from account_stamp_earned
              where legacy_before is null) as ordinary`,
  ).then((r) => r[0]);

// Two cheers on other people's items before launch for every account the
// test resolves cheers for; the real resolver is tested on its own below.
const twoCheers = async () => [
  { source: "cheer:tl_00000000000000000001", event_at: "2026-08-03T10:00:00Z" },
  { source: "cheer:tl_00000000000000000002", event_at: "2026-08-04T10:00:00Z" },
];

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  await db.query(`update passport_launch set launched_at = $1`, [LAUNCH]);
  for (const tag of [ONE, TWO])
    await db.query(`insert into player (player_tag) values ($1)`, [tag]);
  ids.one = await account();
  await verified(ids.one, ONE);
  ids.two = await account();
  await verified(ids.two, TWO);
  ids.bare = await account();
  ids.removed = await account({ hash: "removed:backfill" });
  ids.late = await account({ created: AFTER });
});

after(async () => {
  await db?.end();
  await dropScratch(SCRATCH);
});

test("the request: a dry run unless apply is exactly true; unknown keys and bad bounds are refused", () => {
  assert.equal(readSpec({}).apply, false);
  assert.equal(readSpec(true).apply, false);
  assert.equal(readSpec({ apply: true }).apply, true);
  assert.equal(readSpec({ apply: "yes" }).error, "apply must be true or false");
  assert.deepEqual(readSpec({ dry_run: true }), {
    error: "unknown_keys",
    keys: ["dry_run"],
  });
  assert.ok(readSpec({ after: "#0YRQJGCJL" }).error);
  assert.ok(readSpec({ limit: 0 }).error);
  assert.ok(readSpec({ budget_ms: 120_000 }).error);
  assert.ok(readSpec([]).error);
});

test("every run takes the production lock, the dry run too (it writes, then rolls back)", () => {
  for (const v of [{}, { apply: true }, { apply: false }, true])
    assert.equal(classifyOp("migrate", { passport_backfill: v }).kind, "write");
});

test("a dry run writes nothing; batches follow the cursor; an apply writes what the dry run said; a second apply grants nothing", async () => {
  const run = (spec) =>
    passportBackfill(db, readSpec(spec), {
      now: new Date("2026-09-10T00:00:00Z"),
      resolveCheers: twoCheers,
    });
  const dry = await run({});
  assert.equal(dry.dry_run, true);
  assert.equal(dry.done, true);
  // Three approved people made before launch; never the removed account
  // or the one made after launch.
  assert.equal(dry.accounts, 3);
  assert.deepEqual(await stored(), { earned: 0, facts: 0, ordinary: 0 });
  assert.deepEqual(dry.granted, { player_verified: { 1: 2 } });
  assert.deepEqual(dry.facts, {
    played_together: 0,
    // Two cheers each are below Cheerleader's first level (3): facts,
    // no level.
    cheerleader: 6,
    storyteller: 0,
  });
  assert.equal(dry.accounts_granted, 2);
  assert.equal(dry.setup_settled, 3);
  // Counts only: no account id, tag or address anywhere once done.
  const text = JSON.stringify(dry);
  assert.doesNotMatch(text, UUID_RE);
  assert.doesNotMatch(text, /#[0-9A-Z]{3,}/);
  assert.doesNotMatch(text, /@/);

  // Applied in batches of two: the cursor, then done.
  const first = await run({ apply: true, limit: 2 });
  assert.equal(first.accounts, 2);
  assert.equal(first.done, false);
  assert.equal(first.remaining, 1);
  assert.match(first.after, UUID_RE);
  const second = await run({ apply: true, limit: 2, after: first.after });
  assert.equal(second.accounts, 1);
  assert.equal(second.done, true);
  assert.equal(second.after, null);
  const merged = {};
  for (const b of [first, second])
    for (const [stamp, by] of Object.entries(b.granted))
      for (const [level, n] of Object.entries(by)) {
        merged[stamp] ??= {};
        merged[stamp][level] = (merged[stamp][level] ?? 0) + n;
      }
  assert.deepEqual(merged, dry.granted);
  assert.equal(
    first.facts.cheerleader + second.facts.cheerleader,
    dry.facts.cheerleader,
  );
  const now = await stored();
  assert.equal(now.earned, 2);
  assert.equal(now.facts, 6);
  assert.equal(now.ordinary, 0, "a backfill writes legacy rows only");

  const again = await run({ apply: true });
  assert.deepEqual(again.granted, {});
  assert.equal(again.accounts_granted, 0);
  assert.equal(again.setup_settled, 0);
  assert.deepEqual(again.facts, {
    played_together: 0,
    cheerleader: 0,
    storyteller: 0,
  });
  assert.deepEqual(await stored(), now);
});

test("the op checks its request before it connects", async () => {
  assert.deepEqual(
    await passportBackfillOp("postgres://nobody@127.0.0.1:1/none", {
      apply: 1,
    }),
    { error: "apply must be true or false" },
  );
});

test("cheers: none before launch, or an item not found again, resolve to nothing", async () => {
  assert.deepEqual(await cheersBeforeLaunch(db, ids.bare, LAUNCH), []);
  await db.query(
    `insert into timeline_cheer (account_id, item_id, cheer, created_at)
     values ($1, 'tl_00000000000000000009', 'on_fire', $2)`,
    [ids.one, "2026-08-20T00:00:00Z"],
  );
  // The account follows nothing whose feed holds that item: left out.
  assert.deepEqual(await cheersBeforeLaunch(db, ids.one, LAUNCH), []);
});
