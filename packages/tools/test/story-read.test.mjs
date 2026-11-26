/**
 * Serving the stored stories (stage 3 of the stored Timeline, 2026-11-24):
 * readSubjectStories serves a written player's rows only when they are
 * provably current and says why not otherwise (unwritten, stale, news,
 * open); what it serves is the window's rows of the visibilities asked,
 * newest first, with their server-only fields restored, and
 * storedTimeline makes the page's timeline from them. The store holds
 * every recorded player (a comprehensive clan's members too, never an
 * activity clan's), and a return mid-span is told by a 35-day build as a
 * 7-day read tells it. On a scratch database (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  STORY_FLOOR_MS,
  STORY_READ_MARGIN_MS,
  compareStories,
  readSubjectStories,
  storiesToWake,
  storySpan,
  storyStaleness,
  writeSubjectStories,
  writtenAt,
} from "../src/activity/story-store.mjs";
import { wakeStories } from "../src/activity/story-wake.mjs";
import {
  buildTimeline,
  sessionSpark,
  storedTimeline,
} from "../src/activity/entries.mjs";

// Invented tags (docs/invented-tags.json): this repository is public.
const READ = "#0RQ8PL"; // recorded and written
const NEVER = "#0RQ8PY"; // recorded, never written
const BACK = "#0RQ8PG"; // recorded, away eleven days mid-span
const MEMBER = "#0RQ8PC"; // a comprehensive clan's member, no recording
const ROSTER = "#0RQ8PU"; // an activity clan's member, no recording
const GONE = "#0RQ8LL"; // recorded, last played twelve days ago
const FULL = "#0RQ8PV"; // the clan recorded at comprehensive scope
const ACTIVITY = "#0RQ8L2"; // the clan recorded at activity scope
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

let ctx;
let db;
const NOW = Date.now();
const VIS = ["public", "member"];

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

/** The player page's own computed read (routes/player.mjs pageTimeline). */
const page = (tag, fromMs, toMs, filter = null) =>
  buildTimeline(
    db,
    [{ kind: "player", tag, relationship: null, nickname: null }],
    {
      fromMs,
      toMs,
      timezone: "America/Chicago",
      accountId: null,
      basis: "occurred",
      people: { accounts: [], players: true },
      ...(filter ? { filter } : {}),
    },
  );
const read = (tag, opts = {}) =>
  readSubjectStories(db, "player", tag, {
    fromMs: NOW - 30 * DAY,
    toMs: NOW,
    visibilities: VIS,
    now: NOW + MIN,
    ...opts,
  });
const setWritten = (tag, ms) =>
  db.query(
    `update timeline_story_subject set written_at = $2
      where subject_kind = 'player' and subject_tag = $1`,
    [tag, iso(ms)],
  );

before(async () => {
  ctx = await scratchDb("story_read");
  db = ctx.db;
  const {
    rows: [{ account_id }],
  } = await db.query(
    `insert into account (email_hash, status) values ('story-read', 'approved')
     returning account_id`,
  );
  for (const tag of [READ, NEVER, BACK, MEMBER, ROSTER, GONE])
    await db.query(`insert into player (player_tag, name) values ($1, 'Ash')`, [
      tag,
    ]);
  for (const tag of [READ, NEVER, BACK, GONE])
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, origin)
       values ('player', $1, $2, 'claim')`,
      [tag, account_id],
    );
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Grove'), ($2, 'Glade')`,
    [FULL, ACTIVITY],
  );
  await db.query(
    `insert into recording (subject_type, subject_tag, requested_by, status, scope)
     values ('clan', $1, $3, 'active', 'comprehensive'),
            ('clan', $2, $3, 'active', 'activity')`,
    [FULL, ACTIVITY, account_id],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at)
     values ($1, $3, now() - interval '20 days'),
            ($2, $4, now() - interval '20 days')`,
    [FULL, ACTIVITY, MEMBER, ROSTER],
  );
  // Two sittings for READ: three days ago, and an hour ago (closed).
  await battle(READ, "read-a", NOW - 3 * DAY);
  await battle(READ, "read-b", NOW - 3 * DAY + 5 * MIN);
  await battle(READ, "read-c", NOW - 2 * HOUR);
  await battle(READ, "read-d", NOW - 2 * HOUR + 5 * MIN);
  await battle(NEVER, "never-a", NOW - 2 * DAY);
  for (const tag of [MEMBER, ROSTER]) {
    await battle(tag, `${tag.slice(1)}-a`, NOW - 2 * DAY);
    await battle(tag, `${tag.slice(1)}-b`, NOW - 2 * DAY + 5 * MIN);
  }
  // BACK plays 30 days ago, then nothing for eleven days, then returns.
  await battle(BACK, "back-a", NOW - 30 * DAY);
  await battle(BACK, "back-b", NOW - 30 * DAY + 5 * MIN);
  await battle(BACK, "back-c", NOW - 19 * DAY);
  await battle(BACK, "back-d", NOW - 19 * DAY + 5 * MIN);
  // GONE plays twelve days ago: ten quiet days are crossed two days ago.
  await battle(GONE, "gone-a", NOW - 12 * DAY);
  await battle(GONE, "gone-b", NOW - 12 * DAY + 5 * MIN);
  await writeSubjectStories(db, "player", READ, storySpan(NOW));
});

after(async () => {
  await ctx?.drop();
});

test("unwritten: a player with no write is refused", async () => {
  assert.deepEqual(await read(NEVER), { ok: false, reason: "unwritten" });
});

test("a fresh write is served: the page's own timeline, newest first, symbols restored", async () => {
  const out = await read(READ);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.written_at, iso(await writtenAt(db, "player", READ)));
  const sorts = out.items.map((it) => it.sort_at);
  assert.deepEqual(sorts, [...sorts].sort().reverse());
  // The page's timeline made from them equals the computed one.
  const fromMs = NOW - 30 * DAY;
  const toMs = NOW;
  const computed = await page(READ, fromMs, toMs);
  const stored = await storedTimeline(db, READ, out.items, {
    fromMs,
    toMs,
    timezone: "America/Chicago",
    people: { accounts: [], players: true },
  });
  assert.deepEqual(stored.timeline, computed.timeline);
  assert.deepEqual(stored.window, computed.window);
  assert.equal(stored.timeline_more, computed.timeline_more);
  // The server-only fields came back under their symbols, as the build
  // attached them: a sitting's spark, and the same evidence source.
  const sittings = stored.timeline.filter((it) => it.kind === "battle_session");
  assert.equal(sittings.length, 2);
  for (const it of sittings) {
    const twin = computed.timeline.find((c) => c.id === it.id);
    assert.ok(sessionSpark(it));
    assert.deepEqual(sessionSpark(it), sessionSpark(twin));
    assert.equal(
      Object.getOwnPropertySymbols(it).length,
      Object.getOwnPropertySymbols(twin).length,
    );
  }
});

test("the window and the visibilities filter the rows", async () => {
  const all = await read(READ);
  const recent = await read(READ, { fromMs: NOW - DAY });
  assert.equal(recent.ok, true);
  assert.deepEqual(
    recent.items.map((it) => it.id),
    all.items
      .filter((it) => Date.parse(it.sort_at) > NOW - DAY)
      .map((it) => it.id),
  );
  assert.ok(recent.items.length < all.items.length);
  const none = await read(READ, { visibilities: ["owner"] });
  assert.deepEqual(none.items, []);
});

test("stale: a write older than the floor and its margin is refused", async () => {
  const at = await writtenAt(db, "player", READ);
  const edge = at + STORY_FLOOR_MS + STORY_READ_MARGIN_MS;
  assert.equal((await read(READ, { now: edge - MIN })).ok, true);
  assert.deepEqual(await read(READ, { now: edge + MIN }), {
    ok: false,
    reason: "stale",
  });
});

test("open: a sitting stored open whose player has gone quiet is refused", async () => {
  await battle(READ, "read-open-a", NOW - 20 * MIN, NOW - 19 * MIN);
  await battle(READ, "read-open-b", NOW - 15 * MIN, NOW - 14 * MIN);
  await writeSubjectStories(db, "player", READ, storySpan(NOW));
  // Five minutes on the sitting is still open, and served.
  assert.equal((await read(READ, { now: NOW + 5 * MIN })).ok, true);
  // Its last battle was fifteen minutes before the write. A minute short
  // of the thirty that close a sitting it is served; at thirty a build
  // calls it closed, so the read refuses the row that says open.
  assert.equal((await read(READ, { now: NOW + 14 * MIN })).ok, true);
  assert.deepEqual(await read(READ, { now: NOW + 15 * MIN }), {
    ok: false,
    reason: "open",
  });
  // Forty minutes on the clock has closed it, and no write has.
  assert.deepEqual(await read(READ, { now: NOW + 40 * MIN }), {
    ok: false,
    reason: "open",
  });
});

test("news: a battle learned after the write is refused", async () => {
  // Written an hour ago; a battle learned a minute ago.
  await setWritten(READ, Date.now() - HOUR);
  await battle(READ, "read-news", NOW - 10 * MIN, Date.now() - MIN);
  assert.deepEqual(await read(READ, { now: Date.now() }), {
    ok: false,
    reason: "news",
  });
  // A write after it holds it, and is served.
  await writeSubjectStories(db, "player", READ, storySpan(Date.now()));
  assert.equal((await read(READ, { now: Date.now() + MIN })).ok, true);
});

test("the store holds a comprehensive clan's members, never an activity clan's", async () => {
  const { tags } = await storiesToWake(db, { now: NOW + MIN });
  assert.ok(tags.includes(MEMBER), JSON.stringify(tags));
  assert.ok(!tags.includes(ROSTER));
  const sent = [];
  const outbox = async (lane, msg) => sent.push(msg.story_player);
  assert.equal(await wakeStories(db, MEMBER, { outbox, now: NOW }), 1);
  assert.equal(await wakeStories(db, ROSTER, { outbox, now: NOW }), 0);
  assert.deepEqual(sent, [MEMBER]);
  const before = await storyStaleness(db, { now: NOW + MIN });
  // READ, NEVER, BACK, GONE and MEMBER.
  assert.equal(before.players_recorded, 5, JSON.stringify(before));
  await writeSubjectStories(db, "player", MEMBER, storySpan(NOW));
  const after = await storyStaleness(db, { now: NOW + MIN });
  assert.equal(after.players_with_rows, before.players_with_rows + 1);
  assert.equal((await read(MEMBER)).ok, true);
  // A member who left is out of the set; their rows stay until the trim.
  await db.query(
    `update clan_membership set left_observed_at = now() where player_tag = $1`,
    [MEMBER],
  );
  assert.equal(
    (await storyStaleness(db, { now: NOW + MIN })).players_recorded,
    4,
  );
  assert.equal(await wakeStories(db, MEMBER, { outbox, now: NOW }), 0);
});

test("a return mid-span is told by the 35-day build as a 7-day read tells it", async () => {
  const returnedOf = (built) =>
    built.timeline
      .filter((it) => it.kind === "returned")
      .map((it) => ({ id: it.id, at: it.at, facts: it.facts }));
  // A week around the return: its first battle is the return, as before.
  const week = await page(BACK, NOW - 22 * DAY, NOW - 15 * DAY);
  const told = returnedOf(week);
  assert.equal(told.length, 1, JSON.stringify(week.timeline));
  assert.equal(told[0].at, iso(NOW - 19 * DAY));
  assert.equal(told[0].facts.after_days, 10);
  // The whole span, whose first battle is no return: the same story.
  const span = storySpan(NOW);
  const whole = await page(BACK, span.fromMs, span.toMs);
  assert.deepEqual(returnedOf(whole), told);
  await writeSubjectStories(db, "player", BACK, span);
  const stored = await read(BACK);
  assert.deepEqual(
    stored.items
      .filter((it) => it.kind === "returned")
      .map((it) => ({ id: it.id, at: it.at, facts: it.facts })),
    told,
  );
});

test("a quiet crossing alone in the window is dropped, as a week's build drops it", async () => {
  await writeSubjectStories(db, "player", GONE, storySpan(NOW));
  const crossings = (items) =>
    items.filter((it) => it.kind === "quiet_crossed");
  const people = { accounts: [], players: true };
  // The span's build holds the sitting, so the row holds the crossing.
  const held = await read(GONE, { fromMs: NOW - 7 * DAY });
  assert.equal(held.ok, true, JSON.stringify(held));
  assert.deepEqual(
    held.items.map((it) => [it.kind, it.facts.rung]),
    [["quiet_crossed", 10]],
  );
  // A week's build says nothing else, lists the player quiet and tells no
  // crossing; the rows serve the same.
  const week = { fromMs: NOW - 7 * DAY, toMs: NOW };
  const computed = await page(GONE, week.fromMs, week.toMs);
  assert.deepEqual(computed.timeline, []);
  const stored = await storedTimeline(db, GONE, held.items, {
    ...week,
    timezone: "America/Chicago",
    people,
  });
  assert.deepEqual(stored.timeline, computed.timeline);
  // The comparison reads the rows the same way: nothing differs.
  const diff = await compareStories(db, "player", GONE, computed.timeline, {
    ...week,
    visibilities: VIS,
    now: NOW + MIN,
  });
  for (const k of [
    "stored",
    "only_computed",
    "only_stored",
    "revision",
    "content",
  ])
    assert.equal(diff[k], 0, `${k}: ${JSON.stringify(diff)}`);
  // A window that holds the sitting tells the crossing, built or stored.
  const wide = { fromMs: NOW - 30 * DAY, toMs: NOW };
  const built = await page(GONE, wide.fromMs, wide.toMs);
  const all = await read(GONE);
  const served = await storedTimeline(db, GONE, all.items, {
    ...wide,
    timezone: "America/Chicago",
    people,
  });
  assert.equal(crossings(built.timeline).length, 1);
  assert.deepEqual(served.timeline, built.timeline);
});
