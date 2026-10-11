/**
 * The clan's activity channel as an editor (2026-10-11): items become
 * stories (one member's one battle, same-kind milestones across members,
 * a sitting that grows), some are skipped by rule with a reason, a story
 * waits until it is quiet, and Elixir tells each in its own words with
 * no clock time and no link.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STORY_HOLD_MAX_MS,
  STORY_HOLD_QUIET_MS,
  STORY_SKIPS,
  buildStories,
  leadSafe,
  renderStory,
  storyDigest,
  storyReady,
  whenWords,
} from "../src/stories.mjs";

const T = Date.parse("2026-10-11T18:00:00Z");
const MIN = 60_000;
const H = 3_600_000;
const at = (ms) => new Date(ms).toISOString();
let n = 0;
const id = () => `tl_${String(++n).padStart(20, "0")}`;
const item = (kind, facts, ms = T, extra = {}) => ({
  id: id(),
  kind,
  revision: 1,
  at: at(ms),
  observed_at: at(ms),
  facts,
  text: `${facts.name ?? "Someone"} did a ${kind}.`,
  ...extra,
});
const ADA = { player_tag: "#AAA", name: "Ada" };
const BO = { player_tag: "#BBB", name: "Bo" };
const WIN = {
  battle_id: "b1",
  crowns: 3,
  crowns_against: 0,
  opponent: { name: "keyluis", player_tag: "#OPP", starting_trophies: 11980 },
  trophies_after: 12_005,
};

test("one member's one battle is one story; its arena move, new best and promotion are told together", () => {
  const arena = item("arena_changed", {
    ...ADA,
    from: 54000020,
    to: 54000021,
    to_name: "Magic Academy",
    promoted_by: WIN,
  });
  const best = item("best_trophies_band", {
    ...ADA,
    band: 12_000,
    best: 12_005,
    crossed_by: WIN,
  });
  const { stories, skips } = buildStories([arena, best]);
  assert.equal(stories.length, 1);
  assert.deepEqual(skips, []);
  assert.equal(stories[0].key, arena.id, "keyed by its first item");
  const text = renderStory(stories[0], {
    deck: { label: "Evo P.E.K.K.A control", mode: "ladder", won: 9, lost: 2 },
    promotions: 2,
    mates: ["Bo", "Cy"],
    nowMs: T + 6 * MIN,
  });
  assert.equal(
    text,
    "Ada moved up to Magic Academy with a 3-0 win over keyluis and set a new best of 12,005 trophies, passing 12,000, joining Bo and Cy there. It's their second promotion in a day. Their Evo P.E.K.K.A control deck is 9-2 on ladder this season.",
  );
  assert.doesNotMatch(text, /<t:|https?:|#OPP|#AAA/, "no time, link or tag");
});

test("a new best told as it happened: the crossing, then the peak after it", () => {
  const best = item("best_trophies_band", {
    ...ADA,
    band: 12_000,
    best: 12_032,
    crossed_by: WIN,
  });
  assert.equal(
    renderStory({ key: best.id, items: [best] }, { nowMs: T }),
    "Ada passed 12,000 trophies for the first time with a 3-0 win over keyluis. They went on to a best of 12,032.",
  );
});

test("same-kind milestones across members are one story; one member's two are not merged", () => {
  const a = item("career_wins_step", { ...ADA, wins: 5000, step: 5000 });
  const b = item("career_wins_step", { ...BO, wins: 5000, step: 5000 });
  const a2 = item("card_unlocked", { ...ADA, card: "Goblin Machine" });
  const a3 = item("card_unlocked", { ...ADA, card: "Rune Giant" });
  const { stories } = buildStories([a, b, a2, a3]);
  assert.deepEqual(
    stories.map((s) => s.items.length),
    [2, 1, 1],
  );
  assert.equal(
    renderStory(stories[0], { nowMs: T }),
    "Ada and Bo passed 5,000 career wins.",
  );
  assert.equal(
    buildStories([a, b], { group: false }).stories.length,
    2,
    "grouping can be off",
  );
});

test("skips by rule, each with its reason: a badge below its top level, an item already told", () => {
  const low = item("badge_earned", {
    ...ADA,
    badge: "MasteryHog",
    badge_label: "Hog Mastery",
    level: 5,
    max_level: 10,
  });
  const top = item("badge_earned", {
    ...BO,
    badge: "Played2Years",
    badge_label: "Two Years Played",
    level: 2,
    max_level: 2,
  });
  const again = item("arena_changed", {
    ...ADA,
    from: 54000020,
    to: 54000021,
    to_name: "Magic Academy",
  });
  const sameBattle = item("ranked_promotion", {
    ...BO,
    to_name: "Champion",
    promoted_by: { ...WIN, battle_id: "b9" },
  });
  const { stories, skips } = buildStories([low, top, again, sameBattle], {
    valuesTold: new Set(["arena_changed|#AAA|arena:54000021"]),
    battlesTold: new Set(["#BBB|b9"]),
  });
  assert.deepEqual(
    stories.map((s) => s.key),
    [top.id],
  );
  assert.equal(
    renderStory(stories[0], { nowMs: T }),
    "Bo took Two Years Played to its top level, 2.",
  );
  assert.deepEqual(
    skips.map((k) => [k.item.id, k.reason, k.record]),
    [
      [low.id, "badge_level", true],
      [again.id, "already_told", true],
      [sameBattle.id, "already_told", true],
    ],
  );
  for (const k of skips) assert.ok(STORY_SKIPS[k.reason]);
  // A skip recorded before is not recorded again.
  const { skips: later } = buildStories([{ ...low, revision: 2 }], {
    told: new Map([
      [low.id, { skipped: true, skip_reason: "badge_level", revision: 1 }],
    ]),
  });
  assert.deepEqual(
    later.map((k) => [k.reason, k.record, k.silent]),
    [["badge_level", false, true]],
  );
});

test("a sitting is one story that grows: edited only when its best win or its run moves", () => {
  const facts = {
    ...ADA,
    battles: 6,
    won: 5,
    lost: 1,
    by_mode: { ladder: 4, ranked: 2 },
    trophy_net: 120,
    won_in_a_row: 4,
    decks: [{ label: "Hog Rider cycle", battles: 6 }],
    best_win: { ...WIN, battle_id: "b5" },
    open: true,
  };
  const sit = item("session_standout", facts);
  const first = buildStories([sit]).stories[0];
  assert.equal(
    renderStory(first, { nowMs: T }),
    "Ada went 5-1 over 6 battles in one sitting playing Hog Rider cycle (4 ladder, 2 ranked), +120 trophies, winning 4 in a row. The best was a 3-0 win over keyluis.",
  );
  const told = new Map([
    [
      sit.id,
      {
        story_key: sit.id,
        digest: storyDigest(first),
        revision: 2,
        story_size: 1,
      },
    ],
  ]);
  // One more win, the same best and a run still under five: only grew.
  const grew = {
    ...sit,
    revision: 2,
    facts: { ...facts, battles: 7, won: 6 },
  };
  const quiet = buildStories([grew], { told });
  assert.equal(quiet.stories.length, 0);
  assert.deepEqual(
    quiet.skips.map((k) => [k.reason, k.record]),
    [["only_grew", true]],
  );
  // A run of five: news, the same post edited.
  const run = { ...grew, facts: { ...grew.facts, won_in_a_row: 5 } };
  const edited = buildStories([run], { told });
  assert.equal(edited.stories.length, 1);
  assert.equal(edited.stories[0].key, sit.id);
  assert.equal(edited.stories[0].grown, true);
});

test("a story told with others stands: a grown item inside it is quiet", () => {
  const a = item("career_wins_step", { ...ADA, wins: 5000, step: 5000 });
  const b = item("career_wins_step", { ...BO, wins: 5000, step: 5000 });
  const told = new Map([
    [a.id, { story_key: a.id, digest: "x", revision: 1, story_size: 2 }],
    [b.id, { story_key: a.id, revision: 1 }],
  ]);
  const { stories, skips } = buildStories(
    [
      { ...a, revision: 2 },
      { ...b, revision: 2 },
    ],
    { told },
  );
  assert.equal(stories.length, 0);
  assert.deepEqual(
    skips.map((k) => [k.reason, Boolean(k.silent)]),
    [
      ["only_grew", false],
      ["only_grew", true],
    ],
  );
});

test("a story is held until quiet, or until held long enough", () => {
  const obs = (it) => Date.parse(it.observed_at);
  const s = { items: [item("card_unlocked", { ...ADA, card: "Rune Giant" })] };
  assert.equal(storyReady(s, T + MIN, obs), false);
  assert.equal(storyReady(s, T + STORY_HOLD_QUIET_MS, obs), true);
  const growing = {
    items: [
      item("card_unlocked", { ...ADA, card: "A" }, T),
      item("card_unlocked", { ...BO, card: "B" }, T + 9 * MIN),
    ],
  };
  assert.equal(storyReady(growing, T + 9 * MIN + 30_000, obs), false);
  assert.equal(storyReady(growing, T + STORY_HOLD_MAX_MS, obs), true);
});

test("the roster: a departure says departed; a leader's word says removed or left; a join says a second stint", () => {
  const left = item("member_left", { ...ADA, role_at_departure: "elder" });
  assert.equal(
    renderStory(
      { items: [left] },
      { members: { "#AAA": { tenure_days: 40 } }, nowMs: T },
    ),
    "Ada, an elder, departed the clan after 40 days.",
  );
  const kick = item("departure_classified", { ...ADA, kind: "kick" });
  assert.equal(
    renderStory({ items: [kick] }, { nowMs: T }),
    "Ada was removed from the clan.",
  );
  const leave = item("departure_classified", { ...ADA, kind: "leave" });
  assert.doesNotMatch(renderStory({ items: [leave] }, { nowMs: T }), /removed/);
  const join = item("member_joined", { ...BO });
  assert.equal(
    renderStory(
      { items: [join] },
      { members: { "#BBB": { stints_before: 1 } }, nowMs: T },
    ),
    "Bo joined the clan, back for a second stint.",
  );
  // A baseline member's tenure is when tracking began: never said.
  assert.equal(
    renderStory(
      { items: [left] },
      { members: { "#AAA": { tenure_days: 40, baseline: true } }, nowMs: T },
    ),
    "Ada, an elder, departed the clan.",
  );
});

test("the war week: points, never a share of fame", () => {
  const week = item("week_resolved", {
    section_index: 2,
    rank: 1,
    fame: 10_000,
    trophy_change: 20,
    members: [
      { name: "Ada", points: 3600, decks_used: 16 },
      { name: "Bo", points: 3000, decks_used: 16 },
    ],
  });
  assert.equal(
    renderStory({ items: [week] }, { nowMs: T }),
    "War week 3 finished in place 1 with 10,000 fame (+20 war trophies), led by Ada (3,600 points, 16 decks) and Bo (3,000 points, 16 decks).",
  );
});

test("no clock time: a story over three hours late says when in words", () => {
  assert.equal(whenWords(T - 2 * H, T), "");
  assert.equal(whenWords(T - 5 * H, T), "Earlier today");
  assert.equal(whenWords(T - 30 * H, T), "Yesterday");
  assert.equal(whenWords(T - 72 * H, T), "3 days ago");
  const late = item(
    "card_unlocked",
    { ...ADA, card: "Rune Giant" },
    T - 30 * H,
  );
  assert.equal(
    renderStory({ items: [late] }, { nowMs: T }),
    "Yesterday: Ada unlocked Rune Giant.",
  );
});

test("a post never opens as Discord markdown", () => {
  assert.equal(leadSafe("# King joined"), "\\# King joined");
  assert.equal(leadSafe("1. Ada"), "\\1. Ada");
  assert.equal(leadSafe("Ada joined"), "Ada joined");
});
