import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerEmf, emitLedgerMetrics } from "../src/metrics.mjs";

const SAMPLE = {
  queued_bulk: 3,
  queued_live: 2,
  leased: 4,
  dead: 1,
  oldest_queued_s: 1800,
};

test("ledgerEmf carries the alarm's namespace, metric names, and no dimensions", () => {
  const emf = JSON.parse(ledgerEmf(SAMPLE, 1725600000000));
  const decl = emf._aws.CloudWatchMetrics[0];
  assert.equal(decl.Namespace, "ElixirMCP/Ledger");
  assert.deepEqual(
    decl.Dimensions,
    [[]],
    "no-dimension metrics, matching the alarms",
  );
  assert.deepEqual(
    decl.Metrics.map((m) => m.Name),
    [
      "OldestQueuedAgeSeconds",
      "DeadJobs",
      "QueuedJobs",
      "PlannedJobs",
      "LossBoundedJobs",
      "ReadCappedJobs",
    ],
  );
  assert.equal(emf.OldestQueuedAgeSeconds, 1800);
  assert.equal(emf.DeadJobs, 1);
  assert.equal(emf.QueuedJobs, 5, "queued = bulk + live");
  assert.equal(emf._aws.Timestamp, 1725600000000);
});

test("ledgerEmf is a single JSON line (EMF requires one object per log event)", () => {
  const line = ledgerEmf(SAMPLE, 1);
  assert.ok(!line.includes("\n"), "no embedded newlines");
  assert.doesNotThrow(() => JSON.parse(line));
});

test("ledgerEmf coalesces missing fields to zero", () => {
  const emf = JSON.parse(ledgerEmf({}, 1));
  assert.equal(emf.OldestQueuedAgeSeconds, 0);
  assert.equal(emf.DeadJobs, 0);
  assert.equal(emf.QueuedJobs, 0);
  assert.equal(emf.PlannedJobs, 0);
  assert.equal(emf.LossBoundedJobs, 0);
  assert.equal(emf.ReadCappedJobs, 0);
});

test("ledgerEmf carries the planner counters when the tick supplies them", () => {
  const emf = JSON.parse(
    ledgerEmf(SAMPLE, 1, { planned: 12, bounded: 3, read_capped: 1 }),
  );
  assert.equal(emf.PlannedJobs, 12);
  assert.equal(emf.LossBoundedJobs, 3);
  assert.equal(emf.ReadCappedJobs, 1);
});

test("emitLedgerMetrics writes one newline-terminated line and returns synchronously", () => {
  const lines = [];
  const ret = emitLedgerMetrics(SAMPLE, (l) => lines.push(l));
  assert.equal(ret, undefined, "synchronous: returns no awaitable promise");
  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith("\n"));
  assert.doesNotThrow(() => JSON.parse(lines[0].trimEnd()));
});
