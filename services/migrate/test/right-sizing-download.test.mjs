import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { collectCensus } from "../../../infra/scripts/right-sizing-census.mjs";

const cutoff = "2026-10-02T00:00:00.000Z";
const snapshotId = "67458354-2679-4503-ae33-aefafdfb4026";
const state = () => ({
  version: 1,
  definition_sha256: "1".repeat(64),
  schema_sha256: "2".repeat(64),
  snapshot_id: snapshotId,
  cutoff,
  limit: 2,
  lanes: ["recording"],
  pages: {},
});
function fixture(spec, next, rows) {
  const bytes = Buffer.from(
    JSON.stringify({
      version: 1,
      ...spec,
      definition_sha256: "1".repeat(64),
      schema_sha256: "2".repeat(64),
      cutoff_policy: "timestamptz:created_at",
      snapshot_isolation: "per_page",
      next_after: next,
      rows,
    }),
  );
  const digest = createHash("sha256").update(bytes).digest("hex");
  return {
    bytes,
    receipt: {
      readonly: true,
      definition_sha256: "1".repeat(64),
      schema_sha256: "2".repeat(64),
      cutoff_policy: "timestamptz:created_at",
      snapshot_isolation: "per_page",
      lane: spec.lane,
      snapshot_id: snapshotId,
      cutoff,
      key: `right-sizing/v1/${snapshotId}/${spec.lane}/${digest}.json`,
      sha256: digest,
      bytes: bytes.length,
      rows: rows.length,
      next_after: next,
      done: next === null,
    },
  };
}
test("verified pages precede checkpoints and a completed private export resumes without invoking", async () => {
  const snapshot = state(),
    saved = [],
    requests = [],
    files = new Map();
  let current;
  const deps = {
    snapshot,
    invoke: async (spec) => {
      requests.push(spec);
      current = fixture(spec, spec.after === null ? "next" : null, [
        { recording_id: spec.after === null ? 1 : 2 },
      ]);
      return current.receipt;
    },
    download: async () => current.bytes,
    save: async (name, bytes) => {
      saved.push(name);
      files.set(name, bytes);
    },
    readSaved: async (name) => files.get(name),
  };
  const result = await collectCensus(deps);
  assert.equal(result.complete, true);
  assert.equal(result.lanes.recording.rows, 2);
  assert.deepEqual(
    requests.map((r) => r.after),
    [null, "next"],
  );
  assert.match(saved[0], /^recording-/);
  assert.equal(saved[1], "checkpoint.json");
  const resumed = await collectCensus({
    ...deps,
    invoke: () => {
      throw Error("unexpected invocation");
    },
  });
  assert.deepEqual(resumed, result);
});
test("a tampered private object cannot create a completion checkpoint", async () => {
  const snapshot = state();
  let current,
    saved = 0;
  await assert.rejects(
    collectCensus({
      snapshot,
      invoke: async (spec) => {
        current = fixture(spec, null, []);
        return current.receipt;
      },
      download: async () => Buffer.from("tampered"),
      save: async () => saved++,
    }),
    /digest differs/,
  );
  assert.equal(saved, 0);
  assert.equal(snapshot.pages.recording.length, 0);
});
test("cross-snapshot receipts and repeated cursors refuse rather than declare complete", async () => {
  let current;
  await assert.rejects(
    collectCensus({
      snapshot: state(),
      invoke: async (spec) => ({
        ...fixture(spec, null, []).receipt,
        snapshot_id: "wrong",
      }),
      download: async () => {
        throw Error("should not download");
      },
      save: async () => {},
    }),
    /invalid census receipt/,
  );
  await assert.rejects(
    collectCensus({
      snapshot: state(),
      invoke: async (spec) => {
        current = fixture(spec, "same", []);
        return current.receipt;
      },
      download: async () => current.bytes,
      save: async () => {},
    }),
    /cursor repeated/,
  );
});

test("resume refuses false terminal metadata, a corrupt chain and dropped lanes", async () => {
  const snapshot = state(),
    f = fixture(
      {
        lane: "recording",
        snapshot_id: snapshotId,
        cutoff,
        after: null,
        limit: 2,
      },
      "next",
      [{}],
    );
  snapshot.pages.recording = [{ ...f.receipt, done: true }];
  const deps = {
    snapshot,
    invoke: () => {
      throw Error("unexpected call");
    },
    readSaved: async () => f.bytes,
    download: () => {},
    save: () => {},
  };
  await assert.rejects(collectCensus(deps), /invalid census receipt/);
  snapshot.pages.recording = [{ ...f.receipt, next_after: null, done: true }];
  await assert.rejects(collectCensus(deps), /differs from receipt/);
  snapshot.pages.recording = [f.receipt];
  await assert.rejects(
    collectCensus({ ...deps, expectedLanes: ["recording", "claim"] }),
    /lane coverage/,
  );
});
test("an oversized page retries the same cursor at a smaller bounded limit", async () => {
  const snapshot = state(),
    requests = [];
  let current;
  const result = await collectCensus({
    snapshot,
    invoke: async (spec) => {
      requests.push(spec);
      if (spec.limit === 2)
        throw Object.assign(Error("large"), { code: "CENSUS_PAGE_TOO_LARGE" });
      current = fixture(spec, null, [{}]);
      return current.receipt;
    },
    download: async () => current.bytes,
    save: async () => {},
  });
  assert.equal(result.complete, true);
  assert.deepEqual(
    requests.map((r) => [r.after, r.limit]),
    [
      [null, 2],
      [null, 1],
    ],
  );
});
