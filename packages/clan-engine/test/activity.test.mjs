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
  REWRITE_GROUP_MAX,
  REWRITE_MAX,
  VOICE_MAX,
  groupable,
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

test("a post's packet carries its sentence, its facts, its member's record and the week's history; never a tag, an id or a time", () => {
  const line = rewriteLine(
    item("session_standout", {
      name: "Quiet",
      player_tag: "#Q",
      battle_id: "b1",
      wins_in_a_row: 10,
      crossed: "10 wins in a row",
      started_at: "2026-10-10T01:00:00Z",
      best_win: { opponent: { name: "Jotaro", tag: "#J" }, score: "3-0" },
    }),
    "Quiet won 10 in a row.",
    {
      members: [
        {
          name: "Quiet",
          trophies: 9100,
          best_trophies: 9300,
          tenure_days: 120,
        },
      ],
      history: [{ kind: "session_standout", name: "Quiet", count: 2 }],
    },
  );
  assert.equal(line.key, "tl_00000000000000000001");
  assert.equal(line.max, REWRITE_MAX);
  assert.deepEqual(line.names, ["Quiet"]);
  assert.match(
    line.packet,
    /^POST tl_00000000000000000001 \(session_standout\)/,
  );
  assert.match(line.packet, /Elixir's line: Quiet won 10 in a row\./);
  assert.match(line.packet, /- wins_in_a_row: 10/);
  assert.match(line.packet, /- best_win\.opponent\.name: Jotaro/);
  assert.match(line.packet, /- best_win\.score: 3-0/);
  assert.match(line.packet, /ABOUT: Quiet\n- Trophies: 9,100; best ever 9,300/);
  assert.match(
    line.packet,
    /already told 2 other session standout posts about Quiet/,
  );
  assert.doesNotMatch(line.packet, /#Q|#J|b1|started_at|2026-10-10/);
  const req = activityRewriteRequest({
    context:
      "THE CLAN\nName: The Clan\nHow its leaders want it to sound: Pirate talk",
    lines: [line],
  });
  assert.equal(req.purpose, "discord_activity");
  assert.ok(PURPOSES[req.purpose], "a purpose the key may be used for");
  assert.equal(req.effort, "low");
  assert.equal(req.tool.name, "write_posts");
  assert.equal(req.tool.strict, true);
  assert.equal(req.tool.input_schema.additionalProperties, false);
  assert.equal(
    req.tool.input_schema.properties.posts.items.additionalProperties,
    false,
  );
  assert.match(req.context, /Pirate talk/);
  assert.equal(req.prompt, line.packet);
  assert.match(req.system, /never guesses why/);
  assert.match(req.system, /share of the clan's fame is never told/);
});

test("a rewrite keeps every name, invents no number or name, carries no link or mention, and fits its limit", () => {
  const line = rewriteLine(
    item("career_wins_step", {
      name: "Ann_99",
      wins: 5000,
      arena: "Legendary Arena",
    }),
    "Ann_99 passed 5,000 career wins.",
  );
  const clan = "THE CLAN\nName: The Clan\nMembers now: 41";
  assert.equal(
    rewriteProblem(line, "Ann_99 just hit 5,000 wins! 🎉", clan),
    null,
  );
  assert.equal(
    rewriteProblem(
      line,
      "The Clan cheers: Ann_99 hit 5,000 wins in Legendary Arena, one of 41!",
      clan,
    ),
    null,
  );
  assert.equal(
    rewriteProblem(line, "Ann hit 5,000 wins!", clan),
    "name_changed",
  );
  assert.equal(
    rewriteProblem(line, "Ann_99 hit 5,000 wins in 3 years!", clan),
    "number_invented",
  );
  assert.equal(
    rewriteProblem(line, "Ann_99 hit 5,000 wins, just like Jotaro did.", clan),
    "name_invented",
  );
  // A link is refused, never stripped into a post that reads oddly.
  for (const raw of [
    "Ann_99 hit 5,000 wins: https://x.test",
    "Ann_99 hit 5,000 wins, see [here](x)",
    "Ann_99 hit 5,000 wins. royaleapi.com has more",
  ])
    assert.equal(rewriteProblem(line, raw, clan), "link", raw);
  assert.equal(
    rewriteProblem(line, "@everyone Ann_99 hit 5,000 wins", clan),
    "mention",
  );
  assert.equal(
    rewriteProblem(line, `Ann_99 ${"!".repeat(REWRITE_MAX)}`, clan),
    "too_long",
  );
  assert.equal(rewriteProblem(line, "", clan), "empty");
});

test("every person the sentence names is protected, an arena or a league is not", () => {
  const line = rewriteLine(
    item("session_standout", {
      name: "Ada",
      best_win: { opponent: { name: "Jotaro" } },
      league: { name: "Master I" },
    }),
    "Ada beat Jotaro and reached Master I.",
  );
  assert.deepEqual(line.names, ["Ada", "Jotaro"]);
  assert.equal(
    rewriteProblem(line, "Ada beat a rival and climbed."),
    "name_changed",
  );
  assert.equal(rewriteProblem(line, "Ada beat Jotaro in style."), null);
});

test("a run of same-kind milestones is one post with the group's limit; standouts and legendary badges stay their own", () => {
  assert.equal(groupable(item("badge_earned")), true);
  assert.equal(groupable(item("career_wins_step")), true);
  assert.equal(groupable(item("session_standout")), false);
  assert.equal(groupable(item("legendary_badge_earned")), false);
  assert.equal(groupable(item("member_joined")), false);
  assert.equal(groupable(item("race_finished")), false);
  const line = rewriteLine(
    [
      item("badge_earned", { name: "Ada", badge: "Mastery: Knight" }, "tl_a"),
      item("badge_earned", { name: "Ben", badge: "Mastery: Archers" }, "tl_b"),
    ],
    ["Ada earned Mastery: Knight.", "Ben earned Mastery: Archers."],
  );
  assert.equal(line.key, "tl_a");
  assert.equal(line.max, REWRITE_GROUP_MAX);
  assert.deepEqual(line.names, ["Ada", "Ben"]);
  assert.match(line.packet, /2 moments of this kind together; write ONE post/);
  assert.match(line.packet, /Facts of moment 2:\n- name: Ben/);
  assert.equal(
    rewriteProblem(line, "Badges! Ada earned Mastery: Knight."),
    "name_changed",
  );
  assert.equal(
    rewriteProblem(
      line,
      "Two new badges: Ada with Mastery: Knight and Ben with Mastery: Archers.",
    ),
    null,
  );
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
  const d = rewriteLine(
    item("member_joined", { name: "Lin" }, "tl_d"),
    "Lin joined.",
  );
  const { rewrites, refused } = activityRewritesFromDraft(
    {
      posts: [
        { key: "tl_a", text: "Welcome **Neo** to <The Clan>!" },
        { key: "tl_b", text: "Someone left." },
        { key: "tl_d", text: "Lin joined, see https://x.test" },
        { key: "tl_zz", text: "not asked for" },
        { key: "tl_a", text: "a second answer for a" },
      ],
    },
    [a, b, c, d],
    "THE CLAN\nName: The Clan",
  );
  assert.deepEqual([...rewrites], [["tl_a", "Welcome **Neo** to The Clan!"]]);
  assert.deepEqual(refused, { name_changed: 1, link: 1 });
  assert.deepEqual(activityRewritesFromDraft(null, [a]).rewrites.size, 0);
});
