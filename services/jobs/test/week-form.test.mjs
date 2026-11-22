/**
 * The weekly week_form run (0311): its own payload, its own Monday
 * 16:15Z rule (the week closes at 10:00Z; the six-hour grace has passed
 * by 16:00Z), and a by-hand form that writes only a closed week whose
 * grace has passed. What it writes is tested with the reader
 * (packages/tools/test/timeline-week-form.test.mjs).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eventOps, handler } from "../src/index.mjs";
import { JOB_LIMITS } from "../src/db.mjs";
import { weekFormWeek } from "../src/week-form.mjs";
import { WEEK_FORM_GRACE_MS } from "@elixir-mcp/record/week-form-store";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_week_form_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const START = Date.parse("2026-11-09T10:00:00Z");
const END = Date.parse("2026-11-16T10:00:00Z");

before(async () => {
  await createScratch(NAME);
});

after(async () => {
  await dropScratch(NAME);
});

test("{week_form: true} is its own op with its own limits", () => {
  assert.deepEqual(eventOps({ week_form: true }), ["week_form"]);
  assert.ok(JOB_LIMITS.week_form);
});

test("{week_form: true} runs the latest due week and says so", async () => {
  process.env.DATABASE_URL = DB_URL;
  const result = await handler({ week_form: true });
  assert.equal(result.incomplete, false, JSON.stringify(result));
  assert.equal(typeof result.week_start, "string");
  assert.equal(result.players, 0, "a scratch database claims nobody");
});

test("by hand: only a Monday 10:00Z whose week and grace have passed", () => {
  const now = END + WEEK_FORM_GRACE_MS;
  assert.equal(weekFormWeek(null, now), START);
  assert.equal(
    weekFormWeek({ week_start: "2026-11-09T10:00:00Z" }, now),
    START,
  );
  assert.throws(
    () => weekFormWeek({ week_start: "2026-11-10T10:00:00Z" }, now),
    /Monday 10:00Z/,
  );
  assert.throws(
    () => weekFormWeek({ week_start: "2026-11-09T09:00:00Z" }, now),
    /Monday 10:00Z/,
  );
  assert.throws(
    () => weekFormWeek({ week_start: "2026-11-09T10:00:00Z" }, now - 1),
    /grace has not passed/,
  );
});

test("the Monday 16:15Z rule sends the run's payload, after the grace", () => {
  const template = readFileSync(
    path.join(repoRoot, "infra/template.yaml"),
    "utf8",
  );
  assert.match(
    template,
    /ScheduleExpression: cron\(15 16 \? \* MON \*\)\n\s+Targets:\n\s+- Arn: !GetAtt JobsFunction\.Arn\n\s+Id: week-form\n\s+Input: '\{"week_form": true\}'/,
  );
  // 16:15Z is after Monday 10:00Z plus the grace.
  assert.ok(10 * 60 + WEEK_FORM_GRACE_MS / 60_000 <= 16 * 60 + 15);
});
