/**
 * Pure eligibility against the build handoff's "Definition details" and
 * the six-step profile list. No database, no clock: every case passes its
 * own snapshot and now.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePassport,
  followActivity,
  profileList,
} from "../src/eligibility.mjs";

const NOW = "2026-11-14T18:00:00.000Z";
const hoursAgo = (h) => new Date(Date.parse(NOW) - h * 3600e3).toISOString();

/** A new person: nothing done, everything known. */
const fresh = (patch = {}) => ({
  person: true,
  primary: null,
  own_verified: false,
  has_alt: false,
  picture_chosen: false,
  discord_linked: false,
  digest_choice: null,
  map: { choice: null, place_saved: false },
  follows: [],
  mutual_count: 0,
  facts: { played_together: 0, cheerleader: 0, storyteller: 0 },
  latches: {},
  earned: [],
  ...patch,
});

const active = () => ({
  last_battle_at: hoursAgo(30),
  battle_log_read_at: hoursAgo(2),
});
const inactive = () => ({
  last_battle_at: null,
  battle_log_read_at: hoursAgo(2),
});
const unknown = () => ({ last_battle_at: null, battle_log_read_at: null });

const row = (ev, id) => ev.stamps.find((s) => s.stamp_id === id);
const grantIds = (ev) => ev.grants.map((g) => `${g.stamp_id}:${g.level}`);
const step = (p, id) => p.steps.find((s) => s.id === id).state;

test("now is required and nothing reads a clock", () => {
  assert.throws(() => evaluatePassport(fresh()), TypeError);
  const a = evaluatePassport(fresh(), NOW);
  const b = evaluatePassport(fresh(), NOW);
  assert.deepEqual(a, b);
  assert.deepEqual(a.grants, []);
  assert.equal(a.catalog_version, 1);
});

test("a non-person earns nothing, whatever its snapshot says", () => {
  const ev = evaluatePassport(
    fresh({
      person: false,
      own_verified: true,
      picture_chosen: true,
      discord_linked: true,
      facts: { played_together: 20, cheerleader: 50, storyteller: 20 },
    }),
    NOW,
  );
  assert.deepEqual(ev.grants, []);
});

test("Player verified: a current verified primary or alt, nothing else", () => {
  assert.deepEqual(
    grantIds(evaluatePassport(fresh({ own_verified: true }), NOW)),
    ["player_verified:1"],
  );
  // An unverified claim, a friend's verification or art alone does not.
  assert.deepEqual(
    grantIds(
      evaluatePassport(
        fresh({ primary: { verified: false }, own_verified: false }),
        NOW,
      ),
    ),
    [],
  );
  // A later revocation does not un-earn: the earned row stays.
  const ev = evaluatePassport(
    fresh({ earned: [{ stamp_id: "player_verified", level: 1 }] }),
    NOW,
  );
  assert.equal(row(ev, "player_verified").earned_level, 1);
  assert.deepEqual(ev.grants, []);
});

test("Looking Good needs an explicit picture; Linked a Discord connection", () => {
  assert.deepEqual(grantIds(evaluatePassport(fresh(), NOW)), []);
  assert.deepEqual(
    grantIds(evaluatePassport(fresh({ picture_chosen: true }), NOW)),
    ["looking_good:1"],
  );
  assert.deepEqual(
    grantIds(evaluatePassport(fresh({ discord_linked: true }), NOW)),
    ["linked:1"],
  );
});

test("On the Map only after a successful place save; Not now never", () => {
  const notNow = evaluatePassport(
    fresh({ map: { choice: "not_now", place_saved: false } }),
    NOW,
  );
  assert.equal(row(notNow, "on_the_map").eligible_level, 0);
  assert.equal(step(notNow.profile, "map"), "done");
  // Choosing to set a place is not a saved place.
  const chose = evaluatePassport(
    fresh({ map: { choice: "place", place_saved: false } }),
    NOW,
  );
  assert.equal(row(chose, "on_the_map").eligible_level, 0);
  const saved = evaluatePassport(
    fresh({ map: { choice: "place", place_saved: true } }),
    NOW,
  );
  assert.deepEqual(grantIds(saved), ["on_the_map:1"]);
  // Not now after a save keeps the save's evidence.
  const later = evaluatePassport(
    fresh({ map: { choice: "not_now", place_saved: true } }),
    NOW,
  );
  assert.deepEqual(grantIds(later), ["on_the_map:1"]);
});

test("Full Roster is an own alt claim, not a friend or the primary", () => {
  assert.deepEqual(grantIds(evaluatePassport(fresh({ has_alt: true }), NOW)), [
    "full_roster:1",
  ]);
  assert.deepEqual(
    grantIds(
      evaluatePassport(
        fresh({ primary: { verified: false }, follows: [active()] }),
        NOW,
      ),
    ),
    [],
  );
});

test("All Set: the six steps, with digest off and map Not now counting", () => {
  const done = fresh({
    primary: { verified: true },
    own_verified: true,
    picture_chosen: true,
    follows: [active()],
    digest_choice: "off",
    map: { choice: "not_now", place_saved: false },
  });
  const ev = evaluatePassport(done, NOW);
  assert.equal(ev.profile.complete, true);
  assert.ok(ev.profile.steps.every((s) => s.state === "done"));
  assert.deepEqual(grantIds(ev).sort(), [
    "all_set:1",
    "looking_good:1",
    "player_verified:1",
  ]);
  // Without an explicit digest choice (the default weekly is not one).
  const noDigest = evaluatePassport({ ...done, digest_choice: null }, NOW);
  assert.equal(noDigest.profile.complete, false);
  assert.equal(step(noDigest.profile, "digest"), "todo");
  // An alt verified while the primary is not: the verify step is the
  // main player's.
  const altOnly = evaluatePassport(
    { ...done, primary: { verified: false }, own_verified: true },
    NOW,
  );
  assert.equal(step(altOnly.profile, "verify_player"), "todo");
  assert.equal(altOnly.profile.complete, false);
  // Alts and Discord are never required.
  assert.equal(done.has_alt, false);
  assert.equal(done.discord_linked, false);
});

test("steps latch and completion stays finished", () => {
  const latched = fresh({
    latches: { picture: hoursAgo(5), digest: hoursAgo(5) },
  });
  const p = profileList(latched, NOW);
  assert.equal(step(p, "picture"), "done");
  assert.equal(p.steps.find((s) => s.id === "picture").latched, true);
  assert.equal(step(p, "digest"), "done");
  assert.equal(p.complete, false);
  const finished = evaluatePassport(
    fresh({ latches: { completed_at: hoursAgo(48) } }),
    NOW,
  );
  assert.equal(finished.profile.complete, true);
  assert.deepEqual(grantIds(finished), ["all_set:1"]);
});

test("the follow step: unknown activity is unknown, never inactive", () => {
  assert.equal(
    step(profileList(fresh({ follows: [inactive()] }), NOW), "follow_active"),
    "todo",
  );
  assert.equal(
    step(
      profileList(fresh({ follows: [inactive(), unknown()] }), NOW),
      "follow_active",
    ),
    "unknown",
  );
  assert.equal(
    step(
      profileList(fresh({ follows: [unknown(), active()] }), NOW),
      "follow_active",
    ),
    "done",
  );
  // Follows not read at all: unknown.
  assert.equal(
    step(profileList(fresh({ follows: null }), NOW), "follow_active"),
    "unknown",
  );
});

test("followActivity: the trailing seven days, a fresh read, no future", () => {
  assert.equal(followActivity(active(), NOW), "active");
  assert.equal(
    followActivity(
      { last_battle_at: hoursAgo(7 * 24 + 1), battle_log_read_at: hoursAgo(1) },
      NOW,
    ),
    "inactive",
  );
  // A stale read: recording is catching up.
  assert.equal(
    followActivity(
      { last_battle_at: null, battle_log_read_at: hoursAgo(25) },
      NOW,
    ),
    "unknown",
  );
  // A battle stamped in the future is not activity.
  assert.equal(
    followActivity(
      { last_battle_at: hoursAgo(-2), battle_log_read_at: null },
      NOW,
    ),
    "unknown",
  );
});

test("Inner Circle: five active followed players; unknown is pending", () => {
  const four = evaluatePassport(
    fresh({
      follows: [active(), active(), active(), active(), unknown(), inactive()],
    }),
    NOW,
  );
  const ic = row(four, "inner_circle");
  assert.equal(ic.eligible_level, 0);
  assert.deepEqual(ic.progress, {
    count: 4,
    next: 5,
    top: 5,
    unknown: true,
    pending: 1,
  });
  const five = evaluatePassport(
    fresh({ follows: Array.from({ length: 5 }, active) }),
    NOW,
  );
  assert.deepEqual(grantIds(five), ["inner_circle:1"]);
});

test("Mutual: one account that follows back", () => {
  assert.deepEqual(grantIds(evaluatePassport(fresh(), NOW)), []);
  assert.deepEqual(
    grantIds(evaluatePassport(fresh({ mutual_count: 2 }), NOW)),
    ["mutual:1"],
  );
  const unread = evaluatePassport(fresh({ mutual_count: null }), NOW);
  assert.equal(row(unread, "mutual").progress.unknown, true);
});

test("ladders: every level from the earned one up, capped at the top", () => {
  const ev = evaluatePassport(
    fresh({
      facts: { played_together: 5, cheerleader: 2, storyteller: 99 },
      earned: [{ stamp_id: "storyteller", level: 1 }],
    }),
    NOW,
  );
  assert.deepEqual(grantIds(ev), [
    "played_together:1",
    "played_together:2",
    "storyteller:2",
    "storyteller:3",
  ]);
  assert.deepEqual(row(ev, "cheerleader").progress, {
    count: 2,
    next: 3,
    top: 50,
    unknown: false,
  });
  assert.deepEqual(row(ev, "storyteller").progress, {
    count: 20,
    next: null,
    top: 20,
    unknown: false,
  });
});

test("earned levels never go down when the evidence lapses", () => {
  const ev = evaluatePassport(
    fresh({
      earned: [
        { stamp_id: "cheerleader", level: 1 },
        { stamp_id: "cheerleader", level: 2 },
        { stamp_id: "inner_circle", level: 1 },
        { stamp_id: "looking_good", level: 1 },
      ],
    }),
    NOW,
  );
  assert.equal(row(ev, "cheerleader").earned_level, 2);
  assert.equal(row(ev, "inner_circle").earned_level, 1);
  assert.equal(row(ev, "looking_good").earned_level, 1);
  assert.deepEqual(ev.grants, []);
});

test("wins, trophies and rank are not inputs", () => {
  const base = evaluatePassport(fresh(), NOW);
  const loud = evaluatePassport(
    fresh({ wins: 5000, trophies: 9000, rank: 1, win_rate: 1 }),
    NOW,
  );
  assert.deepEqual(loud, base);
});
