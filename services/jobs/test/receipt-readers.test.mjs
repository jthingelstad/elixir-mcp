/**
 * No long reader of receipts. api_receipt is an operational log kept 28
 * days (Jamie, 2026-11-13: "Operational logs i would keep for 28 days";
 * packages/record/src/retention.mjs), so a reader that needs a read older
 * than that reads a fact kept for it (0259's read facts,
 * packages/record/src/read-facts.mjs), never a receipt.
 *
 * Every source file that names api_receipt is pinned here with how many
 * times it does and why each read stays inside 28 days (a recent window,
 * the latest read, a freshness probe) or is not a reader at all. A new
 * file that names it, or a new mention in a pinned one, fails until it
 * is listed with its reason; a file that drops one fails until its count
 * here follows. Tests are not scanned: they seed and read their own
 * scratch receipts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const PINNED = {
  "packages/ingest/src/admission.mjs": [
    1,
    "a comment on how a rejection is charged; no query",
  ],
  "packages/ingest/src/pipeline.mjs": [
    3,
    "the writer: inserts the receipt and stamps its own row",
  ],
  "packages/ledger/src/ledger.mjs": [1, "fetches in the last hour"],
  "packages/record/src/read-facts.mjs": [
    11,
    "the backfill and check of the read facts, over the receipts still held",
  ],
  "packages/record/src/retention.mjs": [6, "the trim itself"],
  "packages/tools/src/live.mjs": [
    2,
    "a fresh receipt inside the endpoint's max age, and whether one landed in the last day",
  ],
  "packages/tools/src/public-stats.mjs": [
    5,
    "the public fetch series: by design it covers the receipts held, and recounts in full when the trim deletes",
  ],
  "packages/tools/src/public-status.mjs": [
    6,
    "the status page's hour and day counts and the newest fetch",
  ],
  "packages/tools/src/tools/war/common.mjs": [
    1,
    "the latest race read, which matters only minutes after a season roll",
  ],
  "services/jobs/src/efficiency.mjs": [
    1,
    "one closed UTC day, yesterday's, into capture_efficiency_daily",
  ],
  "services/jobs/src/email/build-collector.mjs": [
    5,
    "the collector mail's week",
  ],
  "services/migrate/src/deck-backfill.mjs": [
    1,
    "a table name in the rewrite op's closed list; no query",
  ],
  "services/migrate/src/ops-analysis.mjs": [1, "the last `hours` of receipts"],
  "services/migrate/src/ops-diagnostics.mjs": [
    12,
    "operator diagnostics: counts by endpoint, the last 48 hours, a subject's receipts held, job dedupe, the endpoint census",
  ],
  "services/migrate/src/ops-funnel.mjs": [
    1,
    "an operator funnel's first profile read, beside the first battle stored; past 28 days the battle alone answers",
  ],
  "services/migrate/src/ops-series.mjs": [
    2,
    "the last `hours` of receipts and the last day's roster-written moments",
  ],
  "services/web-api/src/efficiency.mjs": [
    2,
    "today and the last hour; closed days read capture_efficiency_daily",
  ],
  "services/web-api/src/routes/account.mjs": [
    1,
    "fetches in the last 24 hours",
  ],
  "services/web-api/src/routes/admin.mjs": [2, "the last 24 hours"],
  "services/web-api/src/routes/gateways.mjs": [
    6,
    "a collector's last hour, day, week and 30 days (the receipts held cover the last 28)",
  ],
  "services/web-api/src/routes/verify.mjs": [
    2,
    "the latest battle-log read for a challenge minutes old",
  ],
};

const CODE = /\.(m?js|jsx|ts|tsx)$/;
const SKIP = new Set(["node_modules", "dist"]);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (CODE.test(e.name)) yield p;
  }
}

function mentions() {
  const found = {};
  for (const top of ["packages", "services", "apps"])
    for (const ws of readdirSync(path.join(ROOT, top))) {
      const src = path.join(ROOT, top, ws, "src");
      if (!existsSync(src)) continue;
      for (const file of walk(src)) {
        const n = (readFileSync(file, "utf8").match(/\bapi_receipt\b/g) ?? [])
          .length;
        if (n) found[path.relative(ROOT, file)] = n;
      }
    }
  return found;
}

test("every source file that names api_receipt is pinned with its reason", () => {
  const found = mentions();
  assert.ok(
    found["packages/ingest/src/pipeline.mjs"],
    "the scan found no receipt writer: the layout changed, so change this test with it",
  );
  const unlisted = Object.keys(found).filter((f) => !(f in PINNED));
  assert.deepEqual(
    unlisted,
    [],
    "a new file reads api_receipt: receipts are kept 28 days, so a reader that looks further back reads a fact of its own (packages/record/src/read-facts.mjs); a bounded one is pinned here with its reason",
  );
  const moved = Object.entries(PINNED)
    .filter(([f, [n]]) => found[f] !== n)
    .map(([f, [n]]) => `${f}: pinned ${n}, found ${found[f] ?? 0}`);
  assert.deepEqual(
    moved,
    [],
    "a pinned file names api_receipt a different number of times: say how far back the new read looks, or lower the pin",
  );
});

test("the year-long readers read the read facts, not receipts", () => {
  for (const file of [
    "packages/record/src/participation-sql.mjs",
    "packages/record/src/war-membership.mjs",
    "packages/tools/src/tools/game-events.mjs",
    "packages/tools/src/activity/entries.mjs",
  ]) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(text, /\bapi_receipt\b/, file);
  }
});
