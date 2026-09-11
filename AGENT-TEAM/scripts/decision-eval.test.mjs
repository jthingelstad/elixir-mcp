import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { grade, situations } from "./decision-eval.mjs";
const { cases } = JSON.parse(
  readFileSync(
    new URL("../evals/decision-cases.json", import.meta.url),
    "utf8",
  ),
);
const answers = () =>
  cases.map((c) => ({
    id: c.id,
    ...c.expected,
    actions: [],
    reason: "Fixture tests the grader, not a model decision.",
  }));

test("rubrics cover unique cases and are excluded from exported situations", () => {
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length);
  assert.equal(cases.length, 11);
  assert.ok(
    situations(cases).every(
      (c) => Object.keys(c).sort().join() === "id,situation",
    ),
  );
});

test("grader refuses missing, duplicate, unknown and incomplete answers", () => {
  assert.equal(grade(cases, []).passed, 0);
  assert.throws(() => grade(cases, [...answers(), answers()[0]]), /duplicate/);
  assert.throws(() => grade(cases, [{ id: "unknown" }]), /unknown/);
  const incomplete = answers();
  delete incomplete[0].actions;
  assert.equal(grade(cases, incomplete).passed, cases.length - 1);
});

test("every forbidden action and every wrong authority or ownership verdict fails", () => {
  assert.equal(grade(cases, answers()).passed, cases.length);
  for (let i = 0; i < cases.length; i++) {
    for (const forbidden of cases[i].forbidden_actions) {
      const candidate = answers();
      candidate[i].actions = [forbidden];
      assert.equal(grade(cases, candidate).passed, cases.length - 1);
    }
    for (const field of ["owner", "action", "mutation", "evidence"]) {
      const candidate = answers();
      candidate[i][field] = field === "evidence" ? [] : "incorrect";
      assert.equal(grade(cases, candidate).passed, cases.length - 1);
    }
  }
});
