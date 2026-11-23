/**
 * The stock comments (comment-check.mjs, 2026-11-23): an exact match
 * after case, spacing and end punctuation posts without the model; the
 * cap still pauses it, a post never takes the shortcut, and emoji or any
 * other words still go to the model. A fake database: no PostgreSQL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkComment,
  isStockComment,
  STOCK_COMMENTS,
} from "../src/comment-check.mjs";
import { tidyComment } from "../src/comment-filter.mjs";

/** Records each insert; the month's spend is nothing. */
function fakeDb() {
  const logged = [];
  return {
    logged,
    async query(sql, params) {
      if (/insert into comment_check/.test(sql)) {
        logged.push({ verdict: params[2], stage: params[3], cat: params[4] });
        return { rows: [] };
      }
      return { rows: [{ usd: "0" }] };
    },
  };
}

function fakeModel() {
  const asked = [];
  const moderate = async (input) => {
    asked.push(input);
    return {
      ok: true,
      model: "claude-haiku-5-5",
      input: { allow: true, category: "none" },
      usage: { input_tokens: 900, output_tokens: 12 },
    };
  };
  return { asked, moderate };
}

const check = (db, moderate, raw, extra = {}) =>
  checkComment(db, {
    moderate,
    capUsd: 10,
    accountId: "a",
    itemId: "tl_1",
    body: tidyComment(raw),
    ...extra,
  });

test("the list is short, and matching forgives only case, spacing and end punctuation", () => {
  assert.ok(STOCK_COMMENTS.size <= 12, "keep the list short");
  for (const yes of [
    "gg",
    "GG",
    "ggs",
    "gg  wp",
    "GG WP!!",
    "wp.",
    "Nice!",
    "well played ",
    "good game?!",
  ])
    assert.equal(isStockComment(tidyComment(yes)), true, yes);
  for (const no of [
    "",
    "gg ez",
    "g g",
    "gg, wp",
    "gg 👍",
    "👍",
    "🔥🔥",
    "nice try loser",
    "not nice",
    "gg!wp",
  ])
    assert.equal(isStockComment(tidyComment(no)), false, no);
});

test("a stock comment skips the model and is logged as the filter's pass", async () => {
  const db = fakeDb();
  const { asked, moderate } = fakeModel();
  assert.deepEqual(await check(db, moderate, "GG wp!"), { verdict: "allow" });
  assert.equal(asked.length, 0, "the model was not asked");
  assert.deepEqual(db.logged, [
    { verdict: "allow", stage: "filter", cat: "stock" },
  ]);
});

test("emoji, other words and posts still go to the model", async () => {
  const db = fakeDb();
  const { asked, moderate } = fakeModel();
  await check(db, moderate, "🔥🔥");
  await check(db, moderate, "gg ez");
  await check(db, moderate, "gg", { post: { question: false } });
  assert.equal(asked.length, 3);
  assert.deepEqual(
    db.logged.map((r) => r.stage),
    ["model", "model", "model"],
  );
});

test("at the cap a stock comment pauses like any other", async () => {
  const db = fakeDb();
  const { asked, moderate } = fakeModel();
  assert.deepEqual(await check(db, moderate, "gg", { capUsd: 0 }), {
    verdict: "paused",
  });
  assert.equal(asked.length, 0);
});

test("a pass that lands after writeBy answers error, so nothing is written", async () => {
  const db = fakeDb();
  const { moderate } = fakeModel();
  assert.deepEqual(
    await check(db, moderate, "that Hog cycle was clean", {
      writeBy: Date.now() - 1,
    }),
    { verdict: "error" },
  );
  assert.deepEqual(db.logged, [
    { verdict: "error", stage: "model", cat: "late" },
  ]);
});
