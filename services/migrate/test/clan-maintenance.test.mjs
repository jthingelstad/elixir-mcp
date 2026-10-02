import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import {
  createPostgresLedger,
  createPostgresStore,
} from "@elixir-mcp/clan-state/postgres";
import { clanMaintenance } from "../src/ops-clan-maintenance.mjs";
let scratch;
before(async () => {
  scratch = await scratchDb("clan_maintenance");
});
after(async () => scratch?.drop());
test("private queue reads are bounded, oldest first, and do not mark replies seen or return sealed keys", async () => {
  const ledger = createPostgresLedger(scratch.db);
  for (let n = 0; n < 4; n++)
    await ledger.putFeedback({
      feedback_id: `f${n}`,
      status: "new",
      created_at: `2026-09-0${n + 1}T00:00:00Z`,
      message: `private${n}`,
      response: n === 0 ? "a reply" : null,
      response_seen_at: null,
    });
  await ledger.saveModelKey("#P0LYQ", { sealed: "must-never-return" });
  const result = await clanMaintenance(scratch.url, {
    lane: "feedback",
    limit: 2,
  });
  assert.deepEqual(
    result.items.map((x) => x.feedback_id),
    ["f0", "f1"],
  );
  assert.equal(result.items[0].response_seen_at, null);
  assert.equal((await ledger.feedbackItem("f0")).response_seen_at, null);
  assert.equal(JSON.stringify(result).includes("must-never-return"), false);
});
test("a response previews by default, applies explicitly and refuses stale state", async () => {
  const read = () =>
    clanMaintenance(scratch.url, { lane: "feedback", feedback_id: "f0" });
  const spec = {
    lane: "respond",
    feedback_id: "f0",
    status: "done",
    response: "fixed",
    expected_sha256: (await read()).items[0].expected_sha256,
  };
  assert.equal((await clanMaintenance(scratch.url, spec)).applied, false);
  assert.equal((await read()).items[0].status, "new");
  const applied = await clanMaintenance(scratch.url, { ...spec, apply: true });
  assert.equal(applied.applied, true);
  assert.equal(
    applied.expected_sha256,
    (await read()).items[0].expected_sha256,
  );
  assert.equal((await read()).items[0].response_seen_at, null);
  await assert.rejects(
    clanMaintenance(scratch.url, { ...spec, apply: true }),
    /changed/,
  );
});
test("action review reconstructs missing history without writing it and stays inside one clan", async () => {
  const ledger = createPostgresLedger(scratch.db);
  await ledger.putCard("#P0LYQ", {
    card_id: "c1",
    type: "promote",
    status: "proposed",
    raised_at: "2026-09-01T00:00:00Z",
  });
  await ledger.putCard("#P2LQ0", {
    card_id: "other",
    type: "promote",
    status: "proposed",
    raised_at: "2026-09-01T00:00:00Z",
  });
  const result = await clanMaintenance(scratch.url, {
    lane: "actions",
    clan_tag: "POLYQ",
    limit: 1,
  });
  assert.equal(result.items[0].card.card_id, "c1");
  assert.equal(
    result.items[0].log.some((x) => x.kind === "raised"),
    true,
  );
  assert.deepEqual(
    await createPostgresStore(scratch.db).listByPrefix("#P0LYQ", "action_log#"),
    [],
  );
  for (const spec of [
    { lane: "model" },
    { lane: "actions", clan_tag: "bad" },
    { lane: "feedback", limit: 101 },
    { lane: "feedback", feedback_id: "model_key##P0LYQ" },
  ])
    await assert.rejects(clanMaintenance("invalid://never-connect", spec));
});

test("a stale web reader or decision cannot erase a committed maintenance response", async () => {
  const { createFeedbackService } =
    await import("@elixir-mcp/clan/feedback.mjs");
  const ledger = createPostgresLedger(scratch.db);
  for (const kind of ["seen", "decision"]) {
    const feedbackId = `race-${kind}`;
    await ledger.putFeedback({
      feedback_id: feedbackId,
      person_tag: "#P0LYQ",
      status: "planned",
      created_at: "2026-10-02T00:00:00Z",
      response: "old",
      response_seen_at: null,
    });
    let release;
    let read;
    const held = new Promise((r) => {
      release = r;
    });
    const ready = new Promise((r) => {
      read = r;
    });
    let first = true;
    const service = createFeedbackService({
      ledger: {
        ...ledger,
        async feedbackItem(id) {
          const item = await ledger.feedbackItem(id);
          if (first) {
            first = false;
            read();
            await held;
          }
          return item;
        },
      },
    });
    const pending =
      kind === "seen"
        ? service.item({ player_tag: "#P0LYQ" }, feedbackId)
        : service.decide({ maintainer: true }, feedbackId, {
            response: "stale decision",
          });
    // Attach a rejection handler before releasing the competing writer.
    const observed = pending.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await ready;
    const current = await clanMaintenance(scratch.url, {
      lane: "feedback",
      feedback_id: feedbackId,
    });
    await clanMaintenance(scratch.url, {
      lane: "respond",
      feedback_id: feedbackId,
      expected_sha256: current.items[0].expected_sha256,
      status: "done",
      response: "new response",
      shipped_in: "test-receipt",
      apply: true,
    });
    release();
    const result = await observed;
    if (kind === "seen") assert.equal(result.value.response, "new response");
    else assert.equal(result.error.code, "feedback_changed");
    const stored = await ledger.feedbackItem(feedbackId);
    assert.equal(stored.response, "new response");
    assert.equal(stored.status, "done");
    assert.equal(stored.shipped_in, "test-receipt");
    assert.equal(stored.response_seen_at, null);
  }
});

test("maintenance can traverse complete inventories and reads real grants and morning receipts", async () => {
  const ledger = createPostgresLedger(scratch.db);
  const store = createPostgresStore(scratch.db);
  for (let n = 0; n < 3; n++)
    await ledger.putCard("#P0LYQ", {
      card_id: `paged${n}`,
      type: "promote",
      raised_at: `2026-10-0${n + 1}T00:00:00Z`,
    });
  const ids = [];
  let cursor;
  do {
    const page = await clanMaintenance(scratch.url, {
      lane: "actions",
      clan_tag: "#P0LYQ",
      limit: 1,
      cursor,
    });
    ids.push(...page.items.map((x) => x.card.card_id));
    cursor = page.next_cursor;
    assert.equal(page.total, 4);
  } while (cursor);
  assert.equal(new Set(ids).size, 4);
  await store.put({
    pk: "award##P0LYQ#135#war##P2LQ0",
    gsi1pk: "clan##P0LYQ",
    gsi1sk: "award#135#war#1##P2LQ0",
    granted_at: "2026-10-02T00:00:00Z",
  });
  await store.put({
    pk: "morning##P0LYQ",
    day: "2026-10-02",
    completed: true,
    attempts: 1,
  });
  const grants = await clanMaintenance(scratch.url, {
    lane: "grants",
    clan_tag: "#P0LYQ",
  });
  assert.equal(grants.total, 1);
  assert.equal(grants.items[0].granted_at, "2026-10-02T00:00:00Z");
  const morning = await clanMaintenance(scratch.url, {
    lane: "morning",
    clan_tag: "#P0LYQ",
  });
  assert.equal(morning.receipt.completed, true);
  assert.equal(morning.receipt.attempts, 1);
});

test("action summaries stay small with a large legal comment inventory; full logs remain pageable", async () => {
  const store = createPostgresStore(scratch.db);
  for (let c = 0; c < 25; c++) {
    await createPostgresLedger(scratch.db).putCard("#P2LQ0", {
      card_id: `large${c}`,
      type: "promote",
      status: "proposed",
      raised_at: "2026-10-02T00:00:00Z",
    });
    for (let n = 0; n < 200; n++)
      await store.put({
        pk: `action_log##P2LQ0#large${c}#${n}`,
        gsi1pk: "clan##P2LQ0",
        gsi1sk: `action_log#large${c}#${String(n).padStart(3, "0")}`,
        kind: "comment",
        at: "2026-10-02T00:00:00Z",
        text: "x".repeat(1000),
      });
  }
  const summary = await clanMaintenance(scratch.url, {
    lane: "actions",
    clan_tag: "#P2LQ0",
    limit: 25,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 200000);
  assert.ok(summary.items.every((i) => i.log_limit === 3));
  const log = await clanMaintenance(scratch.url, {
    lane: "action_log",
    clan_tag: "#P2LQ0",
    card_id: "large0",
    limit: 100,
  });
  assert.equal(log.total, 200);
  assert.equal(log.items.length, 100);
  assert.ok(log.next_cursor);
});
