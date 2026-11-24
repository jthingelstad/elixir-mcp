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
    await db.query(`drop trigger if exists claim_watching_compat on claim;
      drop function if exists normalize_legacy_watching_claim();
      alter table claim drop constraint claim_relationship_check;
      alter table claim add constraint claim_relationship_check
        check (relationship in ('primary','alt','friend','watching'));
      alter table claim alter column relationship set default 'watching';`);
    const account = async (key) =>
      (
        await db.query(
          "insert into account (email_hash,status) values ($1,'approved') returning account_id",
          [key],
        )
      ).rows[0].account_id;
    const owner = await account("friend-migration-owner");
    const watcher = await account("friend-migration-watcher");
    const friend = await account("friend-migration-friend");
    const lurker = await account("friend-migration-lurker");
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
      [owner, watcher, friend, lurker, tag],
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
    // The friend and the converted lurker follow; the blocked watcher
    // does not.
    assert.equal((await followersOf(db, tag, owner)).count, 2);
    const dates = (
      await db.query("select account_id,created_at,followed_at from claim")
    ).rows;
    assert.equal(dates.find((r) => r.account_id === watcher).followed_at, null);
    assert.equal(dates.find((r) => r.account_id === lurker).followed_at, null);
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
    await db.query(
      "update claim set relationship='watching' where account_id=$1",
      [watcher],
    );
    assert.deepEqual(
      (
        await db.query(
          "select relationship,followed_at from claim where account_id=$1",
          [watcher],
        )
      ).rows[0],
      { relationship: "friend", followed_at: null },
    );
  } finally {
    await s.drop();
  }
});

test("old writers can add and demote throughout cutover without synthetic follow notices", async () => {
  const s = await scratchDb("friend_follow_cutover");
  const { db } = s;
  try {
    await db.query(`drop trigger if exists claim_watching_compat on claim;
      drop function if exists normalize_legacy_watching_claim();
      alter table claim drop constraint claim_relationship_check;
      alter table claim add constraint claim_relationship_check
        check (relationship in ('primary','alt','friend','watching'));
      alter table claim alter column relationship set default 'watching';`);
    const { rows: accounts } = await db.query(
      `insert into account(email_hash,status,timezone) values
       ('cutover-owner','approved','UTC'),('cutover-legacy','approved','UTC'),
       ('cutover-modern','approved','UTC') returning account_id`,
    );
    const [owner, legacy, modern] = accounts.map((r) => r.account_id);
    const tag = "#0JQ0JQ8";
    const oldPrimary = "#0QJ9000";
    const newPrimary = "#0QJ9002";
    const added = "#0QJ9008";
    for (const player of [tag, oldPrimary, newPrimary, added])
      await db.query(
        "insert into player(player_tag,name) values ($1,'Invented Juniper')",
        [player],
      );
    await db.query(
      `insert into claim(account_id,player_tag,status,is_primary,relationship,created_at,notify)
       values ($1,$3,'verified',true,'primary',now()-interval '3 days',true),
              ($1,$4,'verified',false,'alt',now()-interval '3 days',true),
              ($2,$5,'verified',true,'primary',now()-interval '3 days',true),
              ($2,$3,'unverified',false,'watching',now()-interval '1 hour',false)`,
      [owner, legacy, tag, added, oldPrimary],
    );
    const readClaim = async (account, player) =>
      (
        await db.query(
          `select relationship,is_primary,followed_at,created_at,notify from claim
           where account_id=$1 and player_tag=$2`,
          [account, player],
        )
      ).rows[0];
    const historic = await readClaim(legacy, tag);
    const apply = async (file) => {
      await db.query("begin");
      await db.query(
        await readFile(
          new URL(`../../../db/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
      await db.query("commit");
    };
    await apply("0301_friend_follows.sql");
    assert.deepEqual(await readClaim(legacy, tag), {
      ...historic,
      relationship: "friend",
    });
    // These are the explicit Watching writes in the previous addPlayer:
    // an unnamed later addition and demotion before a new primary insert.
    // They must succeed while the NOT VALID check already enforces writes.
    await db.query(
      `insert into claim(account_id,player_tag,status,is_primary,relationship)
       values ($1,$2,'unverified',false,'watching')
       on conflict(account_id,player_tag) do nothing`,
      [legacy, added],
    );
    await db.query(
      `update claim set is_primary=false,
       relationship=case when relationship='primary' then 'watching' else relationship end
       where account_id=$1 and is_primary and player_tag<>$2`,
      [legacy, newPrimary],
    );
    await db.query(
      `insert into claim(account_id,player_tag,status,is_primary,relationship)
       values ($1,$2,'unverified',true,'primary')`,
      [legacy, newPrimary],
    );
    await apply("0302_validate_friend_follows.sql");
    // The old switch-to-an-existing-primary query still works after validation.
    // addPlayer first demotes the current primary to clear the unique index.
    await db.query(
      `update claim set is_primary=false,
       relationship=case when relationship='primary' then 'watching' else relationship end
       where account_id=$1 and is_primary and player_tag<>$2`,
      [legacy, oldPrimary],
    );
    await db.query(
      `update claim set is_primary=(player_tag=$2),
       relationship=case when player_tag=$2 then 'primary'
                         when relationship='primary' then 'watching' else relationship end,
       close=close and player_tag<>$2 where account_id=$1`,
      [legacy, oldPrimary],
    );
    for (const player of [tag, added, newPrimary]) {
      const row = await readClaim(legacy, player);
      assert.equal(row.relationship, "friend");
      assert.equal(row.is_primary, false);
      assert.equal(row.followed_at, null);
    }
    assert.equal((await readClaim(legacy, tag)).notify, false);
    assert.deepEqual(
      (await readClaim(legacy, tag)).created_at,
      historic.created_at,
    );
    await db.query("update claim set notify=true where account_id=$1", [
      legacy,
    ]);
    const owned = [tag, added].map((t) => ({
      tag: t,
      name: "Invented Juniper",
    }));
    const seen = new Date(Date.now() - 86400000);
    assert.equal((await readFollowers(db, owner, owned, seen)).new, 0);
    await db.query(
      "update account set email='owner@example.com' where account_id=$1",
      [owner],
    );
    await db.query(
      `insert into push_subscription(account_id,endpoint,p256dh,auth,created_at)
       values ($1,'https://fcm.googleapis.com/fcm/send/cutover',repeat('B',87),repeat('a',22),now()-interval '3 days')`,
      [owner],
    );
    const deliveries = [];
    const now = new Date();
    assert.equal(
      (
        await runActivityMail({
          db,
          accountId: owner,
          now,
          hour: now.getUTCHours(),
          secret: "test-secret",
          enqueue: async (m) => deliveries.push(m),
        })
      ).candidates,
      0,
    );
    assert.equal(
      (
        await runWebPush({
          db,
          accountId: owner,
          now,
          outbox: async (...args) => deliveries.push(args),
        })
      ).candidates,
      0,
    );
    assert.deepEqual(deliveries, []);
    // New-version explicit friend writes still stamp actual follow activity.
    await db.query(
      "insert into claim(account_id,player_tag,relationship) values ($1,$2,'friend')",
      [modern, tag],
    );
    assert.ok((await readClaim(modern, tag)).followed_at instanceof Date);
    assert.equal((await readFollowers(db, owner, owned, seen)).new, 1);
    await assert.rejects(
      db.query("update claim set relationship='unknown' where account_id=$1", [
        modern,
      ]),
      /claim_relationship_check/,
    );
  } finally {
    await s.drop();
  }
});
