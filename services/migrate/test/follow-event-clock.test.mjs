import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { readFollowers } from "../../../packages/tools/src/activity/bell.mjs";
import { runActivityMail } from "../../jobs/src/email/activity-today.mjs";
import { runWebPush } from "../../jobs/src/push/drain.mjs";

test("a new follow on an old claim reaches Notifications and both delivery selectors", async () => {
  const s = await scratchDb("follow_event_clock");
  const { db } = s;
  try {
    const {
      rows: [owner, follower],
    } = await db.query(
      `insert into account (email_hash,email,status,timezone) values
         ('clock-owner','clock@example.com','approved','UTC'),
         ('clock-follower',null,'approved','UTC') returning account_id`,
    );
    const tag = "#0JQ0JQ8";
    await db.query(
      "insert into player (player_tag,name) values ($1,'Invented Linden')",
      [tag],
    );
    await db.query(
      `insert into claim (account_id, player_tag, is_primary, status, relationship, created_at)
       values ($1,$3,true,'verified','primary',now()-interval '60 days'),
              ($2,$3,false,'unverified','alt',now()-interval '60 days')`,
      [owner.account_id, follower.account_id, tag],
    );
    await db.query(
      `insert into push_subscription (account_id, endpoint, p256dh, auth, created_at)
       values ($1,'https://fcm.googleapis.com/fcm/send/clock',repeat('B',87), repeat('a',22),now()-interval '3 days')`,
      [owner.account_id],
    );
    await db.query(
      "update claim set relationship='friend' where account_id=$1",
      [follower.account_id],
    );
    const now = new Date();
    const seen = new Date(now.getTime() - 86400_000);
    const bell = await readFollowers(
      db,
      owner.account_id,
      [{ tag, name: "Invented Linden" }],
      seen,
    );
    assert.equal(bell.new, 1);
    const mail = await runActivityMail({
      db,
      accountId: owner.account_id,
      now,
      hour: (now.getUTCHours() + 1) % 24,
      secret: "test-secret",
      enqueue: async () => assert.fail("outside delivery hour"),
    });
    assert.equal(mail.candidates, 1);
    const push = await runWebPush({
      db,
      accountId: owner.account_id,
      now,
      outbox: async () => {},
    });
    assert.equal(push.candidates, 1);

    const queryClock = "select followed_at from claim where account_id=$1";
    const {
      rows: [first],
    } = await db.query(queryClock, [follower.account_id]);
    await db.query("update claim set notify=false where account_id=$1", [
      follower.account_id,
    ]);
    assert.deepEqual(
      (await db.query(queryClock, [follower.account_id])).rows[0],
      first,
    );
    await db.query("update claim set relationship='alt' where account_id=$1", [
      follower.account_id,
    ]);
    assert.equal(
      (await db.query(queryClock, [follower.account_id])).rows[0].followed_at,
      null,
    );
  } finally {
    await s.drop();
  }
});

test("the clock migration keeps existing relationships and uses the original dates of existing friends", async (t) => {
  const s = await scratchDb("follow_clock_backfill");
  const { db } = s;
  try {
    await db.query(`drop trigger claim_follow_stamp on claim;
      drop function stamp_claim_follow();
      alter table claim drop column followed_at;`);
    await db.query(
      `insert into player(player_tag,name) values ('#0JQ0JQ8','Invented Linden')`,
    );
    await db.query(`with members as (
      insert into account (email_hash,status)
      select 'clock-' || n, 'approved' from generate_series(1,122) n returning account_id
    ), numbered as (select account_id, row_number() over(order by account_id) as n from members)
    insert into claim(account_id, player_tag, relationship, created_at)
    select account_id, '#0JQ0JQ8', case when n % 2 = 0 then 'friend' else 'alt' end,
           now() - n * interval '1 day' from numbered`);
    const rows = () =>
      db.query(
        "select account_id,player_tag,relationship,status,is_primary,created_at,notify,close from claim order by account_id",
      );
    const before = await rows();
    const sql = await readFile(
      new URL(
        "../../../db/migrations/0296_follow_event_clock.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query("begin");
    const started = performance.now();
    await db.query(sql);
    await db.query("commit");
    t.diagnostic(
      `Clock migration on 122 fixture claims: ${Math.round(performance.now() - started)} ms`,
    );
    assert.deepEqual((await rows()).rows, before.rows);
    const {
      rows: [counts],
    } = await db.query(
      `select count(*) filter (where relationship='friend' and followed_at=created_at)::int as dated,
              count(*) filter (where relationship='alt' and followed_at is null)::int as quiet from claim`,
    );
    assert.deepEqual(counts, { dated: 61, quiet: 61 });
  } finally {
    await s.drop();
  }
});
