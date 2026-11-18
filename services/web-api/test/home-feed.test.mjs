/**
 * Home's one feed (slice 7, #765): what the website adds to each timeline
 * item, and nothing else. Which chips an item sits under, a sitting's
 * sparkline, and the battle that proved a moment. Synthetic tags and names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotateFeed,
  groupsOf,
  proofModeOf,
  scoresOf,
  sparkBars,
  sparkOf,
} from "../src/feed.mjs";

const ME = "#000880";
const ALT = "#09CCYU";
const FRIEND = "#0GLP0L";
const CLAN = "#0PPPG9";
const MEMBER = "#02JVUC";
const SUBJECTS = [
  { tag: ME, kind: "player", relationship: "primary" },
  { tag: ALT, kind: "player", relationship: "alt" },
  { tag: FRIEND, kind: "player", relationship: "friend" },
  { tag: CLAN, kind: "clan" },
];

test("an item sits under the chips its subjects make it", () => {
  const about = (...tags) => ({
    subject_tag: tags[0],
    subjects: tags.map((tag) => ({ tag })),
  });
  assert.deepEqual(groupsOf(about(ME), SUBJECTS), ["you"]);
  assert.deepEqual(groupsOf(about(ALT), SUBJECTS), ["you"]);
  assert.deepEqual(groupsOf(about(FRIEND), SUBJECTS), ["friends"]);
  // A clanmate's line names the clan among its subjects.
  assert.deepEqual(groupsOf(about(MEMBER, CLAN), SUBJECTS), ["clan"]);
  assert.deepEqual(groupsOf(about(CLAN), SUBJECTS), ["clan"]);
  // A friend in your clan is under both.
  assert.deepEqual(groupsOf(about(FRIEND, CLAN), SUBJECTS), [
    "friends",
    "clan",
  ]);
  // About nobody followed: the account's own (a feedback answer).
  assert.deepEqual(groupsOf({ subjects: [] }, SUBJECTS), ["you"]);
  // A followed account's news is Friends, even about no player you follow
  // or about no player at all; your own player's verification is You.
  const person = (...tags) => ({ ...about(...tags), section: "people" });
  assert.deepEqual(groupsOf(person(), SUBJECTS), ["friends"]);
  assert.deepEqual(groupsOf(person(MEMBER), SUBJECTS), ["friends"]);
  assert.deepEqual(groupsOf(person(FRIEND), SUBJECTS), ["friends"]);
  assert.deepEqual(groupsOf(person(ME), SUBJECTS), ["you"]);
});

test("a sparkline is outcome and crown margin, one to three", () => {
  assert.deepEqual(
    sparkBars([
      { outcome: "win", margin: 3 },
      { outcome: "loss", margin: -1 },
      { outcome: "draw", margin: 0 },
      { outcome: "win", margin: null },
      // A margin past three (a crown count the game never gives) is three.
      { outcome: "loss", margin: -4 },
    ]),
    [
      { r: "w", m: 3 },
      { r: "l", m: 1 },
      { r: "d", m: 1 },
      { r: "w", m: null },
      { r: "l", m: 3 },
    ],
  );
  assert.equal(sparkBars([]), null);
  // The spark rides a symbol entries.mjs sets; an item without one has none.
  assert.equal(sparkOf({ kind: "battle_session", spark: [{}] }), null);
});

test("annotateFeed adds the chips, the battle's page, and keeps the rest", async () => {
  const BATTLE = "a".repeat(64);
  const db = {
    async query(sql, [ids]) {
      // The faces' profile images (2026-11-14): one read for the page.
      if (/avatar_card_id/.test(sql)) {
        assert.deepEqual(ids, [FRIEND]);
        return { rows: [{ player_tag: FRIEND, avatar_card_id: 26000000 }] };
      }
      assert.match(sql, /unnest/);
      assert.deepEqual(ids, [BATTLE]);
      return { rows: [{ id: BATTLE, prev: null, next: null }] };
    },
  };
  const items = [
    {
      kind: "trophy_milestone",
      subject_tag: FRIEND,
      subjects: [{ tag: FRIEND, kind: "player" }],
      text: "Crossed 6,000 trophies.",
      facts: { crossed_by: { battle_id: BATTLE } },
    },
    { kind: "feedback_answer", subjects: [], text: "An answer.", facts: {} },
  ];
  const out = await annotateFeed(db, items, SUBJECTS);
  assert.deepEqual(out[0].groups, ["friends"]);
  assert.match(out[0].battle_url, /\/battle\/a{12}$/);
  assert.equal(out[0].text, "Crossed 6,000 trophies.");
  assert.equal(out[0].avatar_card_id, 26000000);
  assert.equal(out[1].avatar_card_id, undefined);
  assert.deepEqual(out[1].groups, ["you"]);
  assert.equal(out[1].battle_url, undefined);
  assert.equal(out[1].spark, undefined);
  // Nothing to look up: no read at all.
  assert.deepEqual(
    await annotateFeed(
      {
        query: () => assert.fail("no battle to link"),
      },
      [items[1]],
      SUBJECTS,
    ),
    [{ ...items[1], groups: ["you"] }],
  );
});

test("a Mastery badge names its card, from one catalog read for the page", async () => {
  const reads = [];
  const db = {
    async query(sql, [names]) {
      reads.push(sql);
      if (/from card/.test(sql)) {
        // Guards is the badge's codename SkeletonWarriors, by shown name.
        assert.deepEqual(names, ["Guards", "Knight"]);
        return {
          rows: [
            { card_id: 26000025, name: "Guards" },
            { card_id: 26000000, name: "Knight" },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const badge = (badge, kind = "badge_earned") => ({
    kind,
    subjects: [{ tag: FRIEND, kind: "player" }],
    text: "A badge.",
    facts: { player_tag: FRIEND, badge },
  });
  const out = await annotateFeed(
    db,
    [
      badge("MasterySkeletonWarriors"),
      badge("MasteryKnight"),
      badge("MasteryKnight"),
      badge("Classic12Wins"),
      { ...badge("MasteryKnight"), kind: "card_unlocked" },
    ],
    SUBJECTS,
  );
  assert.deepEqual(
    out.map((it) => it.moment_card ?? null),
    [
      { id: 26000025, name: "Guards" },
      { id: 26000000, name: "Knight" },
      { id: 26000000, name: "Knight" },
      null,
      null,
    ],
  );
  assert.equal(reads.filter((s) => /from card/.test(s)).length, 1);
});

test("a badge moment draws its own art, from one read for the page; absent when none is held (0288)", async () => {
  // Opaque ids are made up; the shape is the API's.
  const icon = (id) =>
    `https://api-assets.clashroyale.com/playerbadges/512/${id}.png`;
  const reads = [];
  const db = {
    async query(sql, params) {
      reads.push(sql);
      if (/from badge_art/.test(sql)) {
        assert.deepEqual(params[0].sort(), [
          "ClanWarWins",
          "Classic12Wins",
          "MasteryKnight",
          "YearsPlayed",
        ]);
        return {
          rows: [
            { name: "YearsPlayed", level: 5, icon_url: icon("yp5") },
            { name: "YearsPlayed", level: 6, icon_url: icon("yp6") },
            { name: "MasteryKnight", level: 10, icon_url: icon("mk10") },
            { name: "Classic12Wins", level: 2, icon_url: icon("c12-2") },
            // A URL the mirror would not copy is no art.
            {
              name: "ClanWarWins",
              level: 0,
              icon_url: "https://x.example/a.png",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const item = (kind, facts) => ({
    kind,
    subjects: [{ tag: FRIEND, kind: "player" }],
    text: "A moment.",
    facts: { player_tag: FRIEND, ...facts },
  });
  const out = await annotateFeed(
    db,
    [
      // The level the line tells, which the game now shows, even when
      // the jump crossed another rung.
      item("badge_earned", { badge: "YearsPlayed", level: 6, rung: 5 }),
      item("badge_earned", { badge: "YearsPlayed", level: 5 }),
      // No row for this level yet: absence, never a neighbour's art.
      item("badge_earned", { badge: "YearsPlayed", level: 7 }),
      item("badge_earned", { badge: "MasteryKnight", level: 10 }),
      // A Mastery roll-up keeps its cards.
      item("badge_earned", {
        badge: "MasteryKnight",
        level: 10,
        badges: [{ badge: "MasteryKnight", level: 10 }],
      }),
      item("twelve_win_run", { badge: "Classic12Wins", runs: 5, level: 2 }),
      item("twelve_win_run", { badge: "Classic12Wins", runs: 6 }),
      item("legendary_badge_earned", { badge: "ClanWarWins" }),
      item("card_unlocked", { badge: "YearsPlayed", level: 6 }),
    ],
    SUBJECTS,
  );
  assert.deepEqual(
    out.map((it) => it.badge_art ?? null),
    [
      "/assets/badges/yp6.png",
      "/assets/badges/yp5.png",
      null,
      "/assets/badges/mk10.png",
      null,
      "/assets/badges/c12-2.png",
      null,
      null,
      null,
    ],
  );
  assert.equal(reads.filter((s) => /from badge_art/.test(s)).length, 1);
  // A page with no badge moment reads nothing for it.
  reads.length = 0;
  await annotateFeed(db, [item("card_unlocked", { card_id: 1 })], SUBJECTS);
  assert.equal(reads.filter((s) => /from badge_art/.test(s)).length, 0);
});

test("foldAccountLines: one line per kind and burst, however the kinds interleave", async () => {
  const { foldAccountLines } = await import("../src/bell.mjs");
  const at = (min) => new Date(Date.UTC(2026, 10, 12, 17, min)).toISOString();
  const rows = [
    // Newest first, as the read orders them.
    { kind: "recording_started", created_at: at(40), player_tag: "#000880" },
    { kind: "claim_added", created_at: at(40), player_tag: "#000880" },
    { kind: "recording_started", created_at: at(39), player_tag: "#09CCYU" },
    { kind: "claim_added", created_at: at(39), player_tag: "#09CCYU" },
    { kind: "clan_added", created_at: at(38), clan_tag: "#0PPPG9" },
    // Twenty minutes before: a burst of its own.
    { kind: "claim_added", created_at: at(18), player_tag: "#0GLP0L" },
  ];
  const out = foldAccountLines(rows, at(30));
  assert.deepEqual(
    out.items.map((l) => [l.kind, l.players, l.clans, l.new]),
    [
      ["recording_started", 2, 0, true],
      ["claim_added", 2, 0, true],
      ["clan_added", 0, 1, true],
      ["claim_added", 1, 0, false],
    ],
  );
  assert.equal(out.new, 3);
  assert.equal(out.items[0].at, at(40));
});

test("a sitting's score facts are its widest win and its three-crown wins", () => {
  assert.deepEqual(
    scoresOf([
      { outcome: "win", margin: 1, crowns: 2, against: 1 },
      { outcome: "loss", margin: -3, crowns: 0, against: 3 },
      { outcome: "win", margin: 3, crowns: 3, against: 0 },
      { outcome: "win", margin: 2, crowns: 3, against: 1 },
    ]),
    { best_win: "3-0", three_crowns: 2 },
  );
  // Since 2026-11-17 a battle says how it was won (winOf): a duel's
  // summed three crowns is no three-crown win, and a level-crowns win the
  // tiebreaker decided is an overtime win.
  assert.deepEqual(
    scoresOf([
      {
        outcome: "win",
        margin: 1,
        crowns: 3,
        against: 2,
        three: false,
        overtime: false,
      },
      {
        outcome: "win",
        margin: 0,
        crowns: 1,
        against: 1,
        three: false,
        overtime: true,
      },
      {
        outcome: "win",
        margin: 3,
        crowns: 3,
        against: 0,
        three: true,
        overtime: false,
      },
    ]),
    { best_win: "3-0", three_crowns: 1, overtime_wins: 1 },
  );
  // A week stored before crowns were kept says nothing.
  assert.equal(scoresOf([{ outcome: "win", margin: 3 }]), null);
  assert.equal(scoresOf([{ outcome: "loss", crowns: 0, against: 1 }]), null);
  assert.equal(scoresOf(null), null);
});

test("a moment's proving battle names its mode for the line under it", () => {
  assert.equal(
    proofModeOf({ facts: { promoted_by: { battle_id: "b", type: "PvP" } } }),
    "ladder",
  );
  assert.equal(
    proofModeOf({ facts: { best_win: { battle_id: "b", mode: "ranked" } } }),
    "ranked",
  );
  assert.equal(proofModeOf({ facts: { crossed_by: { type: "PvP" } } }), null);
  assert.equal(proofModeOf({ facts: {} }), null);
});

test("a Clanmate post belongs to Clan, and an explicit friend's post can belong to both chips", async () => {
  const mates = new Set([MEMBER, FRIEND]);
  const post = (tag) => ({
    kind: "post",
    subject_tag: tag,
    subjects: [{ kind: "player", tag }],
    post: { mine: false },
  });
  assert.deepEqual(groupsOf(post(MEMBER), SUBJECTS, null, mates), ["clan"]);
  assert.deepEqual(groupsOf(post(FRIEND), SUBJECTS, null, mates), [
    "friends",
    "clan",
  ]);
  assert.deepEqual(groupsOf(post(FRIEND), SUBJECTS), ["friends"]);
  const [joined] = await annotateFeed(
    { query: async () => ({ rows: [] }) },
    [
      {
        kind: "member_joined",
        subjects: [{ kind: "clan", tag: CLAN }],
        facts: { player_tag: MEMBER },
      },
    ],
    SUBJECTS,
    null,
    mates,
  );
  assert.equal(joined.offer_follow, undefined);
});
