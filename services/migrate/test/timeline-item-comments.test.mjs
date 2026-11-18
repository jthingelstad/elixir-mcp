/** Upgrade the real pre-0300 schema with synthetic comments. Preserve
 * history, exact private-source classification and the old-writer window. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { loadMigrations, migrate } from "../src/migrate.mjs";

const root = new URL("../../../", import.meta.url);
const migrationsDir = new URL("db/migrations/", root).pathname;
const adminUrl =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const itemId = (source, id) =>
  `tl_${createHash("sha256").update(`${source}|${id}`).digest("hex").slice(0, 20)}`;
const plainId = (n) => `tl_${String(n).padStart(20, "0")}`;

test("0300 preserves comment history, classifies receipts by source and normalizes old writers", async () => {
  const name = `elixir_mcp_test_item_comments_upgrade_${process.pid}`;
  const url = adminUrl.replace(/\/postgres$/, `/${name}`);
  const admin = new pg.Client({ connectionString: adminUrl });
  const db = new pg.Client({ connectionString: url });
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "elixir-pre-item-comments-"),
  );
  await admin.connect();
  try {
    await admin.query(`create database ${name}`);
    for (const migration of await loadMigrations(migrationsDir))
      if (migration.id < 300)
        await cp(
          path.join(migrationsDir, migration.name),
          path.join(dir, migration.name),
        );
    await migrate({ databaseUrl: url, migrationsDir: dir });
    await db.connect();
    const people = (
      await db.query(
        `insert into account(email_hash,status) values('comments-upgrade-owner','approved'),('comments-upgrade-writer','approved') returning account_id`,
      )
    ).rows;
    const [owner, writer] = people.map((p) => p.account_id);
    const tag = "#0QYC9U2P";
    await db.query(
      `insert into player(player_tag,name) values($1,'Invented Player')`,
      [tag],
    );
    await db.query(
      `insert into claim(account_id,player_tag,status,is_primary,relationship,verified_at)
      values($1,$2,'verified',true,'primary',now())`,
      [owner, tag],
    );
    const post = plainId(501),
      game = plainId(502),
      removedPost = plainId(503);
    await db.query(
      `insert into account_post(item_id,account_id,player_tag,body) values($1,$2,$3,'An invented post')`,
      [post, owner, tag],
    );
    const fact = (
      await db.query(
        `insert into attested_fact(subject_kind,clan_tag,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at) values('clan','#0RQYGC2L',$1,'member_away','{}','player','clan.poapkings.com','comments-upgrade',now()) returning fact_id`,
        [tag],
      )
    ).rows[0].fact_id;
    const restricted = itemId("attested_fact", fact);
    const personalFact = (
      await db.query(
        `insert into attested_fact(subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,occurred_at) values('player',$1,'personal_record','{"game":"Invented game","score":2}','leaders','elixir-drop','comments-upgrade-personal',now()) returning fact_id`,
        [tag],
      )
    ).rows[0].fact_id;
    const personal = itemId("attested_fact", personalFact);
    const dropFact = (
      await db.query(
        `insert into attested_fact(subject_kind,player_tag,fact_type,detail,visibility,source,source_ref,attester_account_id,occurred_at)
       values('player',$1,'drop_game',$2,'leaders','elixir-drop','comments-upgrade-drop',$3,now()) returning fact_id`,
        [
          tag,
          {
            game_id: "00000000-0000-4000-8000-000000000001",
            mode: "practice",
            started_at: "2026-11-14T12:00:00Z",
            score: 4,
            answers: 4,
            cards: [26000000],
          },
          owner,
        ],
      )
    ).rows[0].fact_id;
    const drop = itemId("attested_fact", dropFact);
    for (const id of [post, game, restricted, personal, drop])
      await db.query(
        `insert into timeline_cheer(account_id,item_id,cheer,subject_tags,created_at,updated_at)
        values($1,$2,'royal',$3,'2026-11-14T12:34:56.123456Z','2026-11-15T12:34:56.654321Z')`,
        [writer, id, [tag]],
      );
    const reactions = async () =>
      (
        await db.query(
          `select account_id,item_id,cheer,created_at::text,updated_at::text from timeline_cheer order by item_id`,
        )
      ).rows;
    const reactionsBefore = await reactions();
    for (const [i, id] of [
      post,
      game,
      restricted,
      removedPost,
      personal,
      drop,
    ].entries())
      await db.query(
        `insert into timeline_comment(item_id,account_id,subject_tag,owner_account_id,body,created_at,status,removed_at,removed_by) values($1,$2,$3,$4,$5,'2026-11-14T12:34:56.123456Z',$6,$7,$8)`,
        [
          id,
          writer,
          tag,
          owner,
          `Invented comment ${i}`,
          i === 3 ? "removed" : "visible",
          i === 3 ? "2026-11-15T00:00:00Z" : null,
          i === 3 ? "owner" : null,
        ],
      );
    await db.query(
      `insert into comment_setting(account_id,who) values($1,'following')`,
      [owner],
    );
    const snapshot = async () =>
      (
        await db.query(
          `select comment_id::text,item_id,account_id,subject_tag,owner_account_id,body,created_at::text,status,removed_at::text,removed_by from timeline_comment order by comment_id`,
        )
      ).rows;
    const before = await snapshot();
    const commentMigration = "0300_timeline_item_comments.sql";
    await cp(
      path.join(migrationsDir, commentMigration),
      path.join(dir, commentMigration),
    );
    const result = await migrate({ databaseUrl: url, migrationsDir: dir });
    assert.equal(result.ran, 1);
    assert.deepEqual(
      await snapshot(),
      before,
      "IDs, authors, owners, words, microsecond dates and status survive",
    );
    assert.deepEqual(
      await reactions(),
      reactionsBefore,
      "reaction count, identity, kind and microsecond timestamps survive",
    );
    const recipients = new Map(
      (
        await db.query(`select item_id,subject_tags from timeline_cheer`)
      ).rows.map((r) => [r.item_id, r.subject_tags]),
    );
    assert.equal(recipients.get(restricted), null);
    assert.equal(recipients.get(drop), null);
    for (const id of [post, game, personal])
      assert.deepEqual(recipients.get(id), [tag]);
    assert.equal(
      (
        await db.query(`select who from comment_setting where account_id=$1`, [
          owner,
        ])
      ).rows[0].who,
      "following",
    );
    const flags = (
      await db.query(
        `select item_id,owner_is_account,receipt_allowed from timeline_comment order by comment_id`,
      )
    ).rows;
    assert.deepEqual(flags, [
      { item_id: post, owner_is_account: true, receipt_allowed: true },
      { item_id: game, owner_is_account: false, receipt_allowed: true },
      { item_id: restricted, owner_is_account: false, receipt_allowed: false },
      { item_id: removedPost, owner_is_account: false, receipt_allowed: true },
      { item_id: personal, owner_is_account: false, receipt_allowed: true },
      { item_id: drop, owner_is_account: false, receipt_allowed: true },
    ]);
    assert.ok(
      result.vacuumed.some(
        (r) => r.table === "timeline_comment" && !r.error && !r.skipped,
      ),
    );
    assert.ok(
      result.vacuumed.some(
        (r) => r.table === "timeline_cheer" && !r.error && !r.skipped,
      ),
    );
    const oldWrite = async (id) =>
      (
        await db.query(
          `insert into timeline_comment(item_id,account_id,subject_tag,owner_account_id,body) values($1,$2,$3,$2,'Old writer after migration') returning owner_account_id,owner_is_account,receipt_allowed`,
          [id, writer, tag],
        )
      ).rows[0];
    assert.deepEqual(await oldWrite(post), {
      owner_account_id: owner,
      owner_is_account: true,
      receipt_allowed: true,
    });
    assert.deepEqual(await oldWrite(restricted), {
      owner_account_id: writer,
      owner_is_account: false,
      receipt_allowed: false,
    });
    assert.deepEqual(await oldWrite(game), {
      owner_account_id: writer,
      owner_is_account: false,
      receipt_allowed: true,
    });
    assert.deepEqual(await oldWrite(personal), {
      owner_account_id: writer,
      owner_is_account: false,
      receipt_allowed: true,
    });
    assert.deepEqual(await oldWrite(drop), {
      owner_account_id: writer,
      owner_is_account: false,
      receipt_allowed: true,
    });
  } finally {
    await db.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
    await rm(dir, { recursive: true, force: true });
  }
});
