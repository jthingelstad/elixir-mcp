import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_CATEGORIES,
  activityCategories,
  activityCategory,
  activityPolicy,
  activityRewriteRequest,
  activityRewritesFromDraft,
  activityShareable,
  cleanVoice,
  rewriteLine,
  rewriteProblem,
  REWRITE_MAX,
  VOICE_MAX,
} from "../src/activity.mjs";
import { PURPOSES } from "../src/words.mjs";

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
});

test("the rewrite carries the line's sentence and public facts, never a tag or id", () => {
  const line = rewriteLine(
    item("session_standout", {
      name: "Quiet",
      player_tag: "#Q",
      battle_id: "b1",
      wins_in_a_row: 10,
      crossed: "10 wins in a row",
      started_at: "2026-10-10T01:00:00Z",
      nested: { a: 1 },
    }),
    "Quiet won 10 in a row.",
  );
  assert.deepEqual(line.facts, {
    name: "Quiet",
    wins_in_a_row: 10,
    crossed: "10 wins in a row",
  });
  assert.deepEqual(line.names, ["Quiet"]);
  const req = activityRewriteRequest({
    clanName: "The Clan",
    voice: "Pirate talk",
    lines: [line],
  });
  assert.equal(req.purpose, "discord_activity");
  assert.ok(PURPOSES[req.purpose], "a purpose the key may be used for");
  assert.match(req.prompt, /Pirate talk/);
  assert.doesNotMatch(req.prompt, /#Q|b1|started_at/);
  assert.match(req.system, /never guesses why/);
  assert.equal(req.tool.name, "write_posts");
});

test("a rewrite keeps every name and invents no number", () => {
  const line = rewriteLine(
    item("career_wins_step", { name: "Ann_99", wins: 5000 }),
    "Ann_99 passed 5,000 career wins.",
  );
  assert.equal(rewriteProblem(line, "Ann_99 just hit 5,000 wins! 🎉"), null);
  assert.equal(rewriteProblem(line, "Ann hit 5,000 wins!"), "name_changed");
  assert.equal(
    rewriteProblem(line, "Ann_99 hit 5,000 wins in 3 years!"),
    "number_invented",
  );
  assert.equal(
    rewriteProblem(line, `Ann_99 ${"!".repeat(REWRITE_MAX)}`),
    "too_long",
  );
  assert.equal(rewriteProblem(line, ""), "empty");
});

test("the answer keeps the posts that pass, tidied, and counts the rest", () => {
  const a = rewriteLine(
    item("member_joined", { name: "Neo" }, "tl_a"),
    "Neo joined The Clan.",
  );
  const b = rewriteLine(
    item("member_left", { name: "Old" }, "tl_b"),
    "Old departed The Clan.",
  );
  const c = rewriteLine(item("race_finished", { fame: 10000 }, "tl_c"), "x");
  const { rewrites, refused } = activityRewritesFromDraft(
    {
      posts: [
        { key: "tl_a", text: "Welcome **Neo** @everyone <https://x.test>!" },
        { key: "tl_b", text: "Someone left." },
        { key: "tl_zz", text: "not asked for" },
        { key: "tl_a", text: "a second answer for a" },
      ],
    },
    [a, b, c],
  );
  assert.deepEqual([...rewrites], [["tl_a", "Welcome **Neo** everyone"]]);
  assert.deepEqual(refused, { name_changed: 1 });
  assert.deepEqual(activityRewritesFromDraft(null, [a]).rewrites.size, 0);
});
