/**
 * Web push's drain (2026-11-16, migration 0283). Pinned here: only a
 * person with a device is told; cheers wait to settle and come as one
 * counted notice, never who; then followers, counted, never who; a kind
 * switched off is skipped; the gap and the day's cap hold; a Clan Action
 * owed by Clan's morning run goes first, once; an opened notice moves the
 * activity mail's start; a device's endpoint goes only to the outbox.
 * Synthetic names and invented tags.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { buildBellWeek } from "../../../packages/tools/src/activity/home-feed.mjs";
import {
  applyPushReceipt,
  markOpened,
  owePush,
  pushToldAt,
} from "../../../packages/tools/src/activity/push.mjs";
import {
  DAILY_CAP,
  MIN_GAP_MS,
  SETTLE_MS,
  cheersNotice,
  followersNotice,
  runWebPush,
} from "../src/push/drain.mjs";
import { oweClanActionsPush } from "../src/push/clan-actions.mjs";

const OWN = "#0QQG0JVQQ";
const FOLLOWER_PLAYER = "#0QQJJPLGU";
const ITEM = "tl_00000000000000000c01";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/drain-test";

test("notices: counts, never who; one item is named by its own text", () => {
  assert.deepEqual(
    cheersNotice([
      { fresh: 3, text: "Invented Owner played 12 battles", subject_tag: OWN },
    ]),
    {
      title: "3 cheers on your play",
      body: "Invented Owner played 12 battles",
      url: "/home/player/0QQG0JVQQ",
    },
  );
  assert.deepEqual(
    cheersNotice([
      {
        fresh: 1,
        text: "a",
        battle_url: "https://elixir.poapkings.com/battle/abc",
      },
      { fresh: 1, text: "b", battle_url: "https://evil.example/battle/x" },
    ]),
    {
      title: "2 cheers on your play",
      body: "On 2 of your battles and moments",
      url: "/home",
    },
  );
  assert.equal(
    cheersNotice([
      {
        fresh: 1,
        text: "a",
        battle_url: "https://elixir.poapkings.com/battle/abc",
      },
    ]).url,
    "/battle/abc",
  );
  assert.equal(cheersNotice([]), null);
  assert.deepEqual(
    followersNotice([{ tag: OWN, name: "Invented Owner", count: 2 }]),
    {
      title: "2 new followers",
      body: "On Invented Owner",
      url: "/home/player/0QQG0JVQQ",
    },
  );
  assert.ok(MIN_GAP_MS >= 60_000 && DAILY_CAP >= 1 && SETTLE_MS > 0);
});

test("drain: settled cheers, then followers, counted; caps, switches, owed Actions and the mail's start", async () => {
  const s = await scratchDb("web_push_drain");
  const { db } = s;
  try {
    const account = async (hash) =>
      (
        await db.query(
          `insert into account (email_hash, email, status, kind, timezone)
           values ($1, $2, 'approved', 'person', 'UTC') returning account_id`,
          [hash, `${hash}@example.com`],
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
    await buildBellWeek(db, owner, {
      own: [{ tag: OWN, name: "Invented Owner" }],
    });
    const at = new Date(Date.now() - 1_800_000).toISOString();
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
            text: "Invented Owner played 12 battles",
            facts: {},
          },
        ]),
      ],
    );

    const out = [];
    const outbox = async (lane, msg) => out.push({ lane, msg });
    let now = new Date();
    const run = (over = {}) => runWebPush({ db, outbox, now, ...over });

    // A cheer with no device: nobody is told.
    await db.query(
      `insert into timeline_cheer (account_id, item_id, cheer, subject_tags, created_at, updated_at)
       values ($1, $2, 'grind', $3, now() - interval '30 minutes', now() - interval '30 minutes')`,
      [fan, ITEM, [OWN]],
    );
    assert.equal((await run()).candidates, 0);
    assert.equal(
      await owePush(db, {
        accountId: owner,
        kind: "clan_actions",
        title: "x",
        url: "/clan",
        dedupeKey: "no-device",
      }),
      false,
    );

    // A device, turned on before the cheer.
    await db.query(
      `insert into push_subscription (account_id, endpoint, p256dh, auth, created_at)
       values ($1, $2, repeat('B', 87), repeat('a', 22), now() - interval '2 hours')`,
      [owner, ENDPOINT],
    );
    const first = await run();
    assert.equal(first.sent, 1, JSON.stringify(first));
    assert.equal(out.length, 1);
    assert.equal(out[0].lane, "web-push");
    assert.equal(out[0].msg.endpoint, ENDPOINT);
    assert.deepEqual(
      { ...out[0].msg.notice, notice_id: undefined },
      {
        notice_id: undefined,
        kind: "cheers",
        title: "1 cheer on your play",
        body: "Invented Owner played 12 battles",
        url: "/home/player/0QQG0JVQQ",
      },
    );
    // Never who, and the run's own line carries no words or endpoints.
    assert.doesNotMatch(JSON.stringify(out), /fan|Secret Follower/);
    assert.doesNotMatch(JSON.stringify(first), /googleapis|Invented/);

    // Again at once: the gap holds it.
    const again = await run();
    assert.equal(again.held, 1);
    assert.equal(out.length, 1);

    // A new follower; past the gap it comes, counted, never who.
    await db.query(
      `insert into claim (account_id, player_tag, relationship, created_at)
       values ($1, $2, 'friend', now() - interval '5 minutes')`,
      [follower, OWN],
    );
    now = new Date(Date.now() + MIN_GAP_MS + 1_000);
    const second = await run();
    assert.equal(second.sent, 1, JSON.stringify(second));
    assert.equal(out[1].msg.notice.kind, "followers");
    assert.equal(out[1].msg.notice.title, "1 new follower");
    assert.equal(out[1].msg.notice.body, "On Invented Owner");
    assert.doesNotMatch(JSON.stringify(out[1]), /Secret Follower|follower@/);

    // A cheer that has not settled waits.
    await db.query(
      `update timeline_cheer set cheer = 'ha', updated_at = $2 where account_id = $1`,
      [fan, new Date(now.getTime() - SETTLE_MS / 2)],
    );
    now = new Date(now.getTime() + MIN_GAP_MS + 1_000);
    await db.query(`update timeline_cheer set updated_at = $1`, [
      new Date(now.getTime() - SETTLE_MS / 2),
    ]);
    const unsettled = await run();
    assert.equal(unsettled.sent, 0, JSON.stringify(unsettled));

    // A Clan Action owed by the morning run goes first, once.
    assert.equal(
      await oweClanActionsPush(db, {
        accountId: owner,
        clanTag: "#J2RGCRVG",
        clanName: "POAP KINGS",
        count: 2,
        link: "https://elixir.poapkings.com/clan/J2RGCRVG/actions",
        day: "2026-11-16",
      }),
      true,
    );
    assert.equal(
      await oweClanActionsPush(db, {
        accountId: owner,
        clanTag: "#J2RGCRVG",
        clanName: "POAP KINGS",
        count: 2,
        link: "https://elixir.poapkings.com/clan/J2RGCRVG/actions",
        day: "2026-11-16",
      }),
      false,
    );
    const owed = await run();
    assert.equal(owed.sent, 1);
    assert.deepEqual(
      { ...out[2].msg.notice, notice_id: undefined },
      {
        notice_id: undefined,
        kind: "clan_actions",
        title: "2 Clan Actions are waiting for you",
        body: "In POAP KINGS",
        url: "/clan/J2RGCRVG/actions",
      },
    );

    // Cheers switched off: a settled cheer is not told.
    await db.query(
      `insert into account_push_pref (account_id, kind, enabled) values ($1, 'cheers', false)`,
      [owner],
    );
    now = new Date(now.getTime() + MIN_GAP_MS + SETTLE_MS);
    assert.equal((await run()).sent, 0);

    // The day's cap holds everything.
    await db.query(`delete from account_push_pref`);
    await db.query(
      `insert into push_notice (account_id, kind, title, url, through, status, sent_at)
       select $1, 'answers', 'x', '/home', now(), 'sent', now() - interval '1 hour'
         from generate_series(1, $2)`,
      [owner, DAILY_CAP],
    );
    const capped = await run();
    assert.equal(capped.held, 1, JSON.stringify(capped));

    // An opened cheers notice moves the activity mail's start to it.
    const cheersId = out[0].msg.notice.notice_id;
    assert.equal(await markOpened(db, fan, cheersId), false);
    assert.equal(await markOpened(db, owner, cheersId), true);
    const told = await pushToldAt(db, owner);
    assert.ok(told.cheers);
    assert.equal(told.followers, null);

    // An agent with a device is never a candidate.
    const agent = (
      await db.query(
        `insert into account (kind, owned_by_account_id, status, role)
         values ('agent', $1, 'approved', 'member') returning account_id`,
        [owner],
      )
    ).rows[0].account_id;
    await db.query(
      `insert into push_subscription (account_id, endpoint, p256dh, auth)
       values ($1, 'https://fcm.googleapis.com/fcm/send/agent', repeat('B', 87), repeat('a', 22))`,
      [agent],
    );
    assert.equal((await run({ accountId: agent })).candidates, 0);

    // The relay's receipts: a send stamps the device, a gone deletes it.
    const { subscription_id } = out[0].msg;
    assert.deepEqual(
      await applyPushReceipt(db, { v: 1, subscription_id, outcome: "sent" }),
      { outcome: "sent", updated: 1 },
    );
    assert.equal(
      await applyPushReceipt(db, { v: 1, subscription_id, outcome: "who" }),
      null,
    );
    assert.deepEqual(
      await applyPushReceipt(db, { v: 1, subscription_id, outcome: "gone" }),
      { outcome: "gone", deleted: 1 },
    );
    assert.equal((await run({ accountId: owner })).candidates, 0);
  } finally {
    await s.drop();
  }
});

test("drain: a notice stays sending until every device's relay object is written, and the next run finishes it", async () => {
  const s = await scratchDb("web_push_retry");
  const { db } = s;
  try {
    const {
      rows: [{ account_id: owner }],
    } = await db.query(
      `insert into account (email_hash, email, status, kind, timezone)
       values ('retry', 'retry@example.com', 'approved', 'person', 'UTC')
       returning account_id`,
    );
    await db.query(
      `insert into push_subscription (account_id, endpoint, p256dh, auth)
       values ($1, $2, repeat('B', 87), repeat('a', 22)),
              ($1, $3, repeat('B', 87), repeat('a', 22))`,
      [owner, `${ENDPOINT}-a`, `${ENDPOINT}-b`],
    );
    await oweClanActionsPush(db, {
      accountId: owner,
      clanTag: "#J2RGCRVG",
      clanName: "POAP KINGS",
      count: 1,
      link: "https://elixir.poapkings.com/clan/J2RGCRVG/actions",
      day: "2026-11-17",
    });

    // The second device's write fails: the first is written, the second
    // stays pending, and the notice is not sent yet.
    const out = [];
    let failOn = 2;
    const outbox = async (lane, msg) => {
      if (--failOn === 0) throw new Error("s3 down");
      out.push(msg);
    };
    const now = new Date();
    const first = await runWebPush({ db, outbox, now });
    assert.equal(first.sent, 1);
    assert.equal(first.waiting, 1);
    assert.deepEqual(
      out.map((m) => m.endpoint),
      [`${ENDPOINT}-a`],
    );
    const {
      rows: [n],
    } = await db.query(
      `select status, cardinality(pending)::int as left from push_notice`,
    );
    assert.deepEqual(n, { status: "sending", left: 1 });

    // The next run writes only what is left and tells nothing new; the
    // sending notice already counts for the gap and the day's cap.
    const second = await runWebPush({ db, outbox, now });
    assert.equal(second.resumed, 1);
    assert.equal(second.sent, 0);
    assert.deepEqual(
      out.map((m) => m.endpoint),
      [`${ENDPOINT}-a`, `${ENDPOINT}-b`],
    );
    assert.equal(out[0].notice.notice_id, out[1].notice.notice_id);
    const {
      rows: [after],
    } = await db.query(
      `select status, cardinality(pending)::int as left from push_notice`,
    );
    assert.deepEqual(after, { status: "sent", left: 0 });
    assert.equal((await runWebPush({ db, outbox, now })).resumed, 0);
    assert.equal(out.length, 2);
  } finally {
    await s.drop();
  }
});
