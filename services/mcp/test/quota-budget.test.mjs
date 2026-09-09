/**
 * Whose budget a call spends (0053).
 *
 * An agent spends its OWNER's daily allowance — that is the trade that lets
 * every clan leader have one without a tier gate. Get this wrong in the
 * generous direction and agents are a free quota multiplier; get it wrong in
 * the strict direction and a member's agent is dead on arrival with its own
 * empty budget. Neither shows up until someone is already relying on it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { makeQuota } from "../src/quota.mjs";

const OWNER = "11111111-1111-1111-1111-111111111111";
const AGENT = "22222222-2222-2222-2222-222222222222";

function spyDb(count = 1) {
  const buckets = [];
  return {
    buckets,
    query: async (sql, params) => {
      if (sql.includes("from gateway")) return { rows: [{ points: 0 }] };
      if (sql.includes("insert into rate_limit")) {
        buckets.push(params[0]);
        return { rows: [{ count }] };
      }
      return { rows: [] };
    },
  };
}

test("an agent's calls come out of its owner's day, not its own", async () => {
  const db = spyDb();
  const spend = makeQuota({
    db,
    account: {
      accountId: AGENT,
      role: "leader",
      budget: { accountId: OWNER, role: "member", override: null },
    },
  });
  const result = await spend();
  assert.deepEqual(db.buckets, [`mcpday#${OWNER}`]);
  // And against the OWNER's ceiling: member is 500/day, not leader's 2000.
  assert.equal(result.max, 500);
});

test("an integration pays for itself, from its own key's quota", async () => {
  const db = spyDb();
  const spend = makeQuota({
    db,
    account: {
      accountId: AGENT,
      role: "partner",
      budget: { accountId: AGENT, role: "partner", override: 100 },
    },
  });
  const result = await spend();
  assert.deepEqual(db.buckets, [`mcpday#${AGENT}`]);
  assert.equal(result.max, 100, "the key's own ceiling, not the role default");
});

test("an account with no budget block behaves exactly as it did before", async () => {
  // Every pre-0053 shape, and every test that builds an account by hand.
  const db = spyDb();
  const spend = makeQuota({
    db,
    account: { accountId: OWNER, role: "member", mcpDailyQuota: null },
  });
  const result = await spend();
  assert.deepEqual(db.buckets, [`mcpday#${OWNER}`]);
  assert.equal(result.max, 500);
});

test("an agent owned by an admin still spends an unlimited day", async () => {
  // Not a loophole: it is the owner's budget, and the owner's budget is
  // unlimited. The agent's OWN tier caps what it may collect, which is the
  // axis that keeps a demo honest.
  const db = spyDb();
  const spend = makeQuota({
    db,
    account: {
      accountId: AGENT,
      role: "leader",
      budget: { accountId: OWNER, role: "admin", override: null },
    },
  });
  const result = await spend();
  assert.equal(result.allowed, true);
  assert.equal(result.max, Infinity);
  // Counted so meta.quota can report the spend honestly (feedback #17),
  // never refused: the owner's bucket, the owner's unlimited ceiling.
  assert.deepEqual(db.buckets, [`mcpday#${OWNER}`]);
  // The live lane is the OWNER's budget too, mirroring spendLiveQuota
  // exactly: an admin's agent has an unlimited live lane.
  assert.equal(result.live.max, Infinity);
});

test("over the ceiling is refused, and it is the owner's ceiling", async () => {
  const db = spyDb(501);
  const spend = makeQuota({
    db,
    account: {
      accountId: AGENT,
      role: "leader",
      budget: { accountId: OWNER, role: "member", override: null },
    },
  });
  const result = await spend();
  assert.equal(result.allowed, false);
  assert.equal(result.count, 501);
});

test("the meta.quota block satisfies the response contract, capped or not", async () => {
  const { quotaMeta } = await import("../src/quota.mjs");
  const { responseMeta } = await import("@elixir-mcp/contracts");
  const capped = quotaMeta({ count: 3, max: 500, live: { used: 1, max: 20 } });
  assert.deepEqual(capped.calls, { used: 3, max: 500, remaining: 497 });
  assert.deepEqual(capped.live, { used: 1, max: 20, remaining: 19 });
  assert.match(capped.resets_at, /T00:00:00\.000Z$/);
  const unlimited = quotaMeta({
    count: 9,
    max: Infinity,
    live: { used: 2, max: Infinity },
  });
  assert.deepEqual(unlimited.calls, { used: 9, max: null, remaining: null });
  assert.deepEqual(unlimited.live, { used: 2, max: null, remaining: null });
  for (const quota of [capped, unlimited])
    assert.doesNotThrow(() =>
      responseMeta({ as_of: new Date().toISOString(), quota }),
    );
});
