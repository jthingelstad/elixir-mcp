/**
 * Keeping the stored stories fresh (stage 2 of the stored Timeline,
 * 2026-11-23): each write stamps timeline_story_subject (0315), a wake
 * already served is skipped, an older build never overwrites a newer one,
 * the jobs' sweep wakes each recorded player for the right reason, the
 * staleness answer counts without a tag, the admission's wake is one
 * outbox object per player per minute, and the shadow's comparison names
 * each difference's kind, cause and field. On a scratch database (golden
 * rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  changedFields,
  compareStories,
  refreshSubjectStories,
  storiesToWake,
  storySpan,
  storyStaleness,
  writeSubjectStories,
  writtenAt,
} from "../src/activity/story-store.mjs";
import { storyWakeId, wakeStories } from "../src/activity/story-wake.mjs";
import { buildTimeline } from "../src/activity/entries.mjs";

// Invented tags (docs/invented-tags.json): this repository is public.
const UNWRITTEN = "#0PYLQ2";
const NEWS = "#0YY9P";
const FLOOR = "#0PQ2VY";
const QUIET = "#0CU8LG";
const OPEN = "#0LUVR2";
const UNRECORDED = "#0C2C8";
const ALL = [UNWRITTEN, NEWS, FLOOR, QUIET, OPEN];
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

let ctx;
let db;
const NOW = Date.now();

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

const marker = async (tag) =>
  (
    await db.query(
      `select written_at, stories, build_ms from timeline_story_subject
        where subject_kind = 'player' and subject_tag = $1`,
      [tag],
    )
  ).rows[0] ?? null;

before(async () => {
  ctx = await scratchDb("story_fresh");
  db = ctx.db;
  const {
    rows: [{ account_id }],
  } = await db.query(
    `insert into account (email_hash, status) values ('story-fresh', 'approved')
     returning account_id`,
  );
  for (const [i, tag] of ALL.entries()) {
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      `Birch ${i}`,
    ]);
    await db.query(
      `insert into recording (subject_type, subject_tag, requested_by, origin)
       values ('player', $1, $2, 'claim')`,
      [tag, account_id],
    );
  }
  await db.query(`insert into player (player_tag, name) values ($1, 'Elm')`, [
    UNRECORDED,
  ]);
  // A finished sitting two days ago for each; OPEN also plays now.
  for (const [i, tag] of ALL.entries()) {
    await battle(tag, `fresh-${i}-a`, NOW - 2 * DAY);
    await battle(tag, `fresh-${i}-b`, NOW - 2 * DAY + 5 * MIN);
  }
  await battle(OPEN, "fresh-open-a", NOW - 20 * MIN);
  await battle(OPEN, "fresh-open-b", NOW - 15 * MIN);
  for (const tag of [NEWS, FLOOR, QUIET, OPEN])
    await writeSubjectStories(db, "player", tag, storySpan(NOW));
});

after(async () => {
  await ctx?.drop();
});

test("a write stamps when its build began; a second write moves the stamp, not the rows", async () => {
  const m = await marker(QUIET);
  assert.ok(m, "no marker");
  assert.equal(m.stories, 1);
  assert.equal(typeof m.build_ms, "number");
  const before = new Date(m.written_at).getTime();
  assert.ok(before >= NOW - MIN && before <= Date.now());
  const again = await writeSubjectStories(db, "player", QUIET, storySpan(NOW));
  assert.deepEqual(again, { stories: 1, written: 0, deleted: 0 });
  assert.ok((await writtenAt(db, "player", QUIET)) >= before);
  assert.equal(await writtenAt(db, "player", UNWRITTEN), null);
});

test("a wake already served is skipped; a newer one writes", async () => {
  const at = await writtenAt(db, "player", QUIET);
  assert.deepEqual(
    await refreshSubjectStories(db, "player", QUIET, { since: iso(at) }),
    { skipped: "fresh" },
  );
  const r = await refreshSubjectStories(db, "player", QUIET, {
    since: iso(at + 1),
  });
  assert.equal(r.stories, 1);
  assert.ok((await writtenAt(db, "player", QUIET)) > at);
  // A wake with no since always writes.
  assert.equal(
    (await refreshSubjectStories(db, "player", QUIET, { since: null })).stories,
    1,
  );
});

test("a build that began before the committed write commits nothing", async () => {
  const future = Date.now() + HOUR;
  await db.query(
    `update timeline_story_subject set written_at = $2
      where subject_kind = 'player' and subject_tag = $1`,
    [QUIET, iso(future)],
  );
  const r = await writeSubjectStories(db, "player", QUIET, storySpan(NOW));
  assert.equal(r.superseded, true);
  assert.equal(r.written, 0);
  assert.equal(await writtenAt(db, "player", QUIET), future);
  // Put it back to a real write.
  await db.query(`delete from timeline_story_subject where subject_tag = $1`, [
    QUIET,
  ]);
  await writeSubjectStories(db, "player", QUIET, storySpan(NOW));
});

test("the sweep wakes each recorded player for its reason, and only those", async () => {
  // NEWS: a battle learned after its write (another player's log, say).
  await battle(NEWS, "fresh-news-a", NOW - 10 * MIN, Date.now() + 1000);
  await battle(NEWS, "fresh-news-b", NOW - 5 * MIN, Date.now() + 1000);
  // FLOOR: written seven hours ago, nothing new since.
  await db.query(
    `update timeline_story_subject set written_at = $2
      where subject_kind = 'player' and subject_tag = $1`,
    [FLOOR, iso(NOW - 7 * HOUR)],
  );
  // Forty minutes on, OPEN's sitting (stored open) has gone quiet.
  const now = NOW + 40 * MIN;
  const { tags, counts } = await storiesToWake(db, { now });
  assert.deepEqual(tags, [OPEN, UNWRITTEN, NEWS, FLOOR]);
  assert.deepEqual(counts, {
    recorded: 5,
    open: 1,
    unwritten: 1,
    news: 1,
    floor: 1,
    probed: 3,
  });
  // The limit holds, in priority order.
  assert.deepEqual((await storiesToWake(db, { now, limit: 2 })).tags, [
    OPEN,
    UNWRITTEN,
  ]);
});

test("the staleness answer counts, with no tag", async () => {
  const now = NOW + 40 * MIN;
  const out = await storyStaleness(db, { now });
  assert.equal(out.players_recorded, 5);
  assert.equal(out.players_with_rows, 4);
  assert.equal(out.players_written, 4);
  assert.equal(out.players_unwritten, 1);
  assert.equal(out.players_stale, 1, JSON.stringify(out));
  assert.ok(out.oldest_gap_s >= 40 * 60 - 120 && out.oldest_gap_s <= 41 * 60);
  assert.ok(out.oldest_write_s >= 7 * 3600);
  assert.equal(out.open_quiet, 1);
  assert.equal(out.probed, 4);
  assert.equal(out.complete, true);
  assert.equal(typeof out.build_ms_avg, "number");
  for (const tag of [...ALL, UNRECORDED])
    assert.ok(!JSON.stringify(out).includes(tag));
  // A budget that is spent stops the probes and says so.
  const cut = await storyStaleness(db, { now, budgetMs: 0 });
  assert.equal(cut.complete, false);
  assert.equal(cut.probed, 0);
});

test("once the sweep's wakes are written, nothing is due but what is", async () => {
  const now = NOW + 40 * MIN;
  for (const tag of [OPEN, UNWRITTEN, NEWS, FLOOR])
    await writeSubjectStories(db, "player", tag, storySpan(now));
  const { tags, counts } = await storiesToWake(db, { now: Date.now() + MIN });
  assert.deepEqual(tags, [], JSON.stringify(counts));
  // OPEN's sitting is stored closed now.
  const {
    rows: [s],
  } = await db.query(
    `select item->'facts'->>'open' as open from timeline_story
      where subject_tag = $1 and kind = 'battle_session'
      order by sort_at desc limit 1`,
    [OPEN],
  );
  assert.notEqual(s.open, "true");
});

test("an admission's wake is one outbox object per recorded player per minute", async () => {
  const sent = [];
  const outbox = async (lane, msg, opts) => sent.push({ lane, msg, opts });
  const at = Date.UTC(2026, 10, 23, 12, 34, 56);
  assert.equal(await wakeStories(db, NEWS, { outbox, now: at }), 1);
  assert.equal(await wakeStories(db, UNRECORDED, { outbox, now: at }), 0);
  assert.equal(await wakeStories(db, NEWS, { outbox: null, now: at }), 0);
  assert.equal(sent.length, 1);
  const minute = Math.floor(at / MIN);
  assert.deepEqual(sent[0], {
    lane: "timeline-sync",
    msg: { v: 1, story_player: NEWS, since: "2026-11-23T12:35:00.000Z" },
    opts: { id: storyWakeId(NEWS, minute), once: true },
  });
  // The object's key carries a digest, never the tag.
  assert.equal(
    sent[0].opts.id,
    `story.${createHash("md5").update(NEWS).digest("hex")}.${minute}`,
  );
  assert.ok(!sent[0].opts.id.includes(NEWS.slice(1)));
});

test("field names: one level under facts and evidence, never a value", () => {
  assert.deepEqual(
    changedFields(
      { kind: "x", facts: { name: "A", n: 1 }, evidence: { a: 1 }, at: "1" },
      { kind: "x", facts: { name: "B", n: 1 }, evidence: { a: 2 }, at: "2" },
    ),
    ["at", "evidence.a", "facts.name"],
  );
  assert.deepEqual(changedFields({ "a b": 1 }, { "a b": 2 }), ["*"]);
  assert.deepEqual(changedFields({ facts: 1 }, { facts: { x: 1 } }), ["facts"]);
});

test("the comparison's groups give kind, bucket, cause and field", async () => {
  const page = async (tag, now = Date.now()) => {
    const window = { fromMs: now - 30 * DAY, toMs: now };
    const built = await buildTimeline(
      db,
      [{ kind: "player", tag, relationship: null, nickname: null }],
      {
        ...window,
        timezone: "UTC",
        accountId: null,
        basis: "occurred",
        lateBattles: true,
        people: { accounts: [], players: true },
      },
    );
    return compareStories(
      db,
      "player",
      tag,
      [...built.timeline, ...built.timeline_dropped],
      { ...window, visibilities: ["public", "member"], now },
    );
  };
  // Right after a write: nothing differs and the record is not newer.
  const clean = await page(QUIET);
  assert.deepEqual(clean.groups, []);
  assert.equal(clean.stale, false);
  assert.ok(clean.written_at);
  assert.equal(typeof clean.lag_s, "number");
  // A settled story whose content moved (a rename), named by field.
  await db.query(
    `update player set name = 'Birch Bark' where player_tag = $1`,
    [QUIET],
  );
  const renamed = await page(QUIET);
  assert.equal(renamed.content, 1, JSON.stringify(renamed));
  assert.ok(renamed.groups.length >= 1);
  for (const g of renamed.groups) {
    assert.equal(g.kind, "battle_session");
    assert.equal(g.bucket, "content");
    assert.equal(g.cause, "settled");
    assert.notEqual(g.field, "unread");
  }
  // A story the record learned after the write: unwritten, and stale.
  const t = Date.now();
  await battle(QUIET, "fresh-late-a", t - 30 * MIN, t);
  await battle(QUIET, "fresh-late-b", t - 25 * MIN, t);
  const late = await page(QUIET, t + 1000);
  assert.equal(late.stale, true);
  assert.ok(Date.parse(late.newest_learned_at) > Date.parse(late.written_at));
  assert.ok(
    late.groups.some(
      (g) =>
        g.bucket === "only_computed" &&
        g.cause === "unwritten" &&
        g.n === 1 &&
        g.field === null,
    ),
    JSON.stringify(late.groups),
  );
  for (const tag of ALL) assert.ok(!JSON.stringify(late).includes(tag));
  assert.ok(!JSON.stringify(late).includes("Birch"));
});
