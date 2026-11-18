import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { readFollowers } from "../../../packages/tools/src/activity/bell.mjs";
import { followsOf, followersOf } from "../../../packages/tools/src/social.mjs";
import { runActivityMail } from "../../jobs/src/email/activity-today.mjs";
import { runWebPush } from "../../jobs/src/push/drain.mjs";

test("Watching converts losslessly, without inventing follower activity; real follow dates survive", async () => {
  const s = await scratchDb("friend_follow_migration");
  const db = s.db;
  try {
    // Recreate the relationship check immediately before retirement,
    // retaining the real preparatory clock and its write trigger.
    await db.query(`alter table claim drop constraint claim_relationship_check;
      alter table claim add constraint claim_relationship_check
        check (relationship in ('primary','alt','friend','watching'));
      alter table claim alter column relationship set default 'watching';`);
    const account = async (key, kind = "person", owner = null) =>
      (
        await db.query(
          "insert into account (email_hash,status,kind,owned_by_account_id) values ($1,'approved',$2,$3) returning account_id",
          [key, kind, owner],
        )
      ).rows[0].account_id;
    const owner = await account("friend-migration-owner");
    const watcher = await account("friend-migration-watcher");
    const friend = await account("friend-migration-friend");
    const agent = await account("friend-migration-agent", "agent", watcher);
    const tag = "#0JQ0JQ8";
    await db.query(
      "insert into player (player_tag,name) values ($1,'Invented Juniper')",
      [tag],
    );
    await db.query(
      `insert into claim (account_id,player_tag,status,is_primary,relationship,created_at,notify)
      values ($1,$5,'verified',true,'primary',now()-interval '3 days',true),
             ($2,$5,'unverified',false,'watching',now()-interval '30 minutes',false),
             ($3,$5,'unverified',false,'friend',now()-interval '2 hours',true),
             ($4,$5,'unverified',false,'watching',now()-interval '15 minutes',true)`,
      [owner, watcher, friend, agent, tag],
    );
    await db.query(
      "insert into player_nickname (account_id,player_tag,nickname) values ($1,$2,'Private name')",
      [watcher, tag],
    );
    const rows = async () =>
      (
        await db.query(
          "select account_id,player_tag,status,is_primary,relationship,created_at,notify,close from claim order by account_id",
        )
      ).rows;
    // A block used to leave a watched game recording alone. Converting it
    // must not revive a social association between those accounts.
    await db.query(
      "insert into account_block (account_id,blocked_account_id) values ($1,$2)",
      [owner, watcher],
    );
    await db.query(
      "insert into recording (subject_type,subject_tag,requested_by,status) values ('player',$1,$2,'active')",
      [tag, watcher],
    );
    const recordingsBefore = (await db.query("select * from recording")).rows;
    const before = await rows();
    const sql = await readFile(
      new URL(
        "../../../db/migrations/0301_friend_follows.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query("begin");
    await db.query(sql);
    await db.query("commit");
    await db.query("begin");
    await db.query(
      await readFile(
        new URL(
          "../../../db/migrations/0302_validate_friend_follows.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.query("commit");
    assert.deepEqual(
      await rows(),
      before.map((r) => ({
        ...r,
        relationship: r.relationship === "watching" ? "friend" : r.relationship,
      })),
    );
    assert.deepEqual(
      (await db.query("select * from recording")).rows,
      recordingsBefore,
    );
    assert.equal((await followsOf(db, watcher)).count, 0);
    assert.equal((await followersOf(db, tag, owner)).count, 1);
    const dates = (
      await db.query("select account_id,created_at,followed_at from claim")
    ).rows;
    assert.equal(dates.find((r) => r.account_id === watcher).followed_at, null);
    assert.equal(dates.find((r) => r.account_id === agent).followed_at, null);
    const prior = dates.find((r) => r.account_id === friend);
    assert.deepEqual(prior.followed_at, prior.created_at);
    const notices = await readFollowers(
      db,
      owner,
      [{ tag, name: "Invented Juniper" }],
      new Date(Date.now() - 86400000),
    );
    assert.equal(notices.count, 1);
    assert.equal(notices.new, 1);
    assert.equal(notices.fresh_by[0].count, 1);
    assert.equal(
      (
        await db.query(
          "select nickname from player_nickname where account_id=$1",
          [watcher],
        )
      ).rows[0].nickname,
      "Private name",
    );
    for (const table of ["account_follow", "account_event"])
      assert.equal(
        (await db.query(`select count(*)::int n from ${table}`)).rows[0].n,
        0,
      );
    // Remove the real follower so only converted claims remain. Even the
    // jobs' candidate scans must use the real follow event, not claim age.
    await db.query("delete from claim where account_id=$1", [friend]);
    await db.query("delete from account_block");
    await db.query(
      "update account set email='owner@example.com',timezone='UTC' where account_id=$1",
      [owner],
    );
    await db.query(
      `insert into push_subscription (account_id, endpoint, p256dh, auth, created_at)
       values ($1, 'https://fcm.googleapis.com/fcm/send/friend-migration', repeat('B',87), repeat('a',22), now()-interval '3 days')`,
      [owner],
    );
    const deliveries = [];
    const now = new Date();
    const mail = await runActivityMail({
      db,
      accountId: owner,
      now,
      hour: now.getUTCHours(),
      secret: "test-secret",
      enqueue: async (m) => deliveries.push(m),
    });
    assert.equal(mail.candidates, 0);
    const push = await runWebPush({
      db,
      accountId: owner,
      now,
      outbox: async (...args) => deliveries.push(args),
    });
    assert.equal(push.candidates, 0);
    assert.deepEqual(deliveries, []);
    await db.query("update claim set notify=true where account_id=$1", [
      watcher,
    ]);
    assert.equal(
      (
        await db.query("select followed_at from claim where account_id=$1", [
          watcher,
        ])
      ).rows[0].followed_at,
      null,
    );
    await db.query("update claim set relationship='alt' where account_id=$1", [
      watcher,
    ]);
    await db.query(
      "update claim set relationship='friend' where account_id=$1",
      [watcher],
    );
    assert.ok(
      (
        await db.query("select followed_at from claim where account_id=$1", [
          watcher,
        ])
      ).rows[0].followed_at instanceof Date,
    );
    await assert.rejects(
      db.query("update claim set relationship='watching' where account_id=$1", [
        watcher,
      ]),
      /claim_relationship_check/,
    );
  } finally {
    await s.drop();
  }
});
