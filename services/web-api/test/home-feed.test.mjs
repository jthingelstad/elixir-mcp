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
  offersFollow,
  proofModeOf,
  scoresOf,
  sparkBars,
  sparkOf,
} from "../src/feed.mjs";

const ME = "#2PYLQ0";
const ALT = "#2PYLQ2";
const FRIEND = "#2PYLQ8";
const CLAN = "#2PYLQJ";
const MEMBER = "#2PYLQC";
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

test("foldAccountLines: one line per kind and burst, however the kinds interleave", async () => {
  const { foldAccountLines } = await import("../src/bell.mjs");
  const at = (min) => new Date(Date.UTC(2026, 10, 12, 17, min)).toISOString();
  const rows = [
    // Newest first, as the read orders them.
    { kind: "recording_started", created_at: at(40), player_tag: "#2PYLQ0" },
    { kind: "claim_added", created_at: at(40), player_tag: "#2PYLQ0" },
    { kind: "recording_started", created_at: at(39), player_tag: "#2PYLQ2" },
    { kind: "claim_added", created_at: at(39), player_tag: "#2PYLQ2" },
    { kind: "clan_added", created_at: at(38), clan_tag: "#2PYLQJ" },
    // Twenty minutes before: a burst of its own.
    { kind: "claim_added", created_at: at(18), player_tag: "#2PYLQ8" },
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

test("a clan arrival offers Follow only for a player you do not follow", () => {
  const subjects = [
    { kind: "player", tag: "#2Y0P8V", relationship: "friend" },
    { kind: "clan", tag: "#2PQRJ8LV" },
  ];
  const joined = (tag) => ({
    kind: "member_joined",
    facts: { player_tag: tag },
  });
  assert.equal(offersFollow(joined("#8QYLGV"), subjects), true);
  assert.equal(offersFollow(joined("#2Y0P8V"), subjects), false);
  assert.equal(
    offersFollow({ kind: "member_joined", facts: {} }, subjects),
    false,
  );
  assert.equal(
    offersFollow(
      { kind: "member_left", facts: { player_tag: "#8QYLGV" } },
      subjects,
    ),
    false,
  );
});
