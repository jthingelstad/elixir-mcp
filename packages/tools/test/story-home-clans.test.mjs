/**
 * Home's week with followed clans from their stored stories (stage 6 of
 * the stored Timeline, 2026-11-27;
 * docs/notes/2026-11-27-timeline-story-home-clans.md): readClansStories
 * refuses what readPlayersStories refuses, plus `basis` and `open`; the
 * sweep and the staleness op count a clan stored open; buildTimeline's
 * `storedClans` cuts each served clan's window for its subject's scope and
 * the finished week is the built one, item for item; buildHomeWeek's
 * `storyClans` applies only while `storyBuild` is on, and its shadow never
 * fails the stored week. On a scratch database (golden rule 9). Invented
 * tags throughout (docs/invented-tags.json).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  finishedHash,
  readClansStories,
  storiesToWake,
  storySpan,
  storyStaleness,
  writeSubjectStories,
} from "../src/activity/story-store.mjs";
import {
  buildTimeline,
  followedAccountIds,
  subjectsFor,
} from "../src/activity/entries.mjs";
import {
  HOME_WEEK_MS,
  buildHomeWeek,
  readHomeWeek,
  storyClansBuildOf,
} from "../src/activity/home-feed.mjs";

const K1 = "#0UCRL20"; // followed at comprehensive scope
const K2 = "#0UCRL22"; // followed at activity scope
const K3 = "#0UCRL28"; // followed, never written
const STREAK = "#0UCRL29"; // K1: five wins in a row two days ago
const GONE = "#0UCRL2P"; // K1: crosses the five-day quiet rung
const ROLE = "#0UCRL2Y"; // K1: promoted to Elder in the week
const RUN = "#0UCRL2L"; // K2: five wins in a row yesterday
const BACK = "#0UCRL2Q"; // K2: returns after ten days (activity hides it)
const OPEN = "#0UCRL2G"; // K2: a sitting still going at the write
const P = "#0UCRL2R"; // a followed player, recorded and written
const MIN = 60_000;
const H = 60 * MIN;
const DAY = 24 * H;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

let ctx;
let db;
let reader;
let subjects;
let accounts;
let seq = 0;

async function battle(player, clan, playedMs, learnedMs, outcome = "win") {
  seq += 1;
  const id = `story-home-clans-${seq}`;
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $3)`,
    [id, iso(playedMs), iso(learnedMs)],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side,
       type, type_class, crowns, trophy_change, outcome, clan_tag)
     values ($1, $2, $3, 0, 'PvP', 'pvp', $4, $5, $6, $7)`,
    [
      id,
      player,
      iso(playedMs),
      outcome === "win" ? 3 : 0,
      outcome === "win" ? 30 : -30,
      outcome,
      clan,
    ],
  );
}

async function member(clan, tag, name) {
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    tag,
    name,
  ]);
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
     values ($1, $2, 'member', $3)`,
    [clan, tag, iso(NOW - 60 * DAY)],
  );
}

const writeClans = async (now = Date.now()) => {
  for (const tag of [K1, K2])
    await writeSubjectStories(db, "clan", tag, storySpan(now, "clan"));
};
const writePlayer = () =>
  writeSubjectStories(db, "player", P, storySpan(Date.now()));

/** Home's own options (home-feed.mjs buildHomeWeek). */
const homeOptions = (toMs = Date.now()) => ({
  fromMs: toMs - HOME_WEEK_MS,
  toMs,
  timezone: "America/Chicago",
  accountId: reader,
  interactive: true,
  accountLines: false,
  lateCounts: false,
  people: { accounts, players: true },
  basis: "observed",
});
const built = (toMs) => buildTimeline(db, subjects, homeOptions(toMs));
const fromRows = (toMs, { read = readClansStories, now = Date.now() } = {}) =>
  buildTimeline(db, subjects, {
    ...homeOptions(toMs),
    storedClans: { read, now },
  });
/** A week's items as a reader gets them: id, revision, what was said,
 *  in order. */
const told = (week) =>
  week.timeline.map((it) => [it.id, it.revision, finishedHash(it)]);

before(async () => {
  ctx = await scratchDb("story_home_clans");
  db = ctx.db;
  await db.query(
    `insert into clan (clan_tag, name)
     values ($1, 'Grove'), ($2, 'Thicket'), ($3, 'Glade')`,
    [K1, K2, K3],
  );
  for (const [clan, tag, name] of [
    [K1, STREAK, "streak"],
    [K1, GONE, "gone"],
    [K1, ROLE, "role"],
    [K2, RUN, "run"],
    [K2, BACK, "back"],
    [K2, OPEN, "open"],
  ])
    await member(clan, tag, name);
  await db.query(`insert into player (player_tag, name) values ($1, 'Ash')`, [
    P,
  ]);
  const account = async (hash) =>
    (
      await db.query(
        `insert into account (email_hash, status, timezone)
         values ($1, 'approved', 'America/Chicago') returning account_id`,
        [hash],
      )
    ).rows[0].account_id;
  reader = await account("story-home-clans-reader");
  const owner = await account("story-home-clans-owner");
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, origin)
     values ('player', $1, $2, 'claim')`,
    [P, owner],
  );
  await db.query(
    `insert into claim (account_id, player_tag, relationship, notify)
     values ($1, $2, 'friend', true)`,
    [reader, P],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, notify)
     values ($1, $2, 'comprehensive', true), ($1, $3, 'activity', true),
            ($1, $4, 'comprehensive', true)`,
    [reader, K1, K2, K3],
  );
  // K1: a sitting of five wins two days ago, a quiet member, a promotion.
  const sitting = NOW - 2 * DAY - 2 * H;
  for (let i = 0; i < 5; i += 1)
    await battle(STREAK, K1, sitting + i * 4 * MIN, NOW - 2 * DAY);
  await battle(GONE, K1, NOW - 6 * DAY, NOW - 6 * DAY + MIN, "loss");
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start,
       window_end, occurred_at, player_tag, role_before, role_after)
     values ($1, 'role_changed', 'estimated', $2, $3, $4, $5, 'member', 'elder')`,
    [K1, iso(NOW - 3 * DAY - H), iso(NOW - 3 * DAY), iso(NOW - 3 * DAY), ROLE],
  );
  // K2: five wins yesterday, and a return after ten days away.
  const run = NOW - DAY - 3 * H;
  for (let i = 0; i < 5; i += 1)
    await battle(RUN, K2, run + i * 4 * MIN, NOW - DAY);
  await battle(BACK, K2, NOW - 13 * DAY, NOW - 13 * DAY + MIN);
  await battle(BACK, K2, NOW - 3 * DAY, NOW - 3 * DAY + MIN);
  // P: a sitting yesterday.
  await battle(P, null, NOW - DAY, NOW - DAY + MIN);
  await battle(P, null, NOW - DAY + 5 * MIN, NOW - DAY + 6 * MIN);
  subjects = await subjectsFor(db, reader);
  accounts = await followedAccountIds(db, reader);
  await writeClans();
  await writePlayer();
});

after(async () => {
  await ctx?.drop();
});

test("the reader's subjects: three clans at their scopes and one player", () => {
  const clans = subjects.filter((s) => s.kind === "clan");
  assert.deepEqual(
    clans.map((s) => [s.tag, s.scope]).sort(),
    [
      [K1, "comprehensive"],
      [K2, "activity"],
      [K3, "comprehensive"],
    ].sort(),
  );
  assert.ok(subjects.some((s) => s.kind !== "clan" && s.tag === P));
});

test("the week from clan rows is the built week, item for item", async () => {
  const toMs = Date.now();
  const plain = await built(toMs);
  const mix = await fromRows(toMs);
  assert.equal(mix.stored_clans.stored, 2, JSON.stringify(mix.stored_clans));
  assert.deepEqual(mix.stored_clans.computed, { unwritten: 1 });
  assert.ok(plain.timeline.some((it) => it.kind === "session_standout"));
  assert.ok(plain.timeline.some((it) => it.kind === "member_role_changed"));
  assert.ok(plain.timeline.some((it) => it.kind === "quiet_crossed"));
  // Activity scope: K2's return is never told.
  assert.ok(!plain.timeline.some((it) => it.kind === "returned"));
  assert.ok(plain.timeline.some((it) => it.subject_tag === P));
  assert.deepEqual(told(mix), told(plain));
  assert.deepEqual(mix.timeline, plain.timeline);
  assert.equal(mix.timeline_more, plain.timeline_more);
  // A served clan has no entry; the unwritten one is built.
  const entryTags = mix.entries.map((e) => e.subject_tag ?? e.tag);
  assert.ok(!entryTags.includes(K1) && !entryTags.includes(K2));
  assert.ok(entryTags.includes(K3));
  // Per clan, the ids its subject told, in a Map of clan tags alone.
  assert.deepEqual([...mix.clan_told.keys()].sort(), [K1, K2, K3].sort());
  assert.ok(mix.stored_clans_written.has(K1));
  assert.ok(!mix.stored_clans_written.has(P));
});

test("each clan refusal, from the players' code", async () => {
  const reasons = async (opts) => {
    const out = await readClansStories(db, [K1, K2, K3], {
      fromMs: Date.now() - HOME_WEEK_MS,
      toMs: Date.now(),
      ...opts,
    });
    return [K1, K2, K3].map((t) => out.get(t).reason ?? "ok");
  };
  assert.deepEqual(await reasons({}), ["ok", "ok", "unwritten"]);
  const later = Date.now() + 7 * H;
  assert.deepEqual(
    await reasons({ now: later, toMs: later, fromMs: later - HOME_WEEK_MS }),
    ["stale", "stale", "unwritten"],
  );
  assert.deepEqual(await reasons({ fromMs: Date.now() - 9 * DAY }), [
    "span",
    "span",
    "unwritten",
  ]);
  assert.deepEqual(await reasons({ toMs: Date.now() - 2 * MIN }), [
    "past",
    "past",
    "unwritten",
  ]);
  assert.deepEqual(await reasons({ basis: "occurred" }), [
    "basis",
    "basis",
    "unwritten",
  ]);
  assert.deepEqual(await reasons({ probesMs: 0 }), [
    "budget",
    "budget",
    "unwritten",
  ]);
  // A served clan's rows are restored and uncut (a superset).
  const ok = (
    await readClansStories(db, [K1], {
      fromMs: Date.now() - HOME_WEEK_MS,
      toMs: Date.now(),
    })
  ).get(K1);
  assert.ok(ok.ok && ok.items.length > 0);
  assert.equal(typeof ok.written_at, "string");
  // news: K1's record learned a battle after its write.
  await battle(STREAK, K1, Date.now() - 10 * DAY, Date.now());
  assert.deepEqual(await reasons({ now: Date.now() + MIN }), [
    "news",
    "ok",
    "unwritten",
  ]);
  await writeClans();
});

test("a failed or timed-out clan read builds every clan, reason error", async () => {
  const toMs = Date.now();
  const plain = await built(toMs);
  const failing = await fromRows(toMs, {
    read: async () => {
      throw Object.assign(new Error("secret words"), { code: "XX000" });
    },
  });
  assert.deepEqual(failing.stored_clans.computed, { error: 3 });
  assert.equal(failing.stored_clans.error, "XX000");
  assert.ok(!JSON.stringify(failing.stored_clans).includes("secret"));
  assert.deepEqual(failing.timeline, plain.timeline);
});

test("a member's own view never reads clan rows", async () => {
  let calls = 0;
  const week = await buildTimeline(db, [{ kind: "clan", tag: K1 }], {
    ...homeOptions(),
    memberTag: STREAK,
    storedClans: {
      read: async (...args) => {
        calls += 1;
        return readClansStories(...args);
      },
      now: Date.now(),
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(week.stored_clans, {
    stored: 0,
    computed: { member: 1 },
    ms: 0,
  });
  assert.equal(week.entries.length, 1);
});

const storedItems = async () =>
  (
    await db.query(
      `select items::text as t from home_feed where account_id = $1`,
      [reader],
    )
  ).rows[0]?.t;
const homeWeek = (spy, storyBuild, storyClans, now = Date.now()) =>
  buildHomeWeek(spy, reader, {
    subjects,
    accounts,
    timezone: "America/Chicago",
    now,
    storyBuild,
    storyClans,
  });

test("storyClans is read only while storyBuild is on", async () => {
  for (const storyBuild of ["off", "shadow"])
    for (const storyClans of ["shadow", "on"]) {
      const week = await homeWeek(db, storyBuild, storyClans);
      assert.equal(week.storyClans, undefined, `${storyBuild}/${storyClans}`);
    }
  const off = await homeWeek(db, "on", "off");
  assert.equal(off.storyClans, undefined);
  assert.equal(off.story.mode, "on");
});

test("shadow stores the base week and finds no difference; on stores the same", async () => {
  const now = Date.now();
  await homeWeek(db, "on", "off", now);
  const base = await storedItems();
  await db.query(`delete from home_feed where account_id = $1`, [reader]);
  const shadow = await homeWeek(db, "on", "shadow", now + 1);
  assert.equal(await storedItems(), base);
  const s = shadow.storyClans;
  assert.equal(s.mode, "shadow");
  assert.equal(s.clans_stored, 2, JSON.stringify(s));
  assert.deepEqual(s.clans_computed, { unwritten: 1 });
  for (const k of ["only_computed", "only_mixed", "revision", "content"])
    assert.equal(s.diff[k], 0, `${k}: ${JSON.stringify(s.diff)}`);
  assert.equal(s.diff.order_same, true);
  for (const k of ["read_ms", "base_ms", "mixed_ms"])
    assert.equal(typeof s[k], "number", k);
  // Stage 4's line is unchanged beside it.
  assert.equal(shadow.story.mode, "on");
  assert.equal(shadow.story.players_stored, 1);
  // The log's object carries no tag and no name.
  const line = JSON.stringify(s);
  for (const tag of [K1, K2, K3, STREAK, GONE, ROLE, RUN, BACK, P])
    assert.ok(!line.includes(tag), tag);
  for (const name of ["Grove", "Thicket", "Ash", "streak"])
    assert.ok(!line.includes(name), name);
  // on: the week from clan rows is stored, and it is the same week.
  const on = await homeWeek(db, "on", "on", now + 2);
  assert.equal(on.storyClans.mode, "on");
  assert.equal(on.storyClans.clans_stored, 2);
  assert.equal(typeof on.storyClans.build_ms, "number");
  assert.equal(on.storyClans.diff, undefined);
  assert.equal(await storedItems(), base);
});

test("a planted difference in a clan row is the clan's, settled", async () => {
  const {
    rows: [row],
  } = await db.query(
    `select story_id from timeline_story
      where subject_kind = 'clan' and subject_tag = $1
        and kind = 'member_role_changed'`,
    [K1],
  );
  assert.ok(row);
  await db.query(
    `update timeline_story set item = jsonb_set(item, '{facts,tamper}', '99')
      where subject_kind = 'clan' and subject_tag = $1 and story_id = $2`,
    [K1, row.story_id],
  );
  try {
    const week = await homeWeek(db, "on", "shadow");
    const diff = week.storyClans.diff;
    assert.equal(diff.content, 1, JSON.stringify(diff));
    assert.deepEqual(diff.ids.content, [row.story_id]);
    assert.ok(
      diff.groups.some(
        (g) =>
          g.kind === "member_role_changed" &&
          g.bucket === "content" &&
          g.cause === "settled" &&
          g.field === "facts.tamper",
      ),
      JSON.stringify(diff.groups),
    );
  } finally {
    await writeClans();
    await db.query(
      `update timeline_story set item = item #- '{facts,tamper}'
        where subject_kind = 'clan' and subject_tag = $1 and story_id = $2`,
      [K1, row.story_id],
    );
  }
});

test("a shadow that fails never fails the stored week", async () => {
  // Every statement after the week is stored fails: only the shadow's.
  let stored = false;
  const spy = {
    query: (...args) => {
      if (stored)
        return Promise.reject(Object.assign(new Error("x"), { code: "XX001" }));
      if (String(args[0]).includes("insert into home_feed")) stored = true;
      return db.query(...args);
    },
  };
  const week = await homeWeek(spy, "on", "shadow");
  assert.ok(stored);
  assert.ok(week.items.length > 0);
  assert.equal(week.storyClans.mode, "shadow");
  assert.equal(week.storyClans.failed, "XX001");
  assert.equal(week.story.mode, "on");
});

test("a read's own build follows on and never shadows", async () => {
  const read = async (storyClans) => {
    await db.query(`delete from home_feed where account_id = $1`, [reader]);
    const lines = [];
    const week = await readHomeWeek(db, reader, {
      timezone: "America/Chicago",
      storyBuild: "on",
      storyClans,
      log: (line) => lines.push(JSON.parse(line)),
    });
    assert.equal(week.stored, false);
    return lines.filter((l) => l.at === "home_feed_story_clans");
  };
  assert.deepEqual(await read("shadow"), []);
  assert.deepEqual(await read("off"), []);
  const [line, ...rest] = await read("on");
  assert.equal(rest.length, 0);
  assert.equal(line.door, "home_read");
  assert.equal(line.mode, "on");
  assert.equal(line.clans_stored, 2);
  assert.deepEqual(line.clans_computed, { unwritten: 1 });
});

test("the parser: off unless shadow or on", () => {
  assert.equal(storyClansBuildOf(undefined), "off");
  assert.equal(storyClansBuildOf("nonsense"), "off");
  assert.equal(storyClansBuildOf("shadow"), "shadow");
  assert.equal(storyClansBuildOf("on"), "on");
});

test("a standout stored open and since gone quiet: refused open, woken and counted", async () => {
  // OPEN wins five in a row in the last twenty minutes; the write sees
  // the sitting open.
  const start = Date.now() - 20 * MIN;
  for (let i = 0; i < 5; i += 1)
    await battle(OPEN, K2, start + i * 4 * MIN, start + i * 4 * MIN + 30_000);
  await writeClans();
  const {
    rows: [row],
  } = await db.query(
    `select item from timeline_story
      where subject_kind = 'clan' and subject_tag = $1
        and kind = 'session_standout' and item->'facts'->>'open' = 'true'`,
    [K2],
  );
  assert.ok(row, "the standout is stored open");
  // While it can still go on, it is served.
  const soon = Date.now() + MIN;
  const served = await readClansStories(db, [K2], {
    fromMs: soon - HOME_WEEK_MS,
    toMs: soon,
    now: soon,
  });
  assert.equal(served.get(K2).ok, true);
  // Forty minutes on, the clock has closed it and no write has.
  const later = Date.now() + 40 * MIN;
  const refused = await readClansStories(db, [K1, K2], {
    fromMs: later - HOME_WEEK_MS,
    toMs: later,
    now: later,
  });
  assert.equal(refused.get(K1).ok, true);
  assert.equal(refused.get(K2).reason, "open");
  const wake = await storiesToWake(db, { now: later });
  assert.equal(wake.clans.counts.open, 1, JSON.stringify(wake.clans));
  assert.equal(wake.clans.tags[0], K2);
  const staleness = await storyStaleness(db, { now: later });
  assert.equal(staleness.clans.open_quiet, 1);
  // The week built at that instant builds K2 and still matches.
  const plain = await built(later);
  const mix = await fromRows(later, { now: later });
  assert.deepEqual(mix.stored_clans.computed, { open: 1, unwritten: 1 });
  assert.deepEqual(told(mix), told(plain));
});
