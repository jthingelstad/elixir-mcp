import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestEmf } from "../src/ingest-emf.mjs";

test("ingestEmf: one undimensioned line per submission, the outcome as 0/1 counters, facts and wall time", () => {
  const line = ingestEmf(
    {
      outcome: "admitted",
      endpoint: "clan",
      projection: { facts: 53 },
      timings: { total_ms: 164 },
    },
    1758100000000,
  );
  assert.ok(!line.includes("\n"), "a single JSON line");
  const emf = JSON.parse(line);
  const decl = emf._aws.CloudWatchMetrics[0];
  assert.equal(decl.Namespace, "ElixirMCP/Ingest");
  assert.deepEqual(decl.Dimensions, [[]]);
  assert.deepEqual(
    decl.Metrics.map((m) => m.Name),
    ["Admitted", "Rejected", "Duplicate", "NewFacts", "IngestMs"],
  );
  assert.equal(emf.Admitted, 1);
  assert.equal(emf.Rejected, 0);
  assert.equal(emf.NewFacts, 53);
  assert.equal(emf.IngestMs, 164);
  assert.equal(
    emf.endpoint,
    "clan",
    "the endpoint rides as a field for Logs Insights, not a dimension",
  );
});

test("ingestEmf: a rejection and a duplicate count as themselves and are worth nothing", () => {
  const rejected = JSON.parse(
    ingestEmf({ outcome: "rejected", errors: ["tag:invalid"] }),
  );
  assert.equal(rejected.Rejected, 1);
  assert.equal(rejected.Admitted, 0);
  assert.equal(rejected.NewFacts, 0);
  const dup = JSON.parse(ingestEmf({ outcome: "duplicate", timings: {} }));
  assert.equal(dup.Duplicate, 1);
  assert.equal(dup.IngestMs, 0);
});
