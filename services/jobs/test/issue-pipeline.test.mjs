import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acceptIssue } from "../src/email/issue-pipeline.mjs";

test("retired acceptance cannot archive an answer or hand it to delivery", async () => {
  const fail = () => {
    throw new Error("retired acceptance performed IO");
  };
  for (const kind of ["top_100", "card_of_week"]) {
    const result = await acceptIssue({
      kind,
      db: { query: fail },
      read: fail,
      enqueue: fail,
    });
    assert.equal(result.skipped, "retired");
  }
});
test("no editorial generation or delivery schedules remain", () => {
  const template = readFileSync(
    new URL("../../../infra/template.yaml", import.meta.url),
    "utf8",
  );
  for (const prefix of ["EmailTop100", "EmailCardOfWeek"])
    assert.equal(template.includes(prefix), false);
});
