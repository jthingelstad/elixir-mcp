import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { migrate, loadMigrations } from "../src/migrate.mjs";
import { membershipBaselineCensus } from "../src/ops-diagnostics.mjs";

/**
 * 0208 (Jamie, 2026-10-08: "Approved: mark the 35 first-read membership
 * rows as baseline in elixir production"): on a database built through
 * 0207, exactly the rows the census counts (opened on their clan's first
 * membership observation, not yet baseline) become baseline. A join
 * observed later, a row already baseline and other clans' rows are left
 * as they were; nothing is deleted; a second run changes nothing; and the
 * census afterwards reads zero first-read rows and names what 0208 marked.
 */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATION = "0208_membership_first_read_baseline.sql";
const sql = await readFile(
  path.join(repoRoot, "db/migrations", MIGRATION),
  "utf8",
);
const adminUrl =
  process.env.PG_ADMIN_URL ??
  `postgres://${os.userInfo().username}@localhost:5432/postgres`;

async function databaseThrough0207() {
  const name = `elixir_mcp_test_first_read_baseline_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "elixir-pre-0208-"));
  try {
    for (const m of await loadMigrations(path.join(repoRoot, "db/migrations")))
      if (m.id < 208)
        await cp(
          path.join(repoRoot, "db/migrations", m.name),
          path.join(dir, m.name),
        );
    await migrate({ databaseUrl: url, migrationsDir: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  return {
    db,
    url,
    async drop() {
      await db.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`drop database ${name} with (force)`);
      await a.end();
    },
  };
}

test("0208 marks exactly the census's first-read rows baseline, and nothing else", async () => {
  const { db, url, drop } = await databaseThrough0207();
  try {
    // Every row here predates 0207's applied_at (now), as production's do,
    // except the one a post-0207 read opened.
    await db.query(
      `insert into clan (clan_tag) values ('#2GG'), ('#2QQ'), ('#2LL')`,
    );
    await db.query(
      `insert into player (player_tag)
       select unnest(array['#PY0', '#PY2', '#PY8', '#PY9', '#PYP', '#PYY', '#PYL'])`,
    );
    // One instant for every row: a read opens all its rows at one time.
    const base = new Date(Date.now() + 1000).toISOString();
    const row = (
      clan,
      player,
      joined,
      { left = null, baseline = false } = {},
    ) =>
      db.query(
        `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at, baseline)
         values ($1, $2, $6::timestamptz - $3::interval, $6::timestamptz - $4::interval, $5)`,
        [clan, player, joined, left, baseline, base],
      );
    // #2GG: a first read of three (one has since left), then a join seen
    // between two reads.
    await row("#2GG", "#PY0", "30 days");
    await row("#2GG", "#PY2", "30 days");
    await row("#2GG", "#PY8", "30 days", { left: "10 days" });
    await row("#2GG", "#PY9", "20 days");
    // #2QQ: a first read of one, then a rejoin by the same player.
    await row("#2QQ", "#PYP", "40 days", { left: "35 days" });
    await row("#2QQ", "#PYP", "5 days");
    // #2LL: a first read after 0207, already baseline, and a later join.
    await row("#2LL", "#PYY", "-1 minute", { baseline: true });
    await row("#2LL", "#PYL", "-2 minutes");

    const before = await membershipBaselineCensus(url);
    assert.equal(before.first_read_rows.rows, 4);
    assert.equal(before.first_read_rows.clans, 2);
    assert.equal(before.marked_first_read_rows.rows, 0);

    await db.query("begin");
    const ran = await db.query(sql);
    await db.query("commit");
    const update = (Array.isArray(ran) ? ran : [ran]).find(
      (r) => r.command === "UPDATE",
    );
    assert.equal(update.rowCount, 4, "the census's four rows");

    const { rows } = await db.query(
      `select clan_tag, player_tag, baseline from clan_membership
        order by clan_tag, joined_observed_at, player_tag`,
    );
    assert.deepEqual(
      rows.map((r) => `${r.clan_tag} ${r.player_tag} ${r.baseline}`),
      [
        "#2GG #PY0 true",
        "#2GG #PY2 true",
        "#2GG #PY8 true",
        "#2GG #PY9 false",
        "#2LL #PYY true",
        "#2LL #PYL false",
        "#2QQ #PYP true",
        "#2QQ #PYP false",
      ],
    );

    const after = await membershipBaselineCensus(url);
    assert.equal(after.first_read_rows.rows, 0);
    assert.equal(after.marked_first_read_rows.rows, 4);
    assert.equal(after.marked_first_read_rows.clans, 2);
    const one = await membershipBaselineCensus(url, { clan_tag: "#2QQ" });
    assert.equal(one.marked_first_read_rows.rows, 1);

    // Idempotent: a second run marks nothing.
    const again = await db.query(
      sql.replace(/^set local .*$/m, "").replace(/comment on[\s\S]*$/, ""),
    );
    assert.equal(again.rowCount, 0);
    const {
      rows: [{ n }],
    } = await db.query(`select count(*)::int as n from clan_membership`);
    assert.equal(n, 8, "nothing deleted");
  } finally {
    await drop();
  }
});
