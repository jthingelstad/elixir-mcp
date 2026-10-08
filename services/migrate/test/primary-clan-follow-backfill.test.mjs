import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { migrate, loadMigrations } from "../src/migrate.mjs";

/**
 * 0206 (Jamie, 2026-10-08: "Approved: backfill auto_follow_clan for the
 * 35 existing elixir accounts"): on a database built through 0205 with
 * accounts made before it, the backfill turns the switch on for approved
 * people only, never an agent, an integration, an account that is not
 * approved, or an account made after 0205. It writes no follow.
 */
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATION = "0206_primary_clan_follow_backfill.sql";
const sql = await readFile(
  path.join(repoRoot, "db/migrations", MIGRATION),
  "utf8",
);
const adminUrl =
  process.env.PG_ADMIN_URL ??
  `postgres://${os.userInfo().username}@localhost:5432/postgres`;

async function databaseThrough0205() {
  const name = `elixir_mcp_test_follow_backfill_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "elixir-pre-0206-"));
  try {
    for (const m of await loadMigrations(path.join(repoRoot, "db/migrations")))
      if (m.id < 206)
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
    async drop() {
      await db.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`drop database ${name} with (force)`);
      await a.end();
    },
  };
}

test("0206 turns auto_follow_clan on for approved people made before 0205, and nobody else", async () => {
  const { db, drop } = await databaseThrough0205();
  try {
    // 0205's applied_at is "now"; accounts made before it sit an hour back.
    const before = `now() - interval '1 hour'`;
    const person = async (hash, status, at = before) =>
      (
        await db.query(
          `insert into account (email_hash, status, role, created_at, auto_follow_clan)
           values ($1, $2, 'member', ${at}, false) returning account_id`,
          [hash, status],
        )
      ).rows[0].account_id;
    const approved = await person("approved", "approved");
    const denied = await person("denied", "denied");
    const disabled = await person("disabled", "disabled");
    const requested = await person("requested", "requested");
    // A person made after 0205 who has the switch off stays off.
    const later = await person(
      "later",
      "approved",
      `now() + interval '1 hour'`,
    );
    const agent = (
      await db.query(
        `insert into account (status, role, kind, owned_by_account_id, public_id, created_at, auto_follow_clan)
         values ('approved', 'member', 'agent', $1, 'agent0206', ${before}, false)
         returning account_id`,
        [approved],
      )
    ).rows[0].account_id;

    await db.query("begin");
    await db.query(sql);
    await db.query("commit");

    const { rows } = await db.query(
      `select account_id, auto_follow_clan from account`,
    );
    const on = new Map(rows.map((r) => [r.account_id, r.auto_follow_clan]));
    assert.equal(on.get(approved), true, "approved person made before 0205");
    for (const [label, id] of Object.entries({
      denied,
      disabled,
      requested,
      later,
      agent,
    }))
      assert.equal(on.get(id), false, label);
    // No follow is written: the next profile admission does that.
    const {
      rows: [{ n }],
    } = await db.query(`select count(*)::int as n from account_clan`);
    assert.equal(n, 0);
    // Idempotent: a second run changes nothing.
    const again = await db.query(
      sql.replace(/^set local .*$/m, "").replace(/comment on[\s\S]*$/, ""),
    );
    assert.equal(again.rowCount, 0);
  } finally {
    await drop();
  }
});
