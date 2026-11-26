import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

/**
 * 0320 moves the digest's one choice (0242's cadence beside the
 * tracking_report switch) onto three switches (Jamie, 2026-11-26):
 * Weekly (chosen or the default) is weekly + season on, daily off; Daily
 * is daily + season on, weekly off; Off is all three off. The rows it
 * writes keep the person's own via and changed_at, and a re-run writes
 * nothing new.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const FILE = path.join(repoRoot, "db/migrations/0320_three_digest_emails.sql");
const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_three_digests_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);

let db;
let sql;

before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
  sql = await readFile(FILE, "utf8");
});

after(async () => {
  await db.end();
  await dropScratch(SCRATCH);
});

async function person(name) {
  const { rows } = await db.query(
    `insert into account (email_hash, status) values ($1, 'approved')
     returning account_id`,
    [`three-digests-${name}`],
  );
  return rows[0].account_id;
}

/** A tracking_report row as 0242's code wrote it. */
async function digestRow(accountId, { enabled, cadence, via, at }) {
  await db.query(
    `insert into account_email_pref (account_id, kind, enabled, via, changed_at, cadence)
     values ($1, 'tracking_report', $2, $3, $4, $5)`,
    [accountId, enabled, via, at, cadence],
  );
}

async function apply() {
  await db.query("begin");
  try {
    await db.query(sql);
    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

async function prefs(accountId) {
  const { rows } = await db.query(
    `select kind, enabled, via, changed_at from account_email_pref
      where account_id = $1 order by kind`,
    [accountId],
  );
  return rows;
}

test("each old choice becomes its three switches, as the person made it", async () => {
  const at = new Date("2026-11-14T09:00:00Z");
  const untouched = await person("default");
  const weekly = await person("weekly");
  await digestRow(weekly, {
    enabled: true,
    cadence: "weekly",
    via: "profile",
    at,
  });
  const weeklyNull = await person("weekly-null");
  await digestRow(weeklyNull, {
    enabled: true,
    cadence: null,
    via: "ops",
    at,
  });
  const daily = await person("daily");
  await digestRow(daily, {
    enabled: true,
    cadence: "daily",
    via: "profile",
    at,
  });
  const off = await person("off");
  await digestRow(off, {
    enabled: false,
    cadence: null,
    via: "one_click",
    at,
  });
  const offDaily = await person("off-daily");
  await digestRow(offDaily, {
    enabled: false,
    cadence: "daily",
    via: "profile",
    at,
  });

  await apply();

  assert.deepEqual(await prefs(untouched), [], "the default stays no rows");
  for (const id of [weekly, weeklyNull]) {
    const rows = await prefs(id);
    assert.deepEqual(
      rows.map((r) => [r.kind, r.enabled]),
      [["tracking_report", true]],
      "weekly: daily and season keep their defaults (off, on)",
    );
  }
  const d = await prefs(daily);
  assert.deepEqual(
    d.map((r) => [r.kind, r.enabled, r.via]),
    [
      ["digest_daily", true, "profile"],
      ["tracking_report", false, "profile"],
    ],
    "daily: daily on, weekly off, season its default (on)",
  );
  for (const r of d) assert.equal(r.changed_at.toISOString(), at.toISOString());
  for (const [id, via] of [
    [off, "one_click"],
    [offDaily, "profile"],
  ]) {
    const rows = await prefs(id);
    assert.deepEqual(
      rows.map((r) => [r.kind, r.enabled, r.via]),
      [
        ["digest_daily", false, via],
        ["digest_season", false, via],
        ["tracking_report", false, via],
      ],
      "off: all three off",
    );
    for (const r of rows)
      assert.equal(r.changed_at.toISOString(), at.toISOString());
  }

  // A second run finds nothing to move.
  const before = await db.query(
    `select account_id, kind, enabled from account_email_pref order by 1, 2`,
  );
  await apply();
  const again = await db.query(
    `select account_id, kind, enabled from account_email_pref order by 1, 2`,
  );
  assert.deepEqual(again.rows, before.rows);
});
