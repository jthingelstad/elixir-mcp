#!/usr/bin/env node
/**
 * Drive the archive backfill ({series_backfill}, time-series review
 * Part 5) to completion: invoke the migrate Lambda for one lane, read
 * `done`, repeat. The Lambda's reserved concurrency is one, so a deploy
 * during the run waits (429) - run this to the end first.
 *
 *   AWS_PROFILE=jamie node infra/scripts/series-backfill.mjs --lane clan
 *   AWS_PROFILE=jamie node infra/scripts/series-backfill.mjs --lane player --budget 240 --batch 200
 *
 * Prints one line per invocation (receipts, rows, objects read, cache
 * hits, misses, remaining, ms) and a summary at the end. Exits non-zero
 * on a Lambda error; the cursor is in series_backfill_state, so a rerun
 * resumes.
 */

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const lane = flag("lane", null);
if (!["clan", "player", "race", "battle"].includes(lane)) {
  console.error(
    "usage: series-backfill.mjs --lane <clan|player|race|battle> [--budget 240] [--batch 200]",
  );
  process.exit(2);
}
const budget = Number(flag("budget", 240));
const batch = Number(flag("batch", 50));
const lambda = new LambdaClient({});

const started = Date.now();
const totals = {
  invocations: 0,
  receipts: 0,
  rows: 0,
  objects: 0,
  hits: 0,
  missing: 0,
  unreadable: 0,
  unresolved: 0,
};
for (;;) {
  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: "elixir-mcp-migrate",
      Payload: JSON.stringify({
        series_backfill: { lane, budget_s: budget, batch },
      }),
    }),
  );
  const body = JSON.parse(Buffer.from(res.Payload).toString() || "null");
  if (res.FunctionError) {
    console.error(
      `invoke failed: ${res.FunctionError} ${JSON.stringify(body).slice(0, 800)}`,
    );
    process.exit(1);
  }
  totals.invocations += 1;
  totals.receipts += body.receipts;
  totals.rows += body.rows_written;
  totals.objects += body.objects_read;
  totals.hits += body.cache_hits;
  totals.missing += body.missing_objects;
  totals.unreadable += body.unreadable;
  totals.unresolved += body.unresolved_season ?? 0;
  totals.deadlocks += body.deadlock_retries ?? 0;
  console.log(
    `${new Date().toISOString()} ${lane} #${totals.invocations} receipts ${body.receipts} rows ${body.rows_written} ` +
      `objects ${body.objects_read} hits ${body.cache_hits} missing ${body.missing_objects} unreadable ${body.unreadable} ` +
      `unresolved ${body.unresolved_season ?? 0} deadlocks ${body.deadlock_retries ?? 0} remaining ${body.remaining} ${body.ms} ms` +
      (body.done ? " DONE" : ""),
  );
  if (body.done) break;
}
console.log(
  `${lane}: ${totals.invocations} invocations, ${totals.receipts} receipts, ${totals.rows} rows, ` +
    `${totals.objects} objects read, ${totals.hits} cache hits, ${totals.missing} missing, ` +
    `${totals.unreadable} unreadable, ${totals.unresolved} unresolved, ${totals.deadlocks} deadlock retries, ${Math.round((Date.now() - started) / 1000)} s wall`,
);
