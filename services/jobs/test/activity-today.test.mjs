/**
 * The activity mail (activity_today, 2026-11-16). Pinned here: one mail
 * at the person's evening hour when their own verified players had cheers
 * or new followers they have not seen; counts, never who; nothing when
 * the bell was opened since, when the switch is off, at another hour, or
 * twice in a day. Synthetic names and invented tags.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { buildBellWeek } from "../../../packages/tools/src/activity/home-feed.mjs";
import {
  ACTIVITY_HOUR,
  localClock,
  runActivityMail,
} from "../src/email/activity-today.mjs";

const OWN = "#0QQG0JVQQ";
const FOLLOWER_PLAYER = "#0QQJJPLGU";
const ITEM = "tl_00000000000000000b01";

test("local clock: the zone's hour and date, UTC for a zone that is not one", () => {
  const at = new Date("2026-11-16T23:30:00Z");
  assert.deepEqual(localClock("America/Chicago", at), {
    hour: 17,
    date: "2026-11-16",
  });
  assert.deepEqual(localClock("Not/AZone", at), {
    hour: 23,
    date: "2026-11-16",
  });
  assert.deepEqual(localClock("Asia/Tokyo", at), {
    hour: 8,
    date: "2026-11-17",
  });
  assert.equal(ACTIVITY_HOUR, 18);
});

test("activity mail: one a day, counts never who, only what the bell has not shown", async () => {
  const s = await scratchDb("activity_today");
  const { db } = s;
  try {
    const account = async (hash, { kind = "person" } = {}) =>
      (
        await db.query(
          `insert into account (email_hash, email, status, kind, timezone)
           values ($1, $2, 'approved', $3, 'UTC') returning account_id`,
          [hash, `${hash}@example.com`, kind],
        )
      ).rows[0].account_id;
    const owner = await account("owner");
    const fan = await account("fan");
    const follower = await account("follower");
    await db.query(
      `insert into player (player_tag, name) values ($1, 'Invented Owner'), ($2, 'Secret Follower')`,
      [OWN, FOLLOWER_PLAYER],
    );
    await db.query(
      `insert into claim (account_id, player_tag, is_primary, relationship, status, verified_at)
       values ($1, $2, true, 'primary', 'verified', now()),
              ($3, $4, true, 'primary', 'verified', now())`,
      [owner, OWN, follower, FOLLOWER_PLAYER],
    );
    await db.query(
      `insert into claim (account_id, player_tag, relationship, created_at)
       values ($1, $2, 'friend', now() - interval '1 hour')`,
      [follower, OWN],
    );
    // The owner's week, with one item about their player, cheered an hour
    // ago by the fan (the cheer route stamps its subject tags, 0280).
    await buildBellWeek(db, owner, {
      own: [{ tag: OWN, name: "Invented Owner" }],
    });
    const at = new Date(Date.now() - 3_600_000).toISOString();
    await db.query(
      `update bell_week set items = items || $2::jsonb where account_id = $1`,
      [
        owner,
        JSON.stringify([
          {
            id: ITEM,
            kind: "battle_session",
            section: "battles",
            subject_tag: OWN,
            at,
            sort_at: at,
            observed_at: at,
            text: "Invented Owner played <b>12</b> battles",
            facts: {},
          },
        ]),
      ],
    );
    await db.query(
      `insert into timeline_cheer (account_id, item_id, cheer, subject_tags, created_at, updated_at)
       values ($1, $2, 'grind', $3, now() - interval '1 hour', now() - interval '1 hour')`,
      [fan, ITEM, [OWN]],
    );
    const sent = [];
    const now = new Date();
    const hour = localClock("UTC", now).hour;
    const opts = {
      db,
      secret: "test-secret",
      enqueue: async (m) => sent.push(m),
      now,
      hour,
    };

    // Another hour: nobody is due.
    const early = await runActivityMail({ ...opts, hour: (hour + 1) % 24 });
    assert.equal(early.candidates, 1, JSON.stringify(early));
    assert.equal(early.due, 0);
    assert.equal(sent.length, 0);

    // Out of time: nothing sent, and the run says so for the retry.
    const short = await runActivityMail({ ...opts, remainingMs: () => 1_000 });
    assert.equal(short.incomplete, true);
    assert.equal(short.remaining, 1);
    assert.equal(sent.length, 0);

    const r = await runActivityMail(opts);
    assert.equal(r.sent, 1, JSON.stringify(r));
    assert.equal(sent.length, 1);
    const [m] = sent;
    assert.equal(m.kind, "activity_today");
    assert.equal(m.to, "owner@example.com");
    assert.equal(m.subject, "1 cheer and 1 new follower on your play");
    assert.ok(m.unsubscribe?.url, "bulk mail carries its turn-off");
    // Never who: not the follower's player, not the fan's address.
    assert.doesNotMatch(m.html, /Secret Follower|fan@example/);
    assert.doesNotMatch(m.html, /<b>12<\/b>/);
    assert.match(m.html, /Invented Owner/);
    // The log line carries counts, never an address.
    assert.doesNotMatch(JSON.stringify(r), /@example/);

    // Again in the same day: the ledger holds it.
    const again = await runActivityMail(opts);
    assert.equal(again.sent, 0);
    assert.equal(sent.length, 1);

    // The next day, nothing new since that mail: nothing.
    const tomorrow = new Date(now.getTime() + 86_400_000);
    const next = await runActivityMail({ ...opts, now: tomorrow });
    assert.equal(next.sent, 0, JSON.stringify(next));

    // A new cheer, but the owner opened the bell after it: nothing.
    await db.query(`delete from email_send`);
    await db.query(
      `insert into bell_seen (account_id, seen_at) values ($1, now())`,
      [owner],
    );
    const seen = await runActivityMail(opts);
    assert.equal(seen.sent, 0);
    assert.deepEqual(seen.details, [{ skipped: "nothing_new" }]);

    // The switch off: not even a candidate.
    await db.query(`delete from bell_seen`);
    await db.query(
      `insert into account_email_pref (account_id, kind, enabled, via)
       values ($1, 'activity_today', false, 'profile')`,
      [owner],
    );
    const off = await runActivityMail(opts);
    assert.equal(off.candidates, 0);
    assert.equal(sent.length, 1);
  } finally {
    await s.drop();
  }
});
