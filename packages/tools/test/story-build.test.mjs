/**
 * Home's week with followed players from their stored stories (stage 4 of
 * the stored Timeline, 2026-11-25): buildTimeline's `storedPlayers` seam
 * serves a player whose rows readPlayersStories proves current and builds
 * the rest as before; the finished timeline is the same, on either basis.
 * Each refusal builds only that player; a failed or timed-out read builds
 * everyone. buildHomeWeek's `storyBuild` stores the computed week (off,
 * shadow) or the mixed one (on), and the shadow's comparison finds nothing
 * on parity and a planted difference under its class. On a scratch
 * database (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  readPlayersStories,
  storySpan,
  withStatementTimeout,
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
  compareWeeks,
  readHomeWeek,
  storyBuildOf,
} from "../src/activity/home-feed.mjs";

// Invented tags (docs/invented-tags.json): this repository is public.
const A = "#0QPLU2"; // recorded, written, in the clan, verified, posted
const B = "#0QPLU8"; // recorded, written, a battle learned late
const C = "#0QPLU9"; // recorded, written, quiet twelve days
const U = "#0QPLUP"; // followed, never recorded
const CLAN = "#0QPLUY"; // the followed clan A is in
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.now();

let ctx;
let db;
let reader;
let subjects;
let accounts;

async function battle(tag, id, ms, created = ms + MIN) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $3)`,
    [id, iso(ms), iso(created)],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, battle_time, side, type, type_class, crowns, trophy_change, outcome)
     values ($1, $2, $3, 0, 'PvP', 'pvp', 3, 30, 'win')`,
    [id, tag, iso(ms)],
  );
}

/** Home's own options (home-feed.mjs buildHomeWeek). */
const homeOptions = (basis, toMs = NOW) => ({
  fromMs: toMs - HOME_WEEK_MS,
  toMs,
  timezone: "America/Chicago",
  accountId: reader,
  interactive: true,
  accountLines: false,
  lateCounts: false,
  people: { accounts, players: true },
  basis,
});
const computed = (basis, toMs) =>
  buildTimeline(db, subjects, homeOptions(basis, toMs));
const mixed = (
  basis,
  { toMs, now = Date.now(), read = readPlayersStories } = {},
) =>
  buildTimeline(db, subjects, {
    ...homeOptions(basis, toMs),
    storedPlayers: { read, now },
  });
const writeAll = async () => {
  for (const tag of [A, B, C])
    await writeSubjectStories(db, "player", tag, storySpan(Date.now()));
};

before(async () => {
  ctx = await scratchDb("story_build");
  db = ctx.db;
  const account = async (hash) =>
    (
      await db.query(
        `insert into account (email_hash, status, timezone)
         values ($1, 'approved', 'America/Chicago') returning account_id`,
        [hash],
      )
    ).rows[0].account_id;
  reader = await account("story-build-reader");
  const owner = await account("story-build-owner");
  const friend = await account("story-build-friend");
  for (const tag of [A, B, C, U])
    await db.query(`insert into player (player_tag, name) values ($1, 'Ash')`, [
      tag,
    ]);
  for (const tag of [A, B, C])
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, origin)
       values ('player', $1, $2, 'claim')`,
      [tag, owner],
    );
  // A is verified by its owner three days ago: a people item, read live.
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, verified_at)
     values ($1, $2, 'verified', true, 'primary', $3)`,
    [owner, A, iso(NOW - 3 * DAY)],
  );
  await db.query(
    "insert into account_passport (account_id, passport_id) values ($1, $2)",
    [owner, "bcdefghjkmnq"],
  );
  // The reader follows all four players, one by a nickname, the clan,
  // and a person.
  for (const tag of [A, B, C, U])
    await db.query(
      `insert into claim (account_id, player_tag, relationship, notify)
       values ($1, $2, 'friend', true)`,
      [reader, tag],
    );
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname)
     values ($1, $2, 'Sprout')`,
    [reader, B],
  );
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Copse')`, [
    CLAN,
  ]);
  await db.query(
    `insert into account_clan (account_id, clan_tag, scope, notify)
     values ($1, $2, 'comprehensive', true)`,
    [reader, CLAN],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at, baseline)
     values ($1, $2, 'member', $3, false)`,
    [CLAN, A, iso(NOW - 2 * DAY)],
  );
  await db.query(
    `insert into account_follow (account_id, followed_account_id) values ($1, $2)`,
    [reader, friend],
  );
  // A: sittings three days ago and two hours ago, one of them posted.
  await battle(A, "sb-a1", NOW - 3 * DAY);
  await battle(A, "sb-a2", NOW - 3 * DAY + 5 * MIN);
  await battle(A, "sb-a3", NOW - 2 * HOUR);
  await battle(A, "sb-a4", NOW - 2 * HOUR + 5 * MIN);
  await db.query(
    `insert into account_post (item_id, player_tag, battle_id, account_id, body, created_at)
     values ('tl_00000000000000b0dd01', $1, 'sb-a3', $2, 'nice one', $3)`,
    [A, owner, iso(NOW - HOUR)],
  );
  // B: a sitting yesterday, and one played ten days ago that the record
  // learned a day ago (an observed week tells it, late).
  await battle(B, "sb-b1", NOW - DAY);
  await battle(B, "sb-b2", NOW - DAY + 5 * MIN);
  await battle(B, "sb-b3", NOW - 10 * DAY, NOW - DAY - HOUR);
  // C: twelve days quiet, so ten quiet days were crossed two days ago.
  await battle(C, "sb-c1", NOW - 12 * DAY);
  await battle(C, "sb-c2", NOW - 12 * DAY + 5 * MIN);
  // U: never recorded, but its battles are read for the reader.
  await battle(U, "sb-u1", NOW - 2 * DAY);
  subjects = await subjectsFor(db, reader);
  accounts = await followedAccountIds(db, reader);
  await writeAll();
});

after(async () => {
  await ctx?.drop();
});

for (const basis of ["observed", "occurred"])
  test(`${basis}: the mixed week is the computed week`, async () => {
    const plain = await computed(basis);
    const mix = await mixed(basis);
    assert.equal(
      mix.stored_players.stored,
      3,
      JSON.stringify(mix.stored_players),
    );
    assert.deepEqual(mix.stored_players.computed, { unwritten: 1 });
    assert.ok(plain.timeline.length > 0);
    // People, a highlight and the clan's entry all came through.
    assert.ok(plain.timeline.some((it) => it.section === "people"));
    assert.ok(plain.timeline.some((it) => it.kind === "battle_highlight"));
    assert.ok(plain.timeline.some((it) => it.subject_tag === U));
    assert.deepEqual(mix.timeline, plain.timeline);
    assert.equal(mix.timeline_more, plain.timeline_more);
    // A nickname is put back where buildPlayerEntry puts it.
    const ofB = mix.timeline.filter((it) => it.subject_tag === B);
    assert.ok(ofB.length > 0);
    for (const it of ofB) assert.equal(it.nickname, "Sprout");
    // Stored players have no entry and are never listed quiet.
    const entryTags = mix.entries.map((e) => e.subject_tag ?? e.tag);
    for (const tag of [A, B, C]) assert.ok(!entryTags.includes(tag));
    assert.ok(!mix.quiet.some((q) => [A, B, C].includes(q.tag)));
    const diff = compareWeeks(plain, mix, {
      fromMs: NOW - HOME_WEEK_MS,
      basis,
    });
    for (const k of ["only_computed", "only_mixed", "revision", "content"])
      assert.equal(diff[k], 0, `${k}: ${JSON.stringify(diff)}`);
    assert.equal(diff.order_same, true);
  });

test("observed: a battle learned late is told late, from the rows as built", async () => {
  const plain = await computed("observed");
  const mix = await mixed("observed");
  const late = (t) =>
    t.timeline.filter((it) => it.subject_tag === B && it.late === true);
  assert.equal(late(plain).length, 1, JSON.stringify(plain.timeline));
  assert.deepEqual(late(mix), late(plain));
  // The occurred week does not hold it.
  const occurred = await mixed("occurred");
  assert.equal(late(occurred).length, 0);
});

test("a quiet crossing alone in the week is dropped, as the build drops it", async () => {
  const rows = await readPlayersStories(db, [C], {
    fromMs: NOW - 30 * DAY,
    toMs: NOW,
    now: Date.now(),
  });
  assert.ok(rows.get(C).items.some((it) => it.kind === "quiet_crossed"));
  const mix = await mixed("observed");
  assert.equal(mix.stored_players.stored, 3);
  assert.ok(!mix.timeline.some((it) => it.subject_tag === C));
});

test("each refusal builds only that player", async () => {
  const reasons = async (opts, toMs) => {
    const plain = await computed("observed", toMs);
    const mix = await mixed("observed", { ...opts, toMs });
    assert.deepEqual(mix.timeline, plain.timeline);
    return mix.stored_players;
  };
  // past: a window that ended two minutes ago.
  const past = await reasons({}, Date.now() - 2 * MIN);
  assert.deepEqual(past.computed, { past: 3, unwritten: 1 });
  // stale: the rows judged seven hours on.
  const stale = await reasons(
    { now: Date.now() + 7 * HOUR },
    Date.now() + 7 * HOUR,
  );
  assert.deepEqual(stale.computed, { stale: 3, unwritten: 1 });
  // news: A learned a battle after its write.
  await battle(A, "sb-a-news", Date.now() - 10 * MIN, Date.now());
  const news = await reasons({}, Date.now());
  assert.equal(news.stored, 2, JSON.stringify(news));
  assert.deepEqual(news.computed, { news: 1, unwritten: 1 });
  await writeAll();
  // open: a sitting stored open whose player has since gone quiet.
  await battle(B, "sb-b-open1", Date.now() - 20 * MIN, Date.now() - 19 * MIN);
  await battle(B, "sb-b-open2", Date.now() - 15 * MIN, Date.now() - 14 * MIN);
  await writeAll();
  const later = Date.now() + 40 * MIN;
  const open = await reasons({ now: later }, later);
  // A's sitting from the news above was stored open too, ten minutes
  // after its battle: both are closed by the clock now; C is served.
  assert.equal(open.stored, 1);
  assert.deepEqual(open.computed, { open: 2, unwritten: 1 });
  await writeAll();
});

test("a failed or timed-out read builds every player", async () => {
  const plain = await computed("observed");
  const failing = await mixed("observed", {
    read: async () => {
      throw Object.assign(new Error("secret words"), { code: "XX000" });
    },
  });
  assert.deepEqual(failing.stored_players.computed, { error: 4 });
  assert.equal(failing.stored_players.error, "XX000");
  assert.ok(!JSON.stringify(failing.stored_players).includes("secret"));
  assert.deepEqual(failing.timeline, plain.timeline);
  const slow = await mixed("observed", {
    read: (d) =>
      withStatementTimeout(d, 50, () => d.query("select pg_sleep(2)")),
  });
  assert.deepEqual(slow.stored_players.computed, { error: 4 });
  assert.equal(slow.stored_players.error, "57014");
  assert.deepEqual(slow.timeline, plain.timeline);
  // The budget is put back: a caller's own transaction stays usable.
  await db.query("begin");
  await db.query("set local statement_timeout = '7s'");
  await assert.rejects(
    withStatementTimeout(db, 50, () => db.query("select pg_sleep(2)")),
  );
  const {
    rows: [{ statement_timeout }],
  } = await db.query("show statement_timeout");
  assert.equal(statement_timeout, "7s");
  await db.query("commit");
});

const storedItems = async () =>
  (
    await db.query(
      `select items::text as t from home_feed where account_id = $1`,
      [reader],
    )
  ).rows[0].t;

test("buildHomeWeek: off and shadow store the same week; shadow finds a planted difference", async () => {
  assert.equal(storyBuildOf(undefined), "off");
  assert.equal(storyBuildOf("nonsense"), "off");
  assert.equal(storyBuildOf("shadow"), "shadow");
  const now = Date.now();
  const week = (mode, at) =>
    buildHomeWeek(db, reader, {
      subjects,
      accounts,
      timezone: "America/Chicago",
      now: at,
      storyBuild: mode,
    });
  const off = await week("off", now);
  assert.equal(off.story, undefined);
  const offItems = await storedItems();
  await db.query(`delete from home_feed where account_id = $1`, [reader]);
  const shadow = await week("shadow", now);
  assert.equal(await storedItems(), offItems);
  assert.equal(shadow.story.mode, "shadow");
  assert.equal(shadow.story.players_stored, 3, JSON.stringify(shadow.story));
  assert.deepEqual(shadow.story.players_computed, { unwritten: 1 });
  for (const k of ["only_computed", "only_mixed", "revision", "content"])
    assert.equal(shadow.story.diff[k], 0, JSON.stringify(shadow.story.diff));
  // The log's object carries no tag and no item's content.
  const line = JSON.stringify(shadow.story);
  for (const tag of [A, B, C, U, CLAN]) assert.ok(!line.includes(tag));
  assert.ok(!line.includes("Ash") && !line.includes("Sprout"));

  // Plant a tamper: A's newest sitting changed in its row, B's removed.
  const {
    rows: [sitting],
  } = await db.query(
    `select story_id from timeline_story
      where subject_tag = $1 and kind = 'battle_session'
      order by sort_at desc limit 1`,
    [A],
  );
  await db.query(
    `update timeline_story
        set item = jsonb_set(item, '{facts,tamper}', '99')
      where subject_tag = $1 and story_id = $2`,
    [A, sitting.story_id],
  );
  const {
    rows: [gone],
  } = await db.query(
    `delete from timeline_story
      where subject_tag = $1 and kind = 'battle_session'
        and sort_at > now() - interval '2 days'
        and sort_at < now() - interval '12 hours'
      returning story_id`,
    [B],
  );
  const tampered = await week("shadow", now + 1);
  const diff = tampered.story.diff;
  assert.equal(diff.content, 1, JSON.stringify(diff));
  assert.deepEqual(diff.ids.content, [sitting.story_id]);
  assert.equal(diff.only_computed, 1);
  assert.deepEqual(diff.ids.only_computed, [gone.story_id]);
  assert.ok(
    diff.groups.some(
      (g) =>
        g.kind === "battle_session" &&
        g.bucket === "content" &&
        g.cause === "settled" &&
        g.field === "facts.tamper",
    ),
    JSON.stringify(diff.groups),
  );
  assert.ok(
    diff.groups.some(
      (g) => g.bucket === "only_computed" && g.cause === "settled",
    ),
  );
  // Shadow still stored the computed week.
  assert.ok((await storedItems()).includes(gone.story_id));

  // on: the mixed week is what is stored.
  const on = await week("on", now + 2);
  assert.equal(on.story.mode, "on");
  assert.equal(on.story.players_stored, 3);
  assert.ok(!(await storedItems()).includes(gone.story_id));
  await writeAll();
});

test("a shadow that fails never fails the stored week", async () => {
  // A subject list the mixed build cannot read: the computed week is
  // stored first, so only the shadow sees the failure.
  let calls = 0;
  const spy = {
    query: (...args) => {
      calls += 1;
      if (String(args[0]).includes("timeline_story_subject"))
        return Promise.reject(Object.assign(new Error("x"), { code: "XX001" }));
      return db.query(...args);
    },
  };
  const week = await buildHomeWeek(spy, reader, {
    subjects,
    accounts,
    timezone: "America/Chicago",
    now: Date.now(),
    storyBuild: "shadow",
  });
  assert.ok(calls > 0);
  assert.ok(week.items.length > 0);
  // The read's failure is the seam's own: every player built, no diff.
  assert.equal(week.story.mode, "shadow");
  assert.equal(week.story.read_error, "XX001");
  assert.deepEqual(week.story.players_computed, { error: 4 });
  assert.equal(week.story.diff.only_computed, 0);
});

test("a read's own build never shadows, and logs only a mixed week", async () => {
  const read = async (mode) => {
    await db.query(`delete from home_feed where account_id = $1`, [reader]);
    const lines = [];
    const week = await readHomeWeek(db, reader, {
      timezone: "America/Chicago",
      storyBuild: mode,
      log: (line) => lines.push(JSON.parse(line)),
    });
    assert.equal(week.stored, false);
    return lines;
  };
  // Shadow is the lane's: the read builds once and says nothing.
  assert.deepEqual(await read("shadow"), []);
  assert.deepEqual(await read("off"), []);
  const [line, ...rest] = await read("on");
  assert.equal(rest.length, 0);
  assert.equal(line.at, "home_feed_story_build");
  assert.equal(line.door, "home_read");
  assert.equal(line.mode, "on");
  assert.equal(line.players_stored, 3);
});
