/**
 * The visibility-map guard (2026-11-13), on scratch databases:
 * {visibility_check} names a table never analyzed and a table whose map
 * VACUUM FULL emptied, and stops naming it after {vacuum}; {vacuum}
 * takes any ordinary public table from the catalog and nothing else;
 * {rewrite_table} ends with a plain vacuum; and the ladder vacuums what
 * a migration declares after its commit, inside its deadline, without
 * ever failing for it.
 *
 * The probe tables turn autovacuum off, so the local server's own
 * autovacuum cannot mark their maps between two reads.
 *
 * VACUUM marks a page all-visible only when its rows are older than
 * every snapshot another backend in the database holds, and on a shared
 * local server such a snapshot comes and goes as it likes (the server's
 * autovacuum analyzing the freshly cloned scratch database, its xmin
 * held old by other runs' transactions). Waiting for a quiet moment
 * (#979, and a 15 s wait on 2026-11-14) still raced it. So the probe's
 * rows are written frozen (COPY ... FREEZE into the table made in the
 * same transaction), which VACUUM FULL keeps: they are visible to every
 * snapshot, the map {vacuum} sets does not depend on who else is
 * connected, and the test holds an old snapshot open through the op to
 * prove it (2026-11-17). The ladder's own test asserts what the ladder
 * does (it ran VACUUM (ANALYZE) on the declared table after the commit),
 * and leaves the map to this one.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { migrate } from "../src/migrate.mjs";
import { vacuum } from "../src/ops-diagnostics.mjs";
import { rewriteTable } from "../src/deck-backfill.mjs";
import {
  visibilityCheck,
  VISIBILITY_FLOOR_PAGES,
  VISIBILITY_MIN_SHARE,
} from "../src/vacuum.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const SCRATCH = `elixir_mcp_test_vacuum_${process.pid}`;
const SCRATCH_URL = ADMIN_URL.replace(/\/postgres$/, `/${SCRATCH}`);
const BARE = `elixir_mcp_test_vacuum_ladder_${process.pid}`;
const BARE_URL = ADMIN_URL.replace(/\/postgres$/, `/${BARE}`);

// About 885 heap pages: over the 500-page floor.
const PROBE_ROWS = 200_000;

let db;
before(async () => {
  await createScratch(SCRATCH);
  db = new pg.Client({ connectionString: SCRATCH_URL });
  await db.connect();
});

after(async () => {
  await db?.end();
  await dropScratch(SCRATCH);
});

/** What {vacuum} promises: the map whole enough that the check no longer
 *  names the table. Not every page: a plain VACUUM that cannot take a
 *  page's cleanup lock (the checkpointer flushing it while other runs
 *  clone databases) leaves that page's bit unset, and one page of 885 was
 *  (#979). */
function wholeEnough(after, what) {
  assert.ok(
    after.relallvisible >= after.relpages * VISIBILITY_MIN_SHARE,
    `${what}: ${after.relallvisible} of ${after.relpages} pages all-visible`,
  );
}

/** Write PROBE_ROWS frozen rows into a new probe table, in one
 *  transaction: COPY FREEZE needs the table made in it. */
async function frozenProbe(table) {
  await db.query("begin");
  try {
    await db.query(
      `create table ${table} (id int primary key, v int) with (autovacuum_enabled = false)`,
    );
    await db.query(
      `copy ${table} from program 'awk ''BEGIN { for (i = 1; i <= ${PROBE_ROWS}; i++) print i "," i }''' with (format csv, freeze)`,
    );
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

const flagged = async (table) =>
  (await visibilityCheck(SCRATCH_URL)).flagged.find((t) => t.table === table);

test("the thresholds are the documented ones", () => {
  assert.equal(VISIBILITY_FLOOR_PAGES, 500);
  assert.equal(VISIBILITY_MIN_SHARE, 0.5);
});

test("the check names a table never analyzed, then one VACUUM FULL emptied, and neither after {vacuum}", async (t) => {
  // An old snapshot, held from before the rows to after {vacuum}: what
  // a busy server's other backends do. Frozen rows are visible to it.
  const holder = new pg.Client({ connectionString: SCRATCH_URL });
  await holder.connect();
  t.after(() => holder.end());
  await holder.query("begin isolation level repeatable read");
  await holder.query("select 1");
  await frozenProbe("vm_probe");

  const fresh = await flagged("vm_probe");
  assert.equal(fresh?.reason, "never_analyzed");
  assert.ok(fresh.pages >= VISIBILITY_FLOOR_PAGES, `pages ${fresh.pages}`);
  assert.equal(fresh.payload, '{"vacuum":{"table":"vm_probe"}}');
  assert.equal(
    fresh.command,
    `npm run op -- '{"vacuum":{"table":"vm_probe"}}'`,
  );

  // The 2026-11-13 trap: a rewrite leaves statistics and no map.
  await db.query("vacuum (full, analyze) vm_probe");
  const rewritten = await flagged("vm_probe");
  assert.equal(rewritten?.reason, "visibility_map");
  assert.equal(rewritten.all_visible_pages, 0);
  assert.equal(rewritten.all_visible_pct, 0);

  const out = await vacuum(SCRATCH_URL, { table: "vm_probe" });
  assert.equal(out.error, undefined, out.message);
  assert.equal(out.before.relallvisible, 0);
  wholeEnough(out.after, "vm_probe");
  assert.ok(out.after.relallvisible > 0);
  assert.equal(await flagged("vm_probe"), undefined);
  await holder.query("commit");
});

test("the check is read-only and leaves small tables out", async () => {
  await db.query(
    `create table vm_small (id int) with (autovacuum_enabled = false)`,
  );
  await db.query(`insert into vm_small select generate_series(1, 100)`);
  const answer = await visibilityCheck(SCRATCH_URL);
  assert.ok(answer.checked > 50, `checked ${answer.checked}`);
  assert.equal(
    answer.flagged.find((t) => t.table === "vm_small"),
    undefined,
  );
  const { rows } = await db.query(
    "select reltuples from pg_class where relname = 'vm_small'",
  );
  assert.equal(Number(rows[0].reltuples), -1, "the check analyzed nothing");
});

test("{vacuum} takes any ordinary public table and refuses every other name", async () => {
  for (const table of ["job", "battle", "admitted_read_day", "player"]) {
    const out = await vacuum(SCRATCH_URL, { table });
    assert.equal(out.error, undefined, `${table}: ${out.message}`);
    assert.ok(out.after, table);
  }
  for (const table of [
    "",
    "no_such_table",
    "pg_class",
    "battle; drop table battle",
    'battle"',
    "Battle",
    "battle_participant_player_time_cover",
  ]) {
    const out = await vacuum(SCRATCH_URL, { table });
    assert.equal(out.error, "unknown_table", JSON.stringify(table));
  }
  const { rows } = await db.query(
    "select to_regclass('battle') is not null as here",
  );
  assert.equal(rows[0].here, true);
});

test("{rewrite_table} ends with a plain vacuum, so the map it emptied is whole again", async () => {
  const out = await rewriteTable(SCRATCH_URL, { table: "job" });
  assert.equal(out.error, undefined, out.message);
  assert.equal(out.vacuumed?.error, undefined, out.vacuumed?.message);
  assert.equal(out.vacuumed.table, "job");
  wholeEnough(out.vacuumed.after, "job");
});

async function ladder(files, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vacuum-after-"));
  try {
    for (const [name, sql] of Object.entries(files))
      await writeFile(path.join(dir, name), sql);
    const logs = [];
    const result = await migrate({
      databaseUrl: BARE_URL,
      migrationsDir: dir,
      log: (m) => logs.push(m),
      ...options,
    });
    return { result, logs };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the ladder vacuums what a migration declares, after the commit, and never fails for it", async (t) => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`create database ${BARE}`);
  } finally {
    await admin.end();
  }
  t.after(async () => {
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    try {
      await a.query(`drop database if exists ${BARE} with (force)`);
    } finally {
      await a.end();
    }
  });

  const fill = `-- 0001: a probe.\n-- vacuum after: probe\ncreate table probe (id int primary key, v int) with (autovacuum_enabled = false);\ninsert into probe select g, g from generate_series(1, ${PROBE_ROWS}) g;\n`;
  const first = await ladder({ "0001_probe.sql": fill });
  assert.equal(first.result.ran, 1);
  assert.equal(first.result.vacuumed.length, 1);
  const [v] = first.result.vacuumed;
  assert.equal(v.table, "probe");
  assert.equal(v.error, undefined, v.message);
  // Its VACUUM (ANALYZE) ran, after the commit: the table had no
  // statistics before it and has its pages and rows after. Whether the
  // map is whole is the server's horizon, which the {vacuum} test pins.
  assert.equal(Number(v.before.reltuples), -1);
  assert.ok(v.after.relpages >= VISIBILITY_FLOOR_PAGES);
  assert.ok(v.after.reltuples > 0);
  assert.ok(first.logs.some((l) => l.startsWith("vacuum after: ")));

  // Nothing pending: nothing vacuumed, and the answer keeps its old shape.
  const again = await ladder({ "0001_probe.sql": fill });
  assert.deepEqual(again.result, { applied: 1, ran: 0 });

  // A deadline already spent: the migration applies, the vacuum is
  // reported with the op that finishes it.
  const late = await ladder(
    {
      "0001_probe.sql": fill,
      "0002_more.sql":
        "-- vacuum after: probe\nupdate probe set v = v + 1 where id <= 1000;\n",
    },
    { vacuumDeadline: Date.now() - 1 },
  );
  assert.equal(late.result.ran, 1);
  assert.deepEqual(late.result.vacuumed, [
    {
      table: "probe",
      skipped: "deadline",
      command: `npm run op -- '{"vacuum":{"table":"probe"}}'`,
    },
  ]);

  // A declared table a later file dropped is an answer, not a failure.
  const gone = await ladder({
    "0001_probe.sql": fill,
    "0002_more.sql":
      "-- vacuum after: probe\nupdate probe set v = v + 1 where id <= 1000;\n",
    "0003_gone.sql": "-- vacuum after: probe\ndrop table probe;\n",
  });
  assert.equal(gone.result.ran, 1);
  assert.equal(gone.result.vacuumed[0].error, "unknown_table");
});
