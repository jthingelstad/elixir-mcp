import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { migrate, loadMigrations } from "../src/migrate.mjs";

/**
 * 0208 (Jamie, 2026-10-08: "Approved: mark the 35 first-read membership
 * rows as baseline in elixir production"): on a database built through
 * 0207, exactly the rows the census counts (opened on their clan's first
 * membership observation, not yet baseline) become baseline. A join
 * observed later, a row already baseline and other clans' rows are left
 * as they were; nothing is deleted; and a second run changes nothing.
 * (The census op that counted those rows retired in 0256.)
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
  const { db, drop } = await databaseThrough0207();
  try {
    // Every row here predates 0207's applied_at (now), as production's do,
    // except the one a post-0207 read opened.
    await db.query(
      `insert into clan (clan_tag) values ('#0YU'), ('#0J8'), ('#0JU')`,
    );
    await db.query(
      `insert into player (player_tag)
       select unnest(array['#08Q', '#0PR', '#09C', '#0PC', '#0J0', '#0QC', '#0C9'])`,
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
    // #0YU: a first read of three (one has since left), then a join seen
    // between two reads.
    await row("#0YU", "#08Q", "30 days");
    await row("#0YU", "#0PR", "30 days");
    await row("#0YU", "#09C", "30 days", { left: "10 days" });
    await row("#0YU", "#0PC", "20 days");
    // #0J8: a first read of one, then a rejoin by the same player.
    await row("#0J8", "#0J0", "40 days", { left: "35 days" });
    await row("#0J8", "#0J0", "5 days");
    // #0JU: a first read after 0207, already baseline, and a later join.
    await row("#0JU", "#0QC", "-1 minute", { baseline: true });
    await row("#0JU", "#0C9", "-2 minutes");

    await db.query("begin");
    const ran = await db.query(sql);
    await db.query("commit");
    const update = (Array.isArray(ran) ? ran : [ran]).find(
      (r) => r.command === "UPDATE",
    );
    assert.equal(update.rowCount, 4, "the four first-read rows");

    const { rows } = await db.query(
      `select clan_tag, player_tag, baseline from clan_membership
        order by clan_tag, joined_observed_at, player_tag`,
    );
    // Which rows are baseline is the point, not the tags' sort order.
    assert.deepEqual(
      rows.map((r) => `${r.clan_tag} ${r.player_tag} ${r.baseline}`).sort(),
      [
        "#0YU #08Q true",
        "#0YU #0PR true",
        "#0YU #09C true",
        "#0YU #0PC false",
        "#0JU #0QC true",
        "#0JU #0C9 false",
        "#0J8 #0J0 true",
        "#0J8 #0J0 false",
      ].sort(),
    );

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
