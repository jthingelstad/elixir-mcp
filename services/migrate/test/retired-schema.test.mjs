import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { migrate, loadMigrations } from "../src/migrate.mjs";
import { schemaFingerprint } from "../src/fingerprint.mjs";
import {
  seedReceipt,
  fixture,
  fixtureMeta,
} from "../../../packages/ingest/test/helpers.mjs";
import { ingestBattlelog } from "../../../packages/ingest/src/battles.mjs";
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const migrationId = 199;
const sql = await readFile(
  path.join(repoRoot, "db/migrations/0199_retired_global_recorders.sql"),
  "utf8",
);
const retired = [
  "clan_ranking_entry",
  "ranking_entry",
  "ranking_presence",
  "ranking_snapshot",
  "ranking_board",
  "card_meta_season_band",
  "deck_meta_season_band",
  "meta_season_band_totals",
  "card_meta_season",
  "deck_meta_season",
  "meta_season_totals",
  "meta_season_pop_day",
  "meta_season_pop",
  "meta_season_state",
  "integration_collection_grant",
  "collection_member",
  "collection",
  "email_featured_card",
];
const adminUrl =
  process.env.PG_ADMIN_URL ??
  `postgres://${os.userInfo().username}@localhost:5432/postgres`;
async function oldDatabase(suffix) {
  const name = `elixir_mcp_test_contract_${suffix}_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "elixir-pre-contract-"));
  try {
    for (const m of await loadMigrations(path.join(repoRoot, "db/migrations")))
      if (m.id < migrationId)
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
async function apply(db) {
  await db.query("begin");
  try {
    await db.query(sql);
    await db.query("commit");
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
async function assertGone(db) {
  for (const table of retired)
    assert.equal(
      (await db.query("select to_regclass($1) as relation", [table])).rows[0]
        .relation,
      null,
      table,
    );
}
test("fresh ladder can retire only empty history and old bootstrap board configuration", async () => {
  const ctx = await oldDatabase("fresh");
  try {
    assert.equal(
      (await ctx.db.query("select count(*)::int n from account")).rows[0].n,
      0,
    );
    assert.ok(
      (await ctx.db.query("select count(*)::int n from ranking_board")).rows[0]
        .n > 0,
    );
    await apply(ctx.db);
    await assertGone(ctx.db);
    // Later additive migrations remain part of the current schema pin.
    for (const m of await loadMigrations(
      path.join(repoRoot, "db/migrations"),
    )) {
      if (m.id > migrationId)
        await ctx.db.query(
          await readFile(path.join(repoRoot, "db/migrations", m.name), "utf8"),
        );
    }
    assert.equal(
      await schemaFingerprint(ctx.url),
      (
        await readFile(path.join(repoRoot, "db/schema.fingerprint"), "utf8")
      ).trim(),
    );
  } finally {
    await ctx.drop();
  }
});
test("populated retired tables refuse atomically and an obsolete writer blocks the empty-table check", async () => {
  const ctx = await oldDatabase("refusal");
  try {
    const account = (
      await ctx.db.query(
        "insert into account(email_hash,status) values ('contract-refusal','approved') returning account_id",
      )
    ).rows[0].account_id;
    await ctx.db.query(
      "insert into collection(slug,title,kind,owner_account) values ('kept-fixture','Synthetic group','player',$1)",
      [account],
    );
    await assert.rejects(apply(ctx.db), /collection still holds rows/);
    for (const table of retired)
      assert.ok(
        (await ctx.db.query("select to_regclass($1) as relation", [table]))
          .rows[0].relation,
        table,
      );
    await ctx.db.query("delete from collection");
    await assert.rejects(
      apply(ctx.db),
      /ranking_board still holds configuration/,
    );
    await ctx.db.query("delete from ranking_board");
    const writer = new pg.Client({ connectionString: ctx.url });
    await writer.connect();
    try {
      await writer.query("begin");
      await writer.query(
        "insert into collection(slug,title,kind,owner_account) values ('late-fixture','Synthetic group','player',$1)",
        [account],
      );
      await assert.rejects(apply(ctx.db), /lock timeout/);
      await writer.query("commit");
    } finally {
      await writer.end();
    }
    await assert.rejects(apply(ctx.db), /collection still holds rows/);
    assert.equal(
      (await ctx.db.query("select count(*)::int n from collection")).rows[0].n,
      1,
    );
  } finally {
    await ctx.drop();
  }
});
test("verified empty upgrade preserves complete battles, cards, rounds, entities and immutable receipts", async () => {
  const ctx = await oldDatabase("upgrade");
  try {
    const receiptId = await seedReceipt(ctx.db);
    const meta = await fixtureMeta();
    await ingestBattlelog(ctx.db, {
      observerTag: meta["player_battlelog/with_boat_and_duel.json"].entity_key,
      receiptId,
      payload: await fixture("player_battlelog/with_boat_and_duel.json"),
    });
    const kept = [
      "account",
      "gateway",
      "battle",
      "battle_participant",
      "battle_participant_card",
      "battle_participant_round",
      "api_receipt",
      "player",
      "clan",
    ];
    const snapshot = async () => {
      const rows = [];
      for (const table of kept)
        rows.push({
          table,
          rows: (await ctx.db.query(`select * from ${table} order by 1,2`))
            .rows,
        });
      return rows;
    };
    const before = await snapshot();
    assert.ok(
      before.find((x) => x.table === "battle_participant_round").rows.length >
        0,
    );
    await ctx.db.query("delete from ranking_board");
    await apply(ctx.db);
    await assertGone(ctx.db);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await ctx.drop();
  }
});
