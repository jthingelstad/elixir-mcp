import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_CATEGORIES,
  activityCategories,
  activityCategory,
  activityPolicy,
  activityShareable,
  cleanVoice,
  tidyVoice,
  namesIn,
  rewriteText,
  VOICE_MAX,
} from "../src/activity.mjs";

const item = (kind, facts = {}, id = "tl_00000000000000000001") => ({
  id,
  kind,
  facts,
});

test("every category's kinds are its own, and each kind has one category", () => {
  const seen = new Set();
  for (const [key, c] of Object.entries(ACTIVITY_CATEGORIES))
    for (const kind of c.kinds) {
      assert.ok(!seen.has(kind), `${kind} is in two categories`);
      seen.add(kind);
      assert.equal(activityCategory(item(kind)), key);
    }
});

test("a leader's departure answer belongs to members; leaders-only and noise never post", () => {
  assert.equal(activityCategory(item("departure_classified")), "members");
  for (const kind of [
    "member_away",
    "battle_session",
    "quiet_crossed",
    "returned",
    "clan_message",
    "role_change_made",
    "clan_activity",
  ])
    assert.equal(activityCategory(item(kind)), null, kind);
});

test("no policy: nothing can be on", () => {
  const p = activityPolicy(null);
  assert.equal(p.ready, false);
  assert.deepEqual(activityCategories({ members: true, war: true }, null), {
    members: false,
    milestones: false,
    war: false,
  });
});

test("the policy's war intent sets war's default and can rule it out", () => {
  assert.equal(
    activityPolicy({ war_intent: "participating" }).defaults.war,
    true,
  );
  assert.equal(activityPolicy({ war_intent: "unknown" }).defaults.war, false);
  assert.equal(activityPolicy({}).defaults.war, false);
  const out = activityPolicy({ war_intent: "not_participating" });
  assert.match(out.ruled_out.war, /does not take part in Clan Wars/);
  // A leader's switch cannot turn on what the policy rules out.
  assert.equal(
    activityCategories({ war: true }, { war_intent: "not_participating" }).war,
    false,
  );
  // But it can turn on war when the intent is not specified.
  assert.equal(
    activityCategories({ war: true }, { war_intent: "unknown" }).war,
    true,
  );
  // And off what the policy would have on.
  assert.deepEqual(
    activityCategories({ members: false }, { war_intent: "participating" }),
    {
      members: false,
      milestones: true,
      war: true,
    },
  );
});

test("an item is shared only under a category that is on", () => {
  const on = { members: true, milestones: false, war: true };
  assert.equal(activityShareable(item("member_joined"), on), true);
  assert.equal(activityShareable(item("badge_earned"), on), false);
  assert.equal(activityShareable(item("race_finished"), on), true);
  assert.equal(activityShareable(item("member_away"), on), false);
});

test("a voice is one short paragraph without links or mentions", () => {
  assert.equal(
    cleanVoice("  Hype!\n\nLots of 🔥 @everyone see https://x.test <b> "),
    "Hype! Lots of 🔥 everyone see b",
  );
  assert.equal(cleanVoice("x".repeat(VOICE_MAX + 50)).length, VOICE_MAX);
  assert.equal(cleanVoice(null), "");
  // The setting refuses words over the bound; it never cuts them.
  assert.equal(tidyVoice("x".repeat(VOICE_MAX + 50)).length, VOICE_MAX + 50);
  assert.equal(
    tidyVoice(" Dry  and\nshort, see www.x.test "),
    "Dry and short, see",
  );
});

test("every person the sentence names is kept, an arena or a league is not; a model's post is tidied, its markdown kept", () => {
  assert.deepEqual(
    namesIn(
      item("session_standout", {
        name: "Ada",
        best_win: { opponent: { name: "Jotaro" } },
        league: { name: "Master I" },
      }),
      "Ada beat Jotaro and reached Master I.",
    ),
    ["Ada", "Jotaro"],
  );
  assert.equal(
    rewriteText("  Welcome **Neo** to <The Clan>!\n "),
    "Welcome **Neo** to The Clan!",
  );
});
