/**
 * The Timeline's mode filter (Jamie, 2026-11-17): which of Trophy Road,
 * Ranked, War and Casual each item sits under. Every kind the timeline can
 * build is named in feed.mjs's KIND_MODES, so a new kind fails here until
 * it is classified. Synthetic tags and names.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTESTED_FACT_TYPES, TIMELINE_MODES } from "@elixir-mcp/contracts";
import {
  PEOPLE_KIND_SCHEMAS,
  TIMELINE_KIND_SCHEMAS,
} from "@elixir-mcp/tools/activity/schemas";
import { KIND_MODES, inMode, modesOf } from "../src/feed.mjs";

test("every kind the timeline builds is classified for the mode filter", () => {
  const kinds = [
    ...Object.keys(TIMELINE_KIND_SCHEMAS),
    ...Object.keys(PEOPLE_KIND_SCHEMAS),
    ...Object.keys(ATTESTED_FACT_TYPES),
    // Posts are read live beside the week (posts.mjs).
    "post",
  ];
  const missing = kinds.filter((k) => !(k in KIND_MODES));
  assert.deepEqual(
    missing,
    [],
    "add each to KIND_MODES in services/web-api/src/feed.mjs: the mode it is about, or NO_MODE",
  );
});

test("every classification answers only the four filters", () => {
  const item = (kind) => ({
    kind,
    facts: {
      by_mode: { ladder: 1, ranked: 1, war: 1, casual: 1, event: 1 },
      battle: { mode_group: "challenge" },
      mode: "war",
    },
    post: { battle: { mode_group: "tournament" } },
  });
  for (const kind of Object.keys(KIND_MODES))
    for (const m of modesOf(item(kind)))
      assert.ok(TIMELINE_MODES.includes(m), `${kind}: ${m}`);
});

test("a session sits under each mode it was played in, folded to the four", () => {
  const session = (by_mode) => ({ kind: "battle_session", facts: { by_mode } });
  assert.deepEqual(modesOf(session({ ladder: 4 })), ["ladder"]);
  assert.deepEqual(modesOf(session({ ranked: 2, war: 1 })), ["ranked", "war"]);
  // An event and a challenge are both Casual: one filter, once.
  assert.deepEqual(modesOf(session({ event: 2, challenge: 3 })), ["casual"]);
  assert.deepEqual(
    modesOf({ kind: "session_standout", facts: { by_mode: { ladder: 1 } } }),
    ["ladder"],
  );
  // An older stored week without by_mode is about no mode it can name.
  assert.deepEqual(modesOf({ kind: "battle_session", facts: {} }), []);
});

test("a battle's item is that battle's mode; a post without one is none", () => {
  const highlight = (battle) => ({
    kind: "battle_highlight",
    facts: { battle },
  });
  assert.deepEqual(modesOf(highlight({ mode_group: "ranked" })), ["ranked"]);
  assert.deepEqual(modesOf(highlight({ type: "riverRacePvP" })), ["war"]);
  assert.deepEqual(
    modesOf(highlight({ type: "trail", event_tag: "SomeEvent" })),
    ["casual"],
  );
  assert.deepEqual(modesOf(highlight(null)), []);
  // Posts: with a battle attached, its mode; words, a deck or cards, none.
  assert.deepEqual(
    modesOf({ kind: "post", post: { battle: { mode_group: "ladder" } } }),
    ["ladder"],
  );
  assert.deepEqual(
    modesOf({ kind: "post", post: { text: "gg", deck: {} } }),
    [],
  );
});

test("moments sit under the mode they are about", () => {
  const of = (kind, facts = {}) => modesOf({ kind, facts });
  assert.deepEqual(of("arena_changed"), ["ladder"]);
  assert.deepEqual(of("best_trophies_band"), ["ladder"]);
  assert.deepEqual(of("ranked_promotion"), ["ranked"]);
  assert.deepEqual(of("challenge_best_run"), ["casual"]);
  assert.deepEqual(of("twelve_win_run"), ["casual"]);
  assert.deepEqual(of("race_finished"), ["war"]);
  assert.deepEqual(of("week_resolved"), ["war"]);
  assert.deepEqual(of("deck_switched", { mode: "ranked" }), ["ranked"]);
  // About the player, not one mode.
  for (const kind of [
    "badge_earned",
    "card_unlocked",
    "card_maxed",
    "king_tower_leveled",
    "career_wins_step",
    "member_joined",
    "player_verified",
    "personal_record",
  ])
    assert.deepEqual(of(kind), [], kind);
});

test("an unknown kind is about no mode: All modes shows it, a mode leaves it out", () => {
  const it = { kind: "a_kind_from_the_future", facts: { mode: "ladder" } };
  assert.deepEqual(modesOf(it), []);
  assert.equal(inMode(it, null), true);
  assert.equal(inMode(it, "ladder"), false);
  assert.equal(inMode({ kind: "arena_changed" }, "ladder"), true);
  assert.equal(inMode({ kind: "arena_changed" }, "ranked"), false);
});
