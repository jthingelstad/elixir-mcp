import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { createPostgresStore } from "@elixir-mcp/clan-state/postgres";
import { evaluateClanTick, expireModelUses } from "../src/clan.mjs";
const clan = "#P0LYQ";
let scratch, state, other;
before(async () => {
  scratch = await scratchDb("clan_job");
  state = createPostgresStore(scratch.db);
  other = new pg.Client({ connectionString: scratch.url });
  await other.connect();
});
after(async () => {
  await other?.end();
  await scratch?.drop();
});
beforeEach(async () => scratch.db.query("truncate clan_state"));
const settings = (manage = {}) => ({
  ledger: { scheduledClans: async () => [clan] },
  state,
  now: () => Date.parse("2026-10-02T11:00:00Z"),
  manage: {
    evaluateOnSchedule: async () => ({}),
    mailActionsWaiting: async () => ({ mailed: 0 }),
    ...manage,
  },
  awards: { evaluateOnSchedule: async () => ({}) },
});
test("one clan per tick and completed or legacy same-day claims are preserved", async () => {
  let calls = 0;
  const config = settings({
    evaluateOnSchedule: async () => {
      calls++;
      return {};
    },
  });
  assert.equal((await evaluateClanTick(scratch.db, config)).due, 1);
  assert.equal((await state.get(`morning#${clan}`)).status, "completed");
  assert.equal((await evaluateClanTick(scratch.db, config)).due, 0);
  assert.equal(calls, 1);
  await state.put({ pk: `morning#${clan}`, day: "2026-10-02", at: "legacy" });
  assert.equal((await evaluateClanTick(scratch.db, config)).due, 0);
});
test("a failed evaluation is retryable; a completed private action is not reset", async () => {
  await assert.rejects(
    evaluateClanTick(
      scratch.db,
      settings({
        evaluateOnSchedule: async () => {
          throw new Error("temporary");
        },
      }),
    ),
    /clan_evaluation_retry/,
  );
  assert.equal((await state.get(`morning#${clan}`)).status, "retry");
  assert.equal((await evaluateClanTick(scratch.db, settings())).attempt, 2);
  assert.equal((await state.get(`morning#${clan}`)).status, "completed");
});
test("mail failures retry without marking the morning complete", async () => {
  await assert.rejects(
    evaluateClanTick(
      scratch.db,
      settings({ mailActionsWaiting: async () => ({ mail: { failed: 1 } }) }),
    ),
    /clan_evaluation_retry/,
  );
  assert.equal((await state.get(`morning#${clan}`)).status, "retry");
});
test("the morning uses the same normalized lock as web decisions and skips busy clans", async () => {
  const lock = `clan-state:${clan}`;
  await other.query("select pg_advisory_lock(hashtext($1))", [lock]);
  try {
    assert.equal((await evaluateClanTick(scratch.db, settings())).due, 0);
  } finally {
    await other.query("select pg_advisory_unlock(hashtext($1))", [lock]);
  }
  assert.equal((await evaluateClanTick(scratch.db, settings())).due, 1);
});

test("a failing first clan cannot starve another and retries are bounded", async () => {
  const second = "#P2LQ0";
  const visited = [];
  const config = settings({
    evaluateOnSchedule: async (tag) => {
      visited.push(tag);
      if (tag === clan) throw new Error("persistent");
      return {};
    },
  });
  config.ledger.scheduledClans = async () => [clan, second];
  await assert.rejects(
    evaluateClanTick(scratch.db, config),
    /clan_evaluation_retry/,
  );
  assert.equal((await evaluateClanTick(scratch.db, config)).due, 1);
  assert.deepEqual(visited, [clan, second]);
  for (let attempt = 0; attempt < 2; attempt++)
    await assert.rejects(
      evaluateClanTick(scratch.db, config),
      /clan_evaluation_retry/,
    );
  assert.equal((await evaluateClanTick(scratch.db, config)).due, 0);
  assert.equal((await state.get(`morning#${clan}`)).attempt, 3);
});
test("the existing usage expiry removes only expired model calls", async () => {
  await state.put({ pk: `model_call#${clan}#expired`, ttl: 1 });
  await state.put({ pk: `model_call#${clan}#active`, ttl: 9999999999 });
  await state.put({ pk: `policy#${clan}`, ttl: 1, version: 3 });
  assert.equal(await expireModelUses(scratch.db), 1);
  assert.equal(await state.get(`model_call#${clan}#expired`), null);
  assert.ok(await state.get(`model_call#${clan}#active`));
  assert.equal((await state.get(`policy#${clan}`)).version, 3);
});
