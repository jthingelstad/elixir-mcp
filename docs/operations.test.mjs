/**
 * docs/OPERATIONS.md is cited by section name from outside this
 * repository (the domain team's runbooks), so its `##` headings are a
 * contract: renaming or reordering one breaks those pointers silently.
 * This pins them, and the few facts the runbooks rely on it to carry.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const operations = readFileSync(
  new URL("./OPERATIONS.md", import.meta.url),
  "utf8",
);

test("OPERATIONS.md keeps its sections, in order", () => {
  assert.deepEqual(
    [...operations.matchAll(/^## (.+)$/gm)].map((match) => match[1]),
    [
      "Pipeline health",
      "Dead letters and dead jobs",
      "Collector fleet",
      "Feedback",
      "Record truth",
      "Security sweep",
      "Incident authority",
      "Clan maintenance",
      "Restore rehearsal",
    ],
  );
});

test("OPERATIONS.md carries the rules the runbooks point at", () => {
  assert.match(operations, /Never run `\{probe: true\}` routinely/);
  assert.match(operations, /55-80% is normal/);
  assert.match(operations, /EBSByteBalance%/);
  assert.match(operations, /\(RELEASING-COLLECTOR\.md\)/);
  assert.match(operations, /compare-and-set/);
  assert.match(operations, /Vacuum after a large rewrite/);
  for (const op of ["terminate_backends", "gateway_drain", "gateway_recover"])
    assert.match(operations, new RegExp(`\\{${op}\\}`));
  // Writes go through the wrapper that takes the production lock.
  assert.match(operations, /npm run op/);
  assert.doesNotMatch(operations, /aws lambda invoke --/);
});

test("OPERATIONS.md holds facts, not the team", () => {
  assert.doesNotMatch(
    operations,
    /Elixir Operator|Data Auditor|Feedback Manager|Security Reviewer|AGENT-TEAM|objective-lease/,
  );
});
