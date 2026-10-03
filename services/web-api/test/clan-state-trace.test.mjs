import test from "node:test";
import assert from "node:assert/strict";
import { createTracedClanStore } from "../src/clan.mjs";
import { current, summarize, withTrace } from "@elixir-mcp/clan/trace.mjs";

test("PostgreSQL state tracing counts logical fallback and failed operations without stored data", async () => {
  const privateKey = "private-key-fixture",
    privateWords = "private-words-fixture";
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith("delete")) throw new Error("private-db-error-fixture");
      return {
        rows: sql.startsWith("select")
          ? [{ body: { pk: privateKey, words: privateWords } }]
          : [],
      };
    },
  };
  const state = createTracedClanStore(db);
  await withTrace({ http: "fixture" }, async () => {
    assert.equal(
      (await state.putIfAbsent({ pk: privateKey, words: privateWords })).words,
      privateWords,
    );
    await state.get(privateKey);
    await assert.rejects(state.remove(privateKey), /private-db-error-fixture/);
    const summary = summarize(current(), 500);
    assert.equal(queries.length, 4);
    assert.equal(
      summary.store_ops,
      3,
      "fallback SQL is inside one logical operation",
    );
    assert.deepEqual(
      summary.store.map(({ op, count }) => ({ op, count })),
      [
        { op: "clan_state.putIfAbsent", count: 1 },
        { op: "clan_state.get", count: 1 },
        { op: "clan_state.remove", count: 1 },
      ],
    );
    assert.ok(summary.store.every((op) => op.ms >= 0 && op.max_ms >= 0));
    for (const sensitive of [
      privateKey,
      privateWords,
      "private-db-error-fixture",
      "select body",
      "delete from",
    ])
      assert.ok(!JSON.stringify(summary).includes(sensitive), sensitive);
  });
});
