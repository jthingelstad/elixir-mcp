/**
 * A subject's stored stories (timeline_story, 0314; stage 1 of the stored
 * Timeline, 2026-11-23): the writer stores what the builder tells with no
 * viewer, writes nothing on a second run, follows a sitting as it grows,
 * deletes inside its span only, and never stores what a reader adds. The
 * comparison counts each kind of difference. On a scratch database
 * (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  STORY_SPAN_DAYS,
  compareStories,
  storySpan,
  writeSubjectStories,
} from "../src/activity/story-store.mjs";
import { buildTimeline } from "../src/activity/entries.mjs";

// Invented tags (docs/invented-tags.json): this repository is public.
const PLAYER = "#0PLUG2V9";
const NICK = "A Pet Name Only One Reader Uses";
const MIN = 60_000;
const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();

let ctx;
let db;
const NOW = Date.now();

async function battle(id, ms, outcome = "win") {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $3)`,
    [id, iso(ms), iso(ms + MIN)],
  );
  await db.query(
    `insert into battle_participant
       (battle_id, player_tag, battle_time, side, type, type_class, crowns, trophy_change, outcome)
     values ($1, $2, $3, 0, 'PvP', 'pvp', $4, $5, $6)`,
    [
      id,
      PLAYER,
      iso(ms),
      outcome === "win" ? 3 : 0,
      outcome === "win" ? 30 : -30,
      outcome,
    ],
  );
}

const rows = async () =>
  (
    await db.query(
      `select story_id, kind, revision, content_hash, sort_at, item, built_at
         from timeline_story where subject_kind = 'player' and subject_tag = $1
        order by sort_at`,
      [PLAYER],
    )
  ).rows;

/** The player page's own read (routes/player.mjs pageTimeline), as a
 *  reader in another zone sees it. */
const page = (now) =>
  buildTimeline(
    db,
    [{ kind: "player", tag: PLAYER, relationship: null, nickname: null }],
    {
      fromMs: now - 30 * DAY,
      toMs: now,
      timezone: "America/Chicago",
      accountId: null,
      basis: "occurred",
      lateBattles: true,
      people: { accounts: [], players: true },
    },
  );
const compare = async (now) => {
  const built = await page(now);
  return compareStories(
    db,
    "player",
    PLAYER,
    [...built.timeline, ...built.timeline_dropped],
    { fromMs: now - 30 * DAY, toMs: now, visibilities: ["public", "member"] },
  );
};

before(async () => {
  ctx = await scratchDb("story_store");
  db = ctx.db;
  await db.query(`insert into player (player_tag, name) values ($1, 'Oak')`, [
    PLAYER,
  ]);
  // A reader's nickname for the player: theirs alone, never stored.
  const {
    rows: [{ account_id }],
  } = await db.query(
    `insert into account (email_hash, status) values ('story-reader', 'approved')
     returning account_id`,
  );
  await db.query(
    `insert into player_nickname (account_id, player_tag, nickname)
     values ($1, $2, $3)`,
    [account_id, PLAYER, NICK],
  );
  // Two sittings: three days ago, and two hours ago (three battles).
  await battle("story-old-0", NOW - 3 * DAY);
  await battle("story-old-1", NOW - 3 * DAY + 5 * MIN, "loss");
  for (const [i, m] of [130, 125, 120].entries())
    await battle(`story-new-${i}`, NOW - m * MIN, i === 1 ? "loss" : "win");
});

after(async () => {
  await ctx?.drop();
});

test("the writer stores the builder's stories once; a second run writes nothing", async () => {
  const first = await writeSubjectStories(db, "player", PLAYER, storySpan(NOW));
  assert.equal(first.stories, 2);
  assert.equal(first.written, 2);
  assert.equal(first.deleted, 0);
  const again = await writeSubjectStories(db, "player", PLAYER, storySpan(NOW));
  assert.deepEqual(again, { stories: 2, written: 0, deleted: 0 });
  const stored = await rows();
  assert.deepEqual(
    stored.map((r) => [r.kind, r.revision]),
    [
      ["battle_session", 2],
      ["battle_session", 3],
    ],
  );
  assert.equal(STORY_SPAN_DAYS, 35);
});

test("nothing stored is a reader's: no nickname, text or local", async () => {
  for (const r of await rows()) {
    const json = JSON.stringify(r.item);
    assert.ok(!json.includes(NICK), "a nickname was stored");
    for (const k of ["text", "local", "at_unix", "late", "nickname"])
      assert.ok(!(k in r.item), `${k} was stored`);
    // The server-only fields survive as plain keys.
    assert.ok(Array.isArray(r.item._spark));
  }
});

test("the page's computed timeline and the rows agree right after a write", async () => {
  const diff = await compare(NOW);
  assert.equal(diff.computed, 2);
  assert.equal(diff.stored, 2);
  for (const k of ["only_computed", "only_stored", "revision", "content"])
    assert.equal(diff[k], 0, `${k}: ${JSON.stringify(diff)}`);
  assert.ok(diff.newest_built_at);
});

test("a sitting that grows moves its row and its revision; the comparison sees it first", async () => {
  const before = (await rows()).at(-1);
  await battle("story-new-3", NOW - 115 * MIN);
  const now = NOW + MIN;
  const diff = await compare(now);
  assert.equal(diff.revision, 1);
  assert.deepEqual(diff.ids.revision, [before.story_id]);
  const r = await writeSubjectStories(db, "player", PLAYER, storySpan(now));
  assert.equal(r.written, 1);
  const after = (await rows()).at(-1);
  assert.equal(after.story_id, before.story_id);
  assert.equal(after.revision, 4);
  assert.notEqual(after.content_hash, before.content_hash);
  assert.equal((await compare(now)).revision, 0);
});

test("the comparison names each kind of difference", async () => {
  const now = NOW + 2 * MIN;
  // Content: the player's name moved, which the facts carry.
  await db.query(`update player set name = 'Oak Leaf' where player_tag = $1`, [
    PLAYER,
  ]);
  // Only computed: a sitting no write has seen.
  await battle("story-newest-0", NOW - 40 * MIN);
  // Only stored: a row no build tells.
  await db.query(
    `insert into timeline_story
       (subject_kind, subject_tag, story_id, kind, section, revision, at,
        sort_at, observed_at, visibility, content_hash, item)
     values ('player', $1, 'tl_00000000000000000001', 'returned', 'presence',
             1, $2, $2, $2, 'public', 'x', '{}')`,
    [PLAYER, iso(NOW - 2 * DAY)],
  );
  const diff = await compare(now);
  assert.equal(diff.only_computed, 1);
  assert.equal(diff.only_stored, 1);
  assert.deepEqual(diff.ids.only_stored, ["tl_00000000000000000001"]);
  assert.equal(diff.content, 2, JSON.stringify(diff));
  assert.equal(diff.revision, 0);
  // Ids only: nothing of an item's contents.
  assert.ok(!JSON.stringify(diff).includes("Oak"));
});

test("a write deletes inside its span what the build no longer tells, and keeps what is outside it", async () => {
  const now = NOW + 3 * MIN;
  await db.query(
    `insert into timeline_story
       (subject_kind, subject_tag, story_id, kind, section, revision, at,
        sort_at, observed_at, visibility, content_hash, item)
     values ('player', $1, 'tl_00000000000000000002', 'returned', 'presence',
             1, $2, $2, $2, 'public', 'x', '{}')`,
    [PLAYER, iso(NOW - 40 * DAY)],
  );
  const r = await writeSubjectStories(db, "player", PLAYER, storySpan(now));
  assert.equal(r.deleted, 1);
  const ids = (await rows()).map((x) => x.story_id);
  assert.ok(!ids.includes("tl_00000000000000000001"), "inside: deleted");
  assert.ok(ids.includes("tl_00000000000000000002"), "outside: kept");
  const diff = await compare(now);
  for (const k of ["only_computed", "only_stored", "revision", "content"])
    assert.equal(diff[k], 0, `${k}: ${JSON.stringify(diff)}`);
});

test("clans are refused until their stage", async () => {
  await assert.rejects(
    writeSubjectStories(db, "clan", "#0Q2L8", storySpan(NOW)),
    /players only/,
  );
});
