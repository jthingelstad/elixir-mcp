import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_KEYS, defaults, validate } from "../src/policy.mjs";
import { policyFromGoals } from "../src/goals.mjs";
import {
  CATEGORY_WORDS,
  DIRECTORY_POLICY_FIELDS,
  MINIMUM_FIELD,
  POSTURE_WORDS,
  QUESTIONS,
  directoryPolicy,
  elderSeats,
  questionOf,
  rulesCheck,
  seatShareFor,
  setWeightShare,
  weightShares,
} from "../src/rules.mjs";

// A ranked clan: Elders by participation at 30% of the roster.
const ranked = () => ({
  ...policyFromGoals(["war", "donations"], "standard"),
  band_ceiling_share: 0.3,
});

test("six questions ask every field exactly once, so nothing a leader can set is lost", () => {
  assert.equal(QUESTIONS.length, 6);
  const asked = QUESTIONS.flatMap((q) => [...q.fields, ...q.more]);
  assert.equal(new Set(asked).size, asked.length, "no field asked twice");
  assert.deepEqual([...asked].sort(), [...FIELD_KEYS].sort());
  for (const k of FIELD_KEYS) assert.ok(questionOf(k), k);
  assert.equal(questionOf("not_a_field"), null);
  assert.equal(questionOf("band_ceiling_share"), "elder");
  assert.equal(questionOf("confirm_days"), "quiet");
});

test("each category has a weekly goal field and plain words", () => {
  for (const [c, key] of Object.entries(MINIMUM_FIELD)) {
    assert.ok(FIELD_KEYS.includes(key), key);
    assert.equal(questionOf(key), "weekly");
    assert.ok(CATEGORY_WORDS[c]);
  }
  assert.deepEqual(Object.values(POSTURE_WORDS), [
    "Chill",
    "Steady",
    "Hardcore",
  ]);
});

test("Elder seats come from band(): 30% of 47 is 14, so 15 Elders fill them", () => {
  const seats = elderSeats(ranked(), { members: 47, elders: 15 });
  assert.deepEqual(seats, { seats: 14, elders: 15, open: 0, full: true });
  assert.deepEqual(elderSeats(ranked(), { members: 47, elders: 10 }), {
    seats: 14,
    elders: 10,
    open: 4,
    full: false,
  });
  // Exactly at the line is full too: nobody new can be promoted.
  assert.equal(elderSeats(ranked(), { members: 47, elders: 14 }).full, true);
  // Elders by hand have no seats to count, and an unknown roster none.
  assert.equal(elderSeats(defaults(), { members: 47, elders: 15 }), null);
  assert.equal(elderSeats(ranked(), { members: null, elders: 15 }), null);
});

test("the seat fix is the smallest whole percent that opens one seat", () => {
  const share = seatShareFor(ranked(), { members: 47, elders: 15 });
  assert.equal(share, 0.33);
  assert.equal(
    elderSeats(
      { ...ranked(), band_ceiling_share: share },
      { members: 47, elders: 15 },
    ).seats,
    16,
  );
  assert.equal(
    seatShareFor(ranked(), { members: 10, elders: 10 }),
    null,
    "no share opens a seat past the whole roster",
  );
});

test("the Rules check says when Elder seats are full, with a one-tap fix", () => {
  const found = rulesCheck(ranked(), { members: 47, elders: 15 });
  const full = found.find((f) => f.kind === "seats_full");
  assert.equal(full.question, "elder");
  assert.match(full.text, /room for 14 and you have 15/);
  assert.deepEqual(full.fix.set, { band_ceiling_share: 0.33 });
  assert.equal(full.fix.label, "Make room for 16 (33%)");
  const fixed = { ...ranked(), ...full.fix.set };
  assert.equal(
    rulesCheck(fixed, { members: 47, elders: 15 }).some(
      (f) => f.kind === "seats_full",
    ),
    false,
  );
  assert.deepEqual(rulesCheck(ranked(), { members: 47, elders: 10 }), []);
});

test("a measure that counts for nothing is named, and the fix turns it off", () => {
  const v = { ...ranked(), trophies_enabled: true, trophies_min: 0 };
  v.elder_weight_trophies = 0;
  const found = rulesCheck(v, {});
  const idle = found.filter((f) => f.kind === "counts_nothing");
  assert.equal(idle.length, 1);
  assert.equal(idle[0].question, "weekly");
  assert.equal(
    idle[0].text,
    "Trophies are on but do nothing. They count 0% for Elder and have no goal.",
  );
  assert.deepEqual(idle[0].fix.set, { trophies_enabled: false });
  // A weight alone, or a goal alone, is something.
  assert.equal(rulesCheck({ ...v, elder_weight_trophies: 10 }, {}).length, 0);
  assert.equal(rulesCheck({ ...v, trophies_min: 4000 }, {}).length, 0);
  // With Elders by hand, a category with no goal does nothing either.
  const byHand = {
    ...defaults(),
    donations_enabled: true,
    donations_min_weekly: 0,
  };
  assert.match(rulesCheck(byHand, {})[0].text, /picked by hand/);
});

test("validation errors are shown once each, at their question, and stop the other checks", () => {
  const v = { ...ranked(), at_risk_days: 2, watch_days: 5 };
  const found = rulesCheck(v, { members: 47, elders: 15 });
  assert.deepEqual(
    found.map((f) => [f.kind, f.key, f.question]),
    [["invalid", "at_risk_days", "quiet"]],
  );
  assert.equal(found[0].text, validate(v).errors.at_risk_days);
});

test("weights show as whole percents adding to 100, and one change rebalances the rest", () => {
  const v = ranked();
  assert.deepEqual(weightShares(v), { war: 63, donations: 37 });
  const set = setWeightShare(v, "war", 40);
  assert.deepEqual(set, { elder_weight_war: 40, elder_weight_donations: 60 });
  const three = {
    ...v,
    ranked_enabled: true,
    elder_weight_war: 50,
    elder_weight_ranked: 25,
    elder_weight_donations: 25,
  };
  const after = setWeightShare(three, "war", 20);
  assert.equal(after.elder_weight_war, 20);
  assert.equal(after.elder_weight_ranked, 40);
  assert.equal(after.elder_weight_donations, 40);
  assert.equal(
    Object.values(setWeightShare(three, "ranked", 33)).reduce((s, x) => s + x),
    100,
  );
  // Others all zero: the rest is shared evenly.
  const zero = { ...three, elder_weight_ranked: 0, elder_weight_donations: 0 };
  assert.deepEqual(setWeightShare(zero, "war", 50), {
    elder_weight_war: 50,
    elder_weight_ranked: 25,
    elder_weight_donations: 25,
  });
  assert.deepEqual(setWeightShare(v, "trophies", 50), {}, "not counted");
  assert.deepEqual(
    weightShares({ ...v, elder_weight_war: 0, elder_weight_donations: 0 }),
    {
      war: 0,
      donations: 0,
    },
  );
});

test("the directory's public part reads only its own fields", () => {
  const v = ranked();
  const tile = directoryPolicy(v);
  assert.deepEqual(Object.keys(tile).sort(), [
    "counted",
    "posture",
    "removal_day",
    "together",
    "war_intent",
  ]);
  assert.deepEqual(tile.counted, ["war", "donations"]);
  assert.equal(tile.removal_day, v.confirm_days);
  assert.equal(tile.war_intent, "unknown");
  // Nothing outside DIRECTORY_POLICY_FIELDS changes it.
  const only = Object.fromEntries(
    DIRECTORY_POLICY_FIELDS.map((k) => [k, v[k]]),
  );
  assert.deepEqual(directoryPolicy(only), tile);
  assert.equal(
    directoryPolicy({ ...v, removal_enabled: false }).removal_day,
    null,
  );
});
