/**
 * The one global rate budget never goes negative, even when live mints
 * spend tokens while a tick plans (#448). The tick sizes its plan from
 * an unlocked read of the bucket; live mints on other connections can
 * take tokens before the tick charges. The old charge subtracted the
 * whole plan with no floor and left the bucket in debt, so bulk and live
 * together went past what the bucket held. The tick now takes its tokens
 * in one floored statement and enqueues only what it was granted.
 *
 * Real SQL on real connections: the tick on one, the live mints on
 * others, interleaved at the window the issue names.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { tickOnce } from "../src/handler.mjs";
import {
  enqueueJob,
  takeLiveToken,
} from "../../../packages/ledger/src/ledger.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_budget_race_${process.pid}`;
const URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const NOW = new Date("2026-09-03T12:00:00Z");
const ALPHA = "0289PYLQGRJCUV";

let tick; // the scheduler's connection
let live; // a live mint's connection

before(async () => {
  await createScratch(NAME);
  tick = new pg.Client({ connectionString: URL });
  live = new pg.Client({ connectionString: URL });
  await tick.connect();
  await live.connect();
  const {
    rows: [a],
  } = await tick.query(
    `insert into account (email_hash, status) values ('race-owner', 'approved') returning account_id`,
  );
  // Forty players, two endpoints each: far more due work than tokens.
  for (let i = 0; i < 40; i++) {
    const tag = `#0RR${ALPHA[Math.floor(i / 14)]}${ALPHA[i % 14]}`;
    await tick.query(`insert into player (player_tag) values ($1)`, [tag]);
    await tick.query(
      `insert into recording (subject_type, subject_tag, requested_by) values ('player', $1, $2)`,
      [tag, a.account_id],
    );
  }
});

beforeEach(async () => {
  await tick.query("delete from job");
  await tick.query("delete from poll_state");
  await tick.query("delete from budget_charge");
  await tick.query(
    "update budget_state set tokens = 20, rate_per_sec = 1, live_reserve = 0.1, settled_at = $1",
    [NOW],
  );
});

after(async () => {
  await tick?.end();
  await live?.end();
  await dropScratch(NAME);
});

/** A live mint as the live lane makes one: a token, then a live row for
 *  a subject the planner does not hold, committed on its own. */
async function mintLive(db, n, prefix) {
  let taken = 0;
  for (let i = 0; i < n; i++) {
    const token = await takeLiveToken(db);
    if (!token.ok) break;
    await enqueueJob(db, {
      endpoint: "player",
      entity_key: `#0${prefix}${ALPHA[Math.floor(i / 14) % 14]}${ALPHA[i % 14]}`,
      lane: "live",
    });
    taken += 1;
  }
  return taken;
}

/** The tick's connection, with `hook` run once, the moment the tick
 *  sends its first statement after reading the bucket: the window
 *  between the plan's unlocked read and its charge. */
function interleaved(db, hook) {
  let readBudget = false;
  let fired = false;
  return {
    async query(text, params) {
      const sql = typeof text === "string" ? text : text.text;
      if (readBudget && !fired) {
        fired = true;
        await hook();
      }
      if (/from budget_state/.test(sql) && /select tokens/.test(sql))
        readBudget = true;
      return db.query(text, params);
    },
  };
}

async function balance() {
  const {
    rows: [b],
  } = await tick.query("select tokens::float as tokens from budget_state");
  return b.tokens;
}

test("live mints during the planning window never drive the bucket negative (#448)", async () => {
  // The plan reads 20 tokens and sizes itself at floor(20 x 0.9) = 18.
  // While it plans, live mints take 15 of them and commit.
  let liveTaken = 0;
  await tick.query("begin");
  let result;
  try {
    result = await tickOnce(
      interleaved(tick, async () => {
        liveTaken = await mintLive(live, 15, "LV");
      }),
      NOW,
    );
    await tick.query("commit");
  } catch (error) {
    await tick.query("rollback");
    throw error;
  }
  assert.equal(liveTaken, 15, "the live mints got their tokens");
  const tokens = await balance();
  assert.ok(tokens >= 0, `the bucket went to ${tokens}`);
  // Bulk and live together spent no more than the bucket held.
  assert.ok(
    result.inserted + liveTaken <= 20,
    `${result.inserted} bulk + ${liveTaken} live from a 20-token bucket`,
  );
  // 5 left, bulk share floor(5 x 0.9) = 4: the plan shrank to its grant.
  assert.equal(result.granted, 4);
  assert.equal(result.jobs.length, 4);
  assert.equal(tokens, 1);
  const {
    rows: [q],
  } = await tick.query(
    "select count(*)::int as n from job where lane = 'bulk' and status = 'queued'",
  );
  assert.equal(q.n, 4, "only the granted jobs were enqueued");
  // The jobs that did not fit were not stamped as planned, so the next
  // tick takes them.
  const {
    rows: [p],
  } = await tick.query(
    "select count(*)::int as n from poll_state where last_planned_at is not null",
  );
  assert.equal(p.n, 4);
});

test("a tick and concurrent live mints on separate connections keep the bucket whole", async () => {
  const minters = [];
  for (let i = 0; i < 3; i++) {
    const c = new pg.Client({ connectionString: URL });
    await c.connect();
    minters.push(c);
  }
  try {
    for (let round = 0; round < 5; round++) {
      await tick.query("delete from job");
      await tick.query("delete from poll_state");
      await tick.query("update budget_state set tokens = 20, settled_at = $1", [
        NOW,
      ]);
      const start = await balance();
      const runTick = (async () => {
        await tick.query("begin");
        try {
          const r = await tickOnce(tick, NOW);
          await tick.query("commit");
          return r;
        } catch (error) {
          await tick.query("rollback");
          throw error;
        }
      })();
      const [r, ...taken] = await Promise.all([
        runTick,
        ...minters.map((c, i) => mintLive(c, 8, `M${ALPHA[i]}`)),
      ]);
      const live = taken.reduce((a, b) => a + b, 0);
      const tokens = await balance();
      assert.ok(tokens >= 0, `round ${round}: the bucket went to ${tokens}`);
      assert.ok(
        r.inserted + live <= start,
        `round ${round}: ${r.inserted} bulk + ${live} live from ${start}`,
      );
      assert.equal(tokens, start - r.inserted - live, "every token accounted");
    }
  } finally {
    for (const c of minters) await c.end();
  }
});

test("an old debt is never deepened and the ceiling does not move", async () => {
  await tick.query("update budget_state set tokens = -3, settled_at = $1", [
    NOW,
  ]);
  const r = await tickOnce(tick, NOW);
  assert.equal(r.granted, 0);
  assert.equal(r.jobs.length, 0);
  assert.equal(await balance(), -3, "repaid by accrual, never deepened");
  // Long idle: the settle caps at rate x 300 s before anything is granted.
  const later = new Date(NOW.getTime() + 3600_000);
  await tick.query("delete from job");
  const full = await tickOnce(tick, later);
  assert.equal(full.granted, full.jobs.length);
  assert.ok(full.inserted > 0);
  assert.equal(
    await balance(),
    300 - full.inserted,
    "settled to the 300-token ceiling, then charged",
  );
});
