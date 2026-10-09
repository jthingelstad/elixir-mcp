import assert from "node:assert/strict";
import test from "node:test";
import {
  FORM_MIN_BATTLES,
  deckChange,
  deckForm,
  formArgs,
  formWindows,
  gameWeekStartMs,
  weekForm,
} from "../src/form.mjs";

const at = (s) => Date.parse(s);
const iso = (ms) => new Date(ms).toISOString();

test("the game week starts on the Monday 10:00Z at or before the instant", () => {
  // Thursday evening, Central: the week that began Monday 10:00Z.
  assert.equal(
    iso(gameWeekStartMs(at("2026-10-09T02:00:00Z"))),
    "2026-10-05T10:00:00.000Z",
  );
  // A Monday before the reset is still the week before.
  assert.equal(
    iso(gameWeekStartMs(at("2026-10-05T09:59:59Z"))),
    "2026-09-28T10:00:00.000Z",
  );
  assert.equal(
    iso(gameWeekStartMs(at("2026-10-05T10:00:00Z"))),
    "2026-10-05T10:00:00.000Z",
  );
  // Sunday is the end of a week, never the start of one.
  assert.equal(
    iso(gameWeekStartMs(at("2026-10-04T23:00:00Z"))),
    "2026-09-28T10:00:00.000Z",
  );
});

test("the windows are the week and the four whole game weeks before it, in UTC", () => {
  const start = at("2026-10-05T10:00:00Z");
  assert.deepEqual(formWindows(start), {
    week: { from: "2026-10-05T10:00:00.000Z", to: "2026-10-12T10:00:00.000Z" },
    previous: {
      from: "2026-09-07T10:00:00.000Z",
      to: "2026-10-05T10:00:00.000Z",
    },
  });
  // A running week is open to now: no `to`, so the read reaches the present.
  const running = formWindows(start, { running: true });
  assert.equal(running.week.to, null);
  assert.deepEqual(formArgs(running, "ladder", { player_tag: "#P" }), {
    player_tag: "#P",
    from: "2026-10-05T10:00:00.000Z",
    compare_from: "2026-09-07T10:00:00.000Z",
    compare_to: "2026-10-05T10:00:00.000Z",
    mode: "ladder",
  });
  assert.equal(
    formArgs(formWindows(start), "war").to,
    "2026-10-12T10:00:00.000Z",
  );
});

const w = (over = {}) => ({
  battles: 31,
  wins: 17,
  losses: 14,
  draws: 0,
  decided_battles: 31,
  win_rate: 0.548,
  head_to_head_battles: 30,
  three_crown_rate: 0.2,
  net_trophies: 45,
  ...over,
});

test("the week reading keeps battles_performance's own numbers, each beside its count", () => {
  const form = weekForm(
    {
      window: w(),
      compare_window: w({
        battles: 112,
        decided_battles: 112,
        win_rate: 0.48,
        head_to_head_battles: 110,
        three_crown_rate: 0.15,
        net_trophies: 120,
      }),
    },
    "ladder",
  );
  assert.equal(form.mode, "ladder");
  assert.equal(form.week.win_rate, 0.548);
  assert.equal(form.week.decided_battles, 31);
  assert.equal(form.previous.win_rate, 0.48);
  assert.equal(form.previous.decided_battles, 112);
  assert.equal(form.week.three_crown_rate, 0.2);
  assert.equal(form.previous.net_trophies, 120);
});

test("below the minimum on either side there is no reading at all", () => {
  const few = w({ decided_battles: FORM_MIN_BATTLES - 1 });
  assert.equal(weekForm({ window: few, compare_window: w() }, "ladder"), null);
  assert.equal(weekForm({ window: w(), compare_window: few }, "ladder"), null);
  assert.equal(weekForm({ window: w() }, "ladder"), null);
  assert.equal(weekForm(null, "ladder"), null);
  // Exactly the minimum is enough.
  const ten = w({ decided_battles: FORM_MIN_BATTLES });
  assert.ok(weekForm({ window: ten, compare_window: ten }, "ladder"));
});

test("a number under the minimum on either side is dropped from both, so a pair is like for like", () => {
  const form = weekForm(
    {
      window: w({ head_to_head_battles: 4 }),
      compare_window: w(),
    },
    "ladder",
  );
  assert.equal(form.week.three_crown_rate, null);
  assert.equal(form.previous.three_crown_rate, null);
  assert.equal(form.week.win_rate, 0.548);
});

test("net trophies are shown only in a mode where trophies move", () => {
  for (const mode of ["war", "event"]) {
    const form = weekForm({ window: w(), compare_window: w() }, mode);
    assert.equal(form.week.net_trophies, null, mode);
    assert.equal(form.previous.net_trophies, null, mode);
  }
  for (const mode of ["ladder", "ranked"])
    assert.equal(
      weekForm({ window: w(), compare_window: w() }, mode).week.net_trophies,
      45,
      mode,
    );
});

const decks = (rows, total, from = "2026-09-07T10:00:00.000Z") => ({
  applied: { window: { from } },
  total_battles_in_window: total,
  decks: rows,
});
const row = (over) => ({
  deck_hash: "a".repeat(64),
  archetype_label: "Hog Rider control",
  battles: 23,
  wins: 22,
  losses: 1,
  first_used: "2026-09-30T02:23:15.000Z",
  ...over,
});

test("the deck changed when the season's most-played deck arrived after other decks", () => {
  assert.deepEqual(deckChange(decks([row()], 112)), {
    deck_hash: "a".repeat(64),
    label: "Hog Rider control",
    battles: 23,
    wins: 22,
    losses: 1,
    since: "2026-09-30T02:23:15.000Z",
  });
  // Played from the season's first battle: no change.
  assert.equal(
    deckChange(decks([row({ first_used: "2026-09-07T10:00:00.000Z" })], 112)),
    null,
  );
  // The only deck of the season: nothing came before it.
  assert.equal(deckChange(decks([row()], 23)), null);
  assert.equal(deckChange(decks([], 0)), null);
  assert.equal(deckChange(null), null);
});

test("the deck reading is the before_after answer, under the same minimum", () => {
  const form = deckForm(
    {
      before: w({ decided_battles: 89, win_rate: 0.787 }),
      after: w({ decided_battles: 23, win_rate: 0.957 }),
    },
    "ladder",
  );
  assert.equal(form.before.win_rate, 0.787);
  assert.equal(form.since.win_rate, 0.957);
  assert.equal(form.since.decided_battles, 23);
  assert.equal(
    deckForm({ before: w({ decided_battles: 3 }), after: w() }, "ladder"),
    null,
  );
});
