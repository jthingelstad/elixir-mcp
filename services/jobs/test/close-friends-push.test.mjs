/**
 * Web push's "Close friends' play" (2026-11-17, migration 0284), against a
 * real PostgreSQL database. Pinned here, each rule by a test that fails
 * without it: a session is told once it is over and never again, not even
 * when it later grows; never mid-session; never a short session the
 * Timeline folds; friends finishing together are one notice; the kind's
 * own day cap; its switch; no device, no notice; a block either way stops
 * it; a backfilled old session is never told; the relay's payload holds no
 * nickname and no close-mark data. Synthetic names and invented tags.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { emitEvent } from "../../../packages/ingest/src/events.mjs";
import { runWebPush } from "../src/push/drain.mjs";
import {
  CLOSE_DAILY_CAP,
  CANDIDATES_SQL,
  CLOSE_TIMELINE,
  candidateParams,
  closeCandidates,
  worthTelling,
} from "../src/push/close-friends.mjs";

const F = "#0QQG0JVQQ"; // a close friend
const G = "#0QQJJPLGU"; // a second close friend
const H = "#0RQYGC2L"; // a third close friend
const N = "#0GUQ28PV"; // followed, not starred
const MIN = 60_000;

async function setup(name) {
  const s = await scratchDb(name);
  const { db } = s;
  const account = async (hash) =>
    (
      await db.query(
        `insert into account (email_hash, email, status, kind, timezone)
         values ($1, $2, 'approved', 'person', 'UTC') returning account_id`,
        [hash, `${hash}@example.com`],
      )
    ).rows[0].account_id;
  const names = {
    [F]: "Pip Ember",
    [G]: "Ash Lark",
    [H]: "Rue Tally",
    [N]: "Not Starred",
  };
  for (const [tag, n] of Object.entries(names))
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      n,
    ]);
  const owner = await account("cf-owner");
  const friendAccount = await account("cf-friend");
  // The friend's own account owns F (a block names it).
  await db.query(
    `insert into claim (account_id, player_tag, is_primary, relationship, status, verified_at)
     values ($1, $2, true, 'primary', 'verified', now())`,
    [friendAccount, F],
  );
  const follow = (account, tag, close) =>
    db.query(
      `insert into claim (account_id, player_tag, relationship, status, close)
       values ($1, $2, 'friend', 'unverified', $3)`,
      [account, tag, close],
    );
  for (const t of [F, G, H]) await follow(owner, t, true);
  await follow(owner, N, false);
  let deviceN = 0;
  const device = (account, created = new Date(Date.now() - 6 * 3_600_000)) =>
    db.query(
      `insert into push_subscription (account_id, endpoint, p256dh, auth, created_at)
       values ($1, $2, repeat('B', 87), repeat('a', 22), $3)`,
      [
        account,
        `https://fcm.googleapis.com/fcm/send/cf-${(deviceN += 1)}`,
        created,
      ],
    );
  let battleN = 0;
  /** One battle of `tag`'s at `atMs`, on Trophy Road unless told. */
  const battle = async (
    tag,
    atMs,
    { outcome = "win", eventTag = null, league = null } = {},
  ) => {
    const id = `cf-${(battleN += 1)}`;
    const at = new Date(atMs).toISOString();
    const type = eventTag ? "challenge" : league ? "pathOfLegend" : "PvP";
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class, event_tag, league_number)
       values ($1, $2, $3, 'pvp', $4, $5)`,
      [id, at, type, eventTag, league],
    );
    await db.query(
      `insert into battle_participant
         (battle_id, player_tag, side, battle_time, outcome, type, type_class, trophy_change)
       values ($1, $2, 0, $3, $4, $5, 'pvp', $6)`,
      [
        id,
        tag,
        at,
        outcome,
        type,
        eventTag ? null : outcome === "win" ? 30 : -29,
      ],
    );
    return id;
  };
  /** `n` battles of `tag`'s, five minutes apart, the last at `endMs`. */
  const session = async (tag, endMs, n, outcomes = []) => {
    for (let i = n - 1; i >= 0; i--)
      await battle(tag, endMs - i * 5 * MIN, {
        outcome: outcomes[n - 1 - i] ?? "win",
      });
  };
  const out = [];
  const outbox = async (lane, msg) => out.push({ lane, msg });
  const run = (now) => runWebPush({ db, outbox, now: new Date(now) });
  const notices = async (kind = "close_friends") =>
    (
      await db.query(
        `select title, body, url, told from push_notice
          where kind = $1 order by created_at, notice_id`,
        [kind],
      )
    ).rows;
  return {
    s,
    db,
    owner,
    friendAccount,
    device,
    battle,
    session,
    out,
    run,
    notices,
    account,
    follow,
  };
}

test("worth telling: three battles, or a short one with a climb or a long run", () => {
  const s = (facts) => ({ kind: "battle_session", facts });
  assert.equal(worthTelling(s({ battles: 3 })), true);
  assert.equal(worthTelling(s({ battles: 2 })), false);
  assert.equal(worthTelling(s({ battles: 1, by_mode: { ranked: 1 } })), false);
  assert.equal(
    worthTelling(
      s({
        battles: 1,
        ranked: {
          promotions: [{ from_name: "Challenger I", to_name: "Challenger II" }],
        },
      }),
    ),
    true,
  );
  assert.equal(
    worthTelling(
      s({ battles: 2, events: [{ name: "Classic Challenge", run_wins: 5 }] }),
    ),
    true,
  );
  assert.equal(
    worthTelling(
      s({ battles: 2, events: [{ name: "Classic Challenge", run_wins: 4 }] }),
    ),
    false,
  );
  assert.equal(
    worthTelling({ kind: "best_trophies_band", facts: { battles: 9 } }),
    false,
  );
});

test("a session is told once it is over, once, never again when it grows; never mid-session or short", async () => {
  const t = await setup("close_push_once");
  try {
    const T0 = Date.now();
    await t.device(t.owner);
    // F plays four battles (three wins) ending at T0; N (not starred) too.
    await t.session(F, T0, 4, ["win", "win", "loss", "win"]);
    await t.session(N, T0, 5);
    // G plays two battles: short, folded on the Timeline, never told.
    await t.session(G, T0, 2);

    // Mid-session (10 minutes after the last battle): nothing.
    await t.run(T0 + 10 * MIN);
    assert.equal((await t.notices()).length, 0, "not mid-session");
    // Over (30 minutes) but within the settle: still nothing.
    await t.run(T0 + 31 * MIN);
    assert.equal((await t.notices()).length, 0, "settles first");

    const told = await t.run(T0 + 36 * MIN);
    assert.equal(told.sent, 1, JSON.stringify(told));
    const [n] = await t.notices();
    assert.equal(n.title, "Pip Ember");
    assert.equal(n.body, "Won 3 of 4 on Trophy Road");
    assert.match(
      n.url,
      /^\/home\/player\/0QQG0JVQQ\/session\/tl_[0-9a-f]+\?at=/,
    );
    assert.deepEqual(
      n.told.map((x) => x.tag),
      [F],
    );

    // Told once: the next runs say nothing more about it.
    await t.run(T0 + 50 * MIN);
    await t.run(T0 + 65 * MIN);
    assert.equal((await t.notices()).length, 1, "told once");

    // A battle learned late joins the session (20 minutes after its
    // end): the stored session grew, and it is not told again.
    await t.battle(F, T0 + 20 * MIN);
    await t.run(T0 + 80 * MIN);
    await t.run(T0 + 95 * MIN);
    assert.equal(
      (await t.notices()).length,
      1,
      "a grown session is not told again",
    );

    // A new session after it (an hour later) is a new story.
    await t.session(F, T0 + 120 * MIN, 3);
    await t.run(T0 + 156 * MIN);
    const all = await t.notices();
    assert.equal(all.length, 2);
    assert.equal(all[1].body, "Won 3 of 3 on Trophy Road, 3 in a row");
    // Nothing about G's short session or N, who is not starred.
    assert.ok(
      all.every((x) => !/Ash Lark|Not Starred/.test(`${x.title} ${x.body}`)),
    );
  } finally {
    await t.s.drop();
  }
});

test("friends finishing together are one notice opening the Timeline on Close friends", async () => {
  const t = await setup("close_push_coalesce");
  try {
    const T0 = Date.now();
    await t.device(t.owner);
    await t.session(F, T0, 3);
    await t.session(G, T0 + 2 * MIN, 4);
    await t.session(H, T0 + 3 * MIN, 5);
    // F's session is over and settled by itself at T0 + 36; G and H are
    // within the settle, so the run waits for them.
    await t.run(T0 + 36 * MIN);
    assert.equal(
      (await t.notices()).length,
      0,
      "waits for friends finishing together",
    );
    const r = await t.run(T0 + 39 * MIN);
    assert.equal(r.sent, 1);
    const [n] = await t.notices();
    assert.equal(n.title, "Rue Tally and 2 other close friends played");
    assert.equal(n.url, CLOSE_TIMELINE);
    assert.match(
      n.body,
      /^Rue Tally: Won 5 of 5 on Trophy Road, 5 in a row\. Ash Lark: /,
    );
    assert.deepEqual(n.told.map((x) => x.tag).sort(), [F, G, H].sort());
    // The relay's object: the notice's own words and path, nothing else.
    const msg = t.out.at(-1).msg;
    assert.deepEqual(Object.keys(msg.notice).sort(), [
      "body",
      "kind",
      "notice_id",
      "title",
      "url",
    ]);
    assert.equal(msg.notice.kind, "close_friends");
    assert.doesNotMatch(
      JSON.stringify(msg),
      /told|0QQG0JVQQ|0QQJJPLGU|0RQYGC2L/,
    );
  } finally {
    await t.s.drop();
  }
});

test("the kind's own day cap, the drain's gap, the switch, no device, a block either way", async () => {
  const t = await setup("close_push_caps");
  try {
    // sent_at is the database's clock, so the runs start at it.
    const T0 = Date.now();
    // No device: never a candidate.
    await t.session(F, T0, 3);
    assert.equal(
      (await closeCandidates(t.db, { now: new Date(T0 + 40 * MIN) })).size,
      0,
    );
    await t.run(T0 + 40 * MIN);
    assert.equal((await t.notices()).length, 0, "no device, no notice");

    await t.device(t.owner, new Date(T0 - 3_600_000));
    await t.run(T0 + 41 * MIN);
    assert.equal((await t.notices()).length, 1, "told once a device is there");
    // Four more sessions an hour apart, each by one friend: only the
    // cap's worth are told in a day.
    const friends = [G, H, F, G];
    for (const [i, tag] of friends.entries())
      await t.session(tag, T0 + (i + 1) * 60 * MIN, 3);
    for (let i = 1; i <= friends.length; i++)
      await t.run(T0 + i * 60 * MIN + 40 * MIN);
    assert.equal(
      (await t.notices()).length,
      CLOSE_DAILY_CAP,
      "the kind's day cap",
    );
  } finally {
    await t.s.drop();
  }

  const u = await setup("close_push_switch");
  try {
    const T0 = Date.now();
    await u.device(u.owner);
    await u.db.query(
      `insert into account_push_pref (account_id, kind, enabled) values ($1, 'close_friends', false)`,
      [u.owner],
    );
    await u.session(F, T0, 3);
    await u.run(T0 + 40 * MIN);
    assert.equal((await u.notices()).length, 0, "switched off");
    await u.db.query(`delete from account_push_pref where account_id = $1`, [
      u.owner,
    ]);
    // A block, the owner's way: nothing.
    await u.db.query(
      `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
      [u.owner, u.friendAccount],
    );
    await u.run(T0 + 41 * MIN);
    assert.equal((await u.notices()).length, 0, "blocked by the owner");
    // The other way round: nothing either.
    await u.db.query(`delete from account_block`);
    await u.db.query(
      `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
      [u.friendAccount, u.owner],
    );
    await u.run(T0 + 42 * MIN);
    assert.equal((await u.notices()).length, 0, "blocked by the friend");
    // No block: told.
    await u.db.query(`delete from account_block`);
    await u.run(T0 + 43 * MIN);
    assert.equal((await u.notices()).length, 1);
  } finally {
    await u.s.drop();
  }
});

test("the gap: another kind told just now holds close friends for ten minutes", async () => {
  const t = await setup("close_push_gap");
  try {
    const T0 = Date.now();
    await t.device(t.owner);
    await t.db.query(
      `insert into push_notice (account_id, kind, title, url, through, status, sent_at)
       values ($1, 'answers', 'x', '/settings/feedback', $2, 'sent', $2)`,
      [t.owner, new Date(T0 + 35 * MIN)],
    );
    await t.session(F, T0, 3);
    const held = await t.run(T0 + 40 * MIN);
    assert.equal(held.held, 1);
    assert.equal((await t.notices()).length, 0);
    await t.run(T0 + 46 * MIN);
    assert.equal((await t.notices()).length, 1);
  } finally {
    await t.s.drop();
  }
});

test("a backfilled old session is never told; a moment is told by the timeline's sentence", async () => {
  const t = await setup("close_push_old");
  try {
    const T0 = Date.now();
    await t.device(t.owner, new Date(T0 - 24 * 3_600_000));
    // Learned now, played five hours ago: not activity.
    await t.session(F, T0 - 5 * 3_600_000, 6);
    await t.run(T0);
    await t.run(T0 + 20 * MIN);
    assert.equal((await t.notices()).length, 0, "a backfill is not activity");

    // A new best for G in a one-battle session (too short to tell on its
    // own): told by the timeline's sentence, once, opening the battle.
    const crossing = await t.battle(G, T0 - 5 * MIN);
    const at = new Date(T0 - 5 * MIN).toISOString();
    await emitEvent(t.db, "best_trophies_band", {
      tag: G,
      payload: {
        best: 7000,
        band: 7000,
        crossed_by: {
          battle_id: crossing,
          battle_time: at,
          type: "PvP",
          opponent: {
            player_tag: "#0UCRRQJCP",
            name: "Stoatling",
            starting_trophies: 6990,
          },
          crowns: 3,
          crowns_against: 0,
          trophy_change: 30,
          trophies_after: 7000,
        },
      },
      windowStart: new Date(T0 - 10 * MIN),
      windowEnd: new Date(T0 - 2 * MIN),
      occurredAt: at,
    });
    await t.run(T0 + 10 * MIN);
    assert.equal(
      (await t.notices()).length,
      0,
      "not while the session is open",
    );
    await t.run(T0 + 30 * MIN);
    const [n] = await t.notices();
    assert.ok(n, "the moment is told");
    assert.equal(n.title, "Ash Lark");
    // The timeline's own sentence (the fixture's battle has no crowns or
    // opponent rows), opening the battle that crossed it.
    assert.match(
      n.body,
      /^Ash Lark set a new best of 7,000 trophies, crossing 7,000/,
    );
    assert.equal(n.url, `/battle/${crossing}`);
    await t.run(T0 + 45 * MIN);
    assert.equal((await t.notices()).length, 1, "a moment is told once");
  } finally {
    await t.s.drop();
  }
});

test("a short Ranked session whose battles show a climb is told, with no profile event yet (Codex on #1090)", async () => {
  const t = await setup("close_push_ranked");
  try {
    const T0 = Date.now();
    await t.device(t.owner);
    // Two Ranked battles: a win at league 3, then one at league 4.
    await t.battle(F, T0 - 5 * MIN, { league: 3 });
    await t.battle(F, T0, { league: 4, outcome: "loss" });
    await t.run(T0 + 36 * MIN);
    const [n] = await t.notices();
    assert.ok(n, "the climb is told");
    assert.equal(n.title, "Pip Ember");
    assert.match(n.body, /\. Climbed .+ to .+$/);
    assert.match(n.url, /^\/home\/player\/0QQG0JVQQ\/session\//);
  } finally {
    await t.s.drop();
  }
});

test("a notice left sending is not delivered after a block or an unstar (Codex on #1090)", async () => {
  for (const change of ["block", "unstar"]) {
    const t = await setup(`close_push_retry_${change}`);
    try {
      const T0 = Date.now();
      await t.device(t.owner);
      await t.session(F, T0, 3);
      // The outbox write fails: the notice stays sending, owed.
      const down = async () => {
        throw new Error("outbox down");
      };
      await runWebPush({
        db: t.db,
        outbox: down,
        now: new Date(T0 + 36 * MIN),
      });
      const [owed] = (
        await t.db.query(
          `select status from push_notice where kind = 'close_friends'`,
        )
      ).rows;
      assert.equal(owed.status, "sending");
      if (change === "block")
        await t.db.query(
          `insert into account_block (account_id, blocked_account_id) values ($1, $2)`,
          [t.friendAccount, t.owner],
        );
      else
        await t.db.query(
          `update claim set close = false where account_id = $1 and player_tag = $2`,
          [t.owner, F],
        );
      // The next run resumes what was owed: nothing goes out.
      await t.run(T0 + 37 * MIN);
      assert.equal(t.out.length, 0, change);
      const [after] = (
        await t.db.query(
          `select status from push_notice where kind = 'close_friends'`,
        )
      ).rows;
      assert.equal(after.status, "dropped", change);
    } finally {
      await t.s.drop();
    }
  }
});

test("names: the game's name, never the owner's nickname or anyone else's", async () => {
  const t = await setup("close_push_names");
  try {
    const T0 = Date.now();
    await t.device(t.owner);
    const other = await t.account("cf-other");
    await t.db.query(
      `insert into player_nickname (account_id, player_tag, nickname)
       values ($1, $3, 'Owner Calls Them'), ($2, $3, 'Other Calls Them')`,
      [t.owner, other, F],
    );
    // Another account follows F without a star, with a device: never told.
    await t.follow(other, F, false);
    await t.device(other);
    await t.session(F, T0, 3);
    await t.run(T0 + 40 * MIN);
    const rows = (
      await t.db.query(`select account_id, title, body from push_notice`)
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].account_id, t.owner);
    assert.equal(rows[0].title, "Pip Ember");
    assert.doesNotMatch(JSON.stringify(t.out), /Calls Them/);
  } finally {
    await t.s.drop();
  }
});

test("the candidate read at a few thousand accounts: bounded and index-backed", async () => {
  const t = await setup("close_push_scale");
  try {
    const { db } = t;
    const T0 = Date.now();
    // 3,000 accounts, 400 with a device; 1,500 players, a week of battles
    // for each (about 30,000 rows); every account follows 20 and stars 3.
    await db.query(
      `insert into account (email_hash, email, status, kind, timezone)
       select 'scale-' || i, 'scale-' || i || '@example.com', 'approved', 'person', 'UTC'
         from generate_series(1, 3000) i`,
    );
    await db.query(
      `insert into player (player_tag, name)
       select '#0' || translate(lpad(i::text, 5, '0'), '0123456789', '289PYLQGRJ'), 'Scale ' || i from generate_series(1, 1500) i`,
    );
    await db.query(
      `insert into battle (battle_id, battle_time, type, type_class)
       select 'sc-' || p || '-' || k, $1::timestamptz - make_interval(mins => (k * 337 + p * 7) % 10080), 'PvP', 'pvp'
         from generate_series(1, 1500) p, generate_series(1, 20) k`,
      [new Date(T0)],
    );
    await db.query(
      `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class)
       select b.battle_id, '#0' || translate(lpad(split_part(b.battle_id, '-', 2)::int::text, 5, '0'), '0123456789', '289PYLQGRJ'), 0, b.battle_time, 'win', 'PvP', 'pvp'
         from battle b where b.battle_id like 'sc-%'`,
    );
    await db.query(
      `insert into claim (account_id, player_tag, relationship, status, close)
       select a.account_id, '#0' || translate(lpad((1 + (a.n * 13 + k * 71) % 1500)::text, 5, '0'), '0123456789', '289PYLQGRJ'), 'friend', 'unverified', k <= 3
         from (select account_id, row_number() over (order by account_id) as n
                 from account where email_hash like 'scale-%') a,
              generate_series(1, 20) k
       on conflict do nothing`,
    );
    await db.query(
      `insert into push_subscription (account_id, endpoint, p256dh, auth)
       select account_id, 'https://fcm.googleapis.com/fcm/send/scale-' || n, repeat('B', 87), repeat('a', 22)
         from (select account_id, row_number() over (order by account_id) as n
                 from account where email_hash like 'scale-%') a
        where n <= 400`,
    );
    // A month of moments for every player, and a month of notices for
    // every device, so the plan meets tables of a real shape.
    await db.query(
      `insert into player_event (player_tag, event_type, timing, window_start, window_end, value_after, step)
       select p.player_tag, 'career_wins_step', 'estimated',
              $1::timestamptz - make_interval(hours => k * 36 + 1),
              $1::timestamptz - make_interval(hours => k * 36),
              1000 * k, 1000 * k
         from player p, generate_series(1, 20) k
        where p.name like 'Scale %'`,
      [new Date(T0)],
    );
    await db.query(
      `insert into push_notice (account_id, kind, title, url, through, status, created_at, sent_at)
       select s.account_id, 'cheers', '2 cheers', '/timeline', t, 'sent', t, t
         from push_subscription s,
              lateral (select $1::timestamptz - make_interval(hours => k * 30) as t
                         from generate_series(1, 20) k) x`,
      [new Date(T0)],
    );
    await db.query(`analyze`);
    const now = new Date(T0);
    const started = Date.now();
    const got = await closeCandidates(db, { now });
    const took = Date.now() - started;
    assert.ok(got instanceof Map);
    // Load-sensitive locally: a generous bound that a full scan of the
    // week's battles for every mark would still miss on a busy laptop.
    assert.ok(took < 5_000, `closeCandidates took ${took} ms`);
    // The plan: the record's big tables are read only by their indexes,
    // never scanned whole.
    const { rows } = await db.query(
      `explain (format json) ${CANDIDATES_SQL}`,
      candidateParams(now),
    );
    const scans = [];
    const walk = (node) => {
      if (node["Relation Name"])
        scans.push(`${node["Node Type"]}:${node["Relation Name"]}`);
      // The two record reads are per player: their index condition
      // names the player, never a range over everyone's recent rows.
      if (
        ["battle_participant", "player_event"].includes(node["Relation Name"])
      )
        assert.match(
          node["Index Cond"] ?? "",
          /player_tag =/,
          node["Relation Name"],
        );
      for (const c of node.Plans ?? []) walk(c);
    };
    walk(rows[0]["QUERY PLAN"][0].Plan);
    for (const big of [
      "battle_participant",
      "player_event",
      "claim",
      "push_notice",
      "battle",
    ])
      assert.ok(
        !scans.includes(`Seq Scan:${big}`),
        `${big} is scanned whole: ${scans.join(", ")}`,
      );
    assert.ok(
      scans.some((x) => /Index.*:battle_participant/.test(x)),
      scans.join(", "),
    );
  } finally {
    await t.s.drop();
  }
});
