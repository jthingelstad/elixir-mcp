/**
 * A player's own clan news on their timeline (13.10.0, the owner
 * 2026-11-17): a promotion, and the war week at its close.
 *
 * - A promotion was the clan's item alone: a reader who followed the
 *   player and not the clan never saw it. Now the player's timeline
 *   carries it under the clan's story id, so a reader who follows both
 *   reads it once. A demotion stays the clan's.
 * - war_week_played: the week's decks and points as the race recorded
 *   them, at the week's close. Weekly only, never a day and never fame;
 *   a week with no deck played says nothing; never on a clan's timeline,
 *   whose resolved week already lists every member.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { scratchDb } from "../../ingest/test/helpers.mjs";
import { buildTimeline, timelineNews } from "../src/activity/entries.mjs";
import { missingFacts } from "../src/activity/schemas.mjs";

// Invented tags (docs/invented-tags.json).
const CLAN = "#0GJJ9QJL";
const PIP = "#0QYPJ8G2"; // promoted, then demoted; plays all 16 war decks
const ASH = "#0LCRV2PQ"; // in the war week with no deck played
const ROWAN = "#0GUJ9RY8"; // promoted, with nobody following the clan

const H = 3_600_000;
const T = Date.parse("2026-11-12T12:00:00Z");
const at = (ms) => new Date(ms).toISOString();
const SEASON = 131;
const SECTION = 1;

let ctx;
let db;
before(async () => {
  ctx = await scratchDb("timeline_player_clan");
  db = ctx.db;
  await db.query(
    `insert into clan (clan_tag, name) values ($1, 'Ember Hall')`,
    [CLAN],
  );
  for (const [tag, name] of [
    [PIP, "Pip"],
    [ASH, "Ash"],
    [ROWAN, "Rowan"],
  ]) {
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
    await db.query(
      `insert into clan_membership (clan_tag, player_tag, role, joined_observed_at)
       values ($1, $2, 'member', $3)`,
      [CLAN, tag, at(T - 30 * 24 * H)],
    );
  }
  const role = (tag, ms, before, after) =>
    db.query(
      `insert into clan_event (clan_tag, event_type, timing, window_start, window_end,
                               player_tag, role_before, role_after)
       values ($1, 'role_changed', 'estimated', $2, $3, $4, $5, $6)`,
      [CLAN, at(ms - 10 * 60_000), at(ms), tag, before, after],
    );
  await role(PIP, T + H, "member", "elder");
  await role(PIP, T + 2 * H, "elder", "member");
  await role(ROWAN, T + H, "elder", "coLeader");
  // The war week: Pip played all 16, Ash none; resolved at T+3h.
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index) values ($1, $2, $3)`,
    [CLAN, SEASON, SECTION],
  );
  await db.query(
    `insert into war_participation (clan_tag, season_id, section_index, player_tag, points, decks_used)
     values ($1, $2, $3, $4, 3200, 16), ($1, $2, $3, $5, 0, 0)`,
    [CLAN, SEASON, SECTION, PIP, ASH],
  );
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end,
                             war_season_id, section_index, fame, rank)
     values ($1, 'week_resolved', 'estimated', $2, $3, $4, $5, 41000, 2)`,
    [CLAN, at(T + 3 * H - 10 * 60_000), at(T + 3 * H), SEASON, SECTION],
  );
});
after(async () => ctx?.drop());

const player = (tag) => ({ kind: "player", tag, relationship: "friend" });
const clan = { kind: "clan", tag: CLAN, scope: "comprehensive" };
const read = (subjects, fromMs = T, toMs = T + 4 * H) =>
  buildTimeline(db, subjects, { fromMs, toMs });
const ofKind = (timeline, kind) => timeline.filter((i) => i.kind === kind);

test("a player follower who does not follow the clan sees the promotion, never the demotion", async () => {
  const { timeline } = await read([player(PIP)]);
  const roles = ofKind(timeline, "member_role_changed");
  assert.equal(roles.length, 1, "the promotion alone");
  const [r] = roles;
  assert.equal(r.facts.direction, "promoted");
  assert.equal(r.facts.role_after, "elder");
  assert.equal(r.subject_tag, PIP);
  assert.deepEqual(
    r.subjects.map((s) => [s.kind, s.tag]),
    [
      ["player", PIP],
      ["clan", CLAN],
    ],
  );
  assert.equal(r.text, "Pip was promoted from Member to Elder in Ember Hall.");
  assert.equal(r.at, at(T + H));
  assert.deepEqual(missingFacts(r), []);
});

test("following the player and the clan: the promotion is one item under the clan's story id; the demotion is the clan's", async () => {
  const both = await read([player(PIP), clan]);
  const clanOnly = await read([clan]);
  const promotions = (t) =>
    ofKind(t, "member_role_changed").filter(
      (i) => i.facts.player_tag === PIP && i.facts.direction === "promoted",
    );
  assert.equal(promotions(both.timeline).length, 1, "told once");
  assert.equal(
    promotions(both.timeline)[0].id,
    promotions(clanOnly.timeline)[0].id,
    "the clan's own story id",
  );
  assert.equal(promotions(both.timeline)[0].subject_tag, PIP);
  assert.match(promotions(both.timeline)[0].text, /in Ember Hall\.$/);
  const demotions = ofKind(both.timeline, "member_role_changed").filter(
    (i) => i.facts.direction === "demoted",
  );
  assert.equal(demotions.length, 1, "on the clan's timeline only");
});

test("a promotion to Co-Leader reaches a follower of the player alone", async () => {
  const { timeline } = await read([player(ROWAN)]);
  const [r] = ofKind(timeline, "member_role_changed");
  assert.equal(
    r.text,
    "Rowan was promoted from Elder to Co-leader in Ember Hall.",
  );
});

test("the war week at its close: the week's decks and points, never fame, never a day", async () => {
  const { timeline } = await read([player(PIP)]);
  const [w] = ofKind(timeline, "war_week_played");
  assert.ok(w, "said at the close");
  assert.equal(w.at, at(T + 3 * H));
  assert.equal(w.section, "war");
  assert.deepEqual(w.facts, {
    player_tag: PIP,
    name: "Pip",
    clan_tag: CLAN,
    clan_name: "Ember Hall",
    season_id: SEASON,
    section_index: SECTION,
    is_colosseum: false,
    decks_used: 16,
    points: 3200,
  });
  assert.equal(
    w.text,
    "Pip played all 16 war decks in Season 131, week 2, for 3,200 points.",
  );
  assert.deepEqual(missingFacts(w), []);
  // Read again in a later window: the same story, not told twice.
  const again = await read([player(PIP)], T + 3 * H, T + 5 * H);
  assert.deepEqual(ofKind(again.timeline, "war_week_played"), []);
});

test("a week with no deck played says nothing, and the clan's timeline carries no player's week", async () => {
  const ash = await read([player(ASH)]);
  assert.deepEqual(ofKind(ash.timeline, "war_week_played"), []);
  const clanOnly = await read([clan]);
  assert.deepEqual(ofKind(clanOnly.timeline, "war_week_played"), []);
  assert.equal(ofKind(clanOnly.timeline, "week_resolved").length, 1);
});

test("the news check finds both for a follower of the player alone", async () => {
  for (const kinds of [["member_role_changed"], ["war_week_played"]]) {
    const news = await timelineNews(db, [player(PIP)], {
      fromMs: T,
      toMs: T + 4 * H,
      kinds,
    });
    assert.equal(news.any, true, kinds[0]);
  }
  const quiet = await timelineNews(db, [player(PIP)], {
    fromMs: T + 4 * H,
    toMs: T + 5 * H,
  });
  assert.equal(quiet.any, false);
});
