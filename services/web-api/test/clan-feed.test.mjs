/**
 * Clan's Feed (slice 8, #766) over a scratch database (golden rule 9): the
 * clan's timeline for one member, newest first, carrying the highlights of
 * the clan's current members (a member who has left is not in it), each
 * item only its sentence, kind, time and, for a highlight, its words and
 * battle; none of the reader's own account items. Synthetic tags only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../../packages/ingest/test/helpers.mjs";
import { readClanFeed, FEED_DAYS } from "../src/clan-feed.mjs";

const T = Date.parse("2026-11-12T12:00:00Z");
const H = 3_600_000;
const at = (ms) => new Date(ms).toISOString();
const CLAN = "#2PQRJ8LV";
const READER = "#20QQL8CC";
const STAYED = "#8QCVLQ2";
const LEFT = "#9YJUP0Q";

let ctx;
let db;
let reader;

async function playerWithHighlight(tag, name, battleId, words, leftAt) {
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    tag,
    name,
  ]);
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at, role)
     values ($1, $2, $3, $4, 'member')`,
    [CLAN, tag, at(T - 40 * 24 * H), leftAt],
  );
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $2)`,
    [battleId, at(T - 5 * H)],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, battle_time, side,
       type, type_class, crowns, trophy_change, outcome)
     values ($1, $2, $3, 0, 'PvP', 'pvp', 3, 30, 'win')`,
    [battleId, tag, at(T - 5 * H)],
  );
  const owner = (
    await db.query(
      `insert into account (email_hash, status, timezone)
       values ($1, 'approved', 'UTC') returning account_id`,
      [`feed-${name}`],
    )
  ).rows[0].account_id;
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [owner, tag],
  );
  await db.query(
    `insert into battle_highlight (player_tag, battle_id, account_id, words, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $5)`,
    [tag, battleId, owner, words, at(T - 4 * H)],
  );
}

before(async () => {
  ctx = await scratchDb("clan_feed");
  db = ctx.db;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Example Clan')`,
    [CLAN],
  );
  await db.query(
    `insert into player (player_tag, name) values ($1, 'Reader')`,
    [READER],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, $2, $3, 'member')`,
    [CLAN, READER, at(T - 40 * 24 * H)],
  );
  reader = (
    await db.query(
      `insert into account (email_hash, status, timezone)
       values ('feed-reader', 'approved', 'UTC') returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [reader, READER],
  );
  await playerWithHighlight(STAYED, "Stays", "feed-1", "Three crowns", null);
  await playerWithHighlight(LEFT, "Gone", "feed-2", "Old words", at(T - 2 * H));
});

after(async () => {
  await ctx?.drop();
});

test("feed: current members' highlights, shaped to the sentence, never a member who has left", async () => {
  const feed = await readClanFeed(
    db,
    { accountId: reader, timezone: "UTC" },
    CLAN,
    T,
  );
  assert.equal(feed.clan_tag, CLAN);
  assert.equal(feed.window_days, FEED_DAYS);
  assert.equal(typeof feed.more, "number");
  const highlights = feed.items.filter((it) => it.kind === "battle_highlight");
  assert.deepEqual(
    highlights.map((it) => it.words),
    ["Three crowns"],
  );
  const [h] = highlights;
  assert.deepEqual(Object.keys(h).sort(), [
    "at",
    "battle_url",
    "id",
    "kind",
    "text",
    "words",
  ]);
  assert.match(h.text, /Stays/);
  for (const it of feed.items) {
    assert.ok(!("facts" in it), "never an item's facts whole");
    assert.ok(!("section" in it));
  }
  // Newest first.
  const times = feed.items.map((it) => Date.parse(it.at)).filter(Boolean);
  assert.deepEqual(
    times,
    [...times].sort((a, b) => b - a),
  );
});
