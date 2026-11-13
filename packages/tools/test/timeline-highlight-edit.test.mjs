/**
 * A highlight's edit on the timeline (Codex review of #773; 0240): the
 * record learns a highlight again when its words change, so a poller
 * reading by observation is served the correction as the same story (one
 * id, the same posting time) at a higher revision, and the news check
 * says so; a read by when things happened still finds it where it was
 * posted. On a scratch database (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import {
  buildTimeline,
  subjectsFor,
  timelineNews,
} from "../src/activity/entries.mjs";

const T = Date.parse("2026-09-20T12:00:00Z");
const H = 3_600_000;
const at = (ms) => new Date(ms).toISOString();
const PLAYER = "#0L98VL0Y";

let ctx;
let db;
let owner;
let subjects;
let highlightId;

const highlights = async (fromMs, toMs, basis) =>
  (
    await buildTimeline(db, subjects, {
      fromMs,
      toMs,
      timezone: "UTC",
      accountId: owner,
      interactive: true,
      ...(basis ? { basis } : {}),
    })
  ).timeline.filter((it) => it.kind === "battle_highlight");
const news = async (fromMs, toMs) =>
  (
    await timelineNews(db, subjects, {
      fromMs,
      toMs,
      accountId: owner,
      kinds: ["battle_highlight"],
    })
  ).sources.player_highlights;

before(async () => {
  ctx = await scratchDb("timeline_highlight_edit");
  db = ctx.db;
  await db.query(`insert into player (player_tag, name) values ($1, 'me')`, [
    PLAYER,
  ]);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('hl-edit-1', $1, 'PvP', 'pvp', $2)`,
    [at(T - 2 * H), at(T - 2 * H + 60_000)],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side,
       type, type_class, crowns, trophy_change, outcome)
     values ('hl-edit-1', $1, $2, 0, 'PvP', 'pvp', 3, 30, 'win')`,
    [PLAYER, at(T - 2 * H)],
  );
  owner = (
    await db.query(
      `insert into account (email_hash, status, timezone)
       values ('hl-edit-owner', 'approved', 'UTC') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [owner, PLAYER],
  );
  subjects = await subjectsFor(db, owner);
  // Posted at T; edited at T+3h (as the web API writes an edit).
  highlightId = (
    await db.query(
      `insert into battle_highlight (player_tag, battle_id, account_id, words,
                                     created_at, updated_at)
       values ($1, 'hl-edit-1', $2, 'first words', $3, $3)
       returning highlight_id`,
      [PLAYER, owner, at(T)],
    )
  ).rows[0].highlight_id;
});

after(async () => ctx?.drop());

test("an edit is served to a poller as the same story at a higher revision", async () => {
  // The poller's first read, before the edit: revision 1.
  const [first] = await highlights(T - H, T + H);
  assert.ok(first, "the post is in the window it was made in");
  assert.equal(first.revision, 1);
  assert.equal(first.facts.words, "first words");
  assert.equal(first.at, at(T));
  assert.equal(first.observed_at, at(T));

  await db.query(
    `update battle_highlight
        set words = 'better words', revision = revision + 1, updated_at = $2
      where highlight_id = $1`,
    [highlightId, at(T + 3 * H)],
  );

  // The next read, from the poller's pointer: the news check finds it,
  // and the build serves it under the same id, posted when it was.
  assert.equal(await news(T + H, T + 4 * H), true);
  const [grown] = await highlights(T + H, T + 4 * H);
  assert.ok(grown, "the edit is in the window that learned it");
  assert.equal(grown.id, first.id);
  assert.equal(grown.revision, 2);
  assert.equal(grown.at, first.at);
  assert.equal(grown.observed_at, at(T + 3 * H));
  assert.equal(grown.facts.words, "better words");
  assert.equal(grown.late, true, "it happened before the window");

  // An observed read is where the record learned it last; a read by
  // when things happened still finds it where it was posted, grown.
  assert.deepEqual(await highlights(T - H, T + H), []);
  const [occurred] = await highlights(T - H, T + H, "occurred");
  assert.equal(occurred.id, first.id);
  assert.equal(occurred.revision, 2);
  assert.equal(occurred.facts.words, "better words");
  // A window after the edit holds nothing new.
  assert.equal(await news(T + 4 * H, T + 5 * H), false);
  assert.deepEqual(await highlights(T + 4 * H, T + 5 * H), []);
});
