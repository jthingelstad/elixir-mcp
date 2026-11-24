import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeKindsAt,
  exceptionActiveAt,
  exceptionEvents,
  exceptionProblem,
  kindApplies,
  outOfBand,
  EXCEPTION_KINDS,
  EXCEPTION_MAX_DAYS,
} from "../src/exceptions.mjs";

const DAY = 86400_000;
const T0 = Date.parse("2026-11-23T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("an exception runs from when it was set to its end date, or until it is ended early", () => {
  const ex = {
    player_tag: "#0RC",
    kind: "keep_in_clan",
    set_at: iso(T0),
    until: iso(T0 + 7 * DAY),
  };
  assert.equal(exceptionActiveAt(ex, T0 - 1), false, "not before it was set");
  assert.equal(exceptionActiveAt(ex, T0), true);
  assert.equal(exceptionActiveAt(ex, T0 + 7 * DAY - 1), true);
  assert.equal(exceptionActiveAt(ex, T0 + 7 * DAY), false, "ends on its date");
  const ended = { ...ex, ended_at: iso(T0 + DAY) };
  assert.equal(exceptionActiveAt(ended, T0 + DAY - 1), true);
  assert.equal(exceptionActiveAt(ended, T0 + DAY), false);
  assert.equal(
    exceptionActiveAt({ ...ex, until: null }, T0),
    false,
    "no end date protects nothing: every exception ends",
  );
  assert.equal(exceptionActiveAt({ ...ex, kind: "leader" }, T0), false);
});

test("kinds by member at an instant, and which ones take a member out of the band", () => {
  const at = (kind, tag) => ({
    player_tag: tag,
    kind,
    set_at: iso(T0 - DAY),
    until: iso(T0 + DAY),
  });
  const kinds = activeKindsAt(
    [
      at("keep_as_elder", "#0E"),
      at("keep_in_clan", "#0E"),
      at("not_for_elder", "#0M"),
      at("keep_as_elder", "#0M"),
      at("not_for_elder", "#0E2"),
    ],
    T0,
  );
  assert.deepEqual([...kinds.get("#0E")].sort(), [
    "keep_as_elder",
    "keep_in_clan",
  ]);
  const roles = { "#0E": "elder", "#0M": "member", "#0E2": "elder" };
  const out = outOfBand(kinds, (t) => roles[t]);
  assert.deepEqual([...out].sort(), ["#0E", "#0M"]);
  assert.equal(kindApplies("keep_as_elder", "elder"), true);
  assert.equal(kindApplies("keep_as_elder", "member"), false);
  assert.equal(kindApplies("not_for_elder", "elder"), false);
  assert.equal(kindApplies("away", "member"), true);
});

test("an exception is checked before it is saved: kind, role, an end date within a year, who can see it", () => {
  const ok = {
    kind: "keep_in_clan",
    until: iso(T0 + 30 * DAY),
    visibility: "leaders",
    note: "Family trip",
  };
  const ctx = { role: "member", nowMs: T0 };
  assert.equal(exceptionProblem(ok, ctx), null);
  assert.equal(exceptionProblem({ ...ok, kind: "hold" }, ctx), "bad_kind");
  assert.equal(
    exceptionProblem(ok, { ...ctx, role: "coLeader" }),
    "leaders_are_automatic",
  );
  assert.equal(
    exceptionProblem({ ...ok, kind: "keep_as_elder" }, ctx),
    "elders_only",
  );
  assert.equal(
    exceptionProblem(
      { ...ok, kind: "not_for_elder" },
      { ...ctx, role: "elder" },
    ),
    "members_only",
  );
  assert.equal(exceptionProblem({ ...ok, until: null }, ctx), "bad_until");
  assert.equal(exceptionProblem({ ...ok, until: iso(T0) }, ctx), "bad_until");
  assert.equal(
    exceptionProblem({ ...ok, until: iso(T0 + EXCEPTION_MAX_DAYS * DAY) }, ctx),
    null,
    "a year is the most",
  );
  assert.equal(
    exceptionProblem(
      { ...ok, until: iso(T0 + (EXCEPTION_MAX_DAYS + 1) * DAY) },
      ctx,
    ),
    "too_long",
  );
  assert.equal(
    exceptionProblem({ ...ok, visibility: "public" }, ctx),
    "bad_visibility",
  );
  assert.equal(
    exceptionProblem({ ...ok, kind: "away", visibility: "leaders" }, ctx),
    "bad_visibility",
    "Away is always seen by the clan",
  );
  assert.equal(
    exceptionProblem({ ...ok, note: "x".repeat(201) }, ctx),
    "bad_note",
  );
  assert.deepEqual(Object.keys(EXCEPTION_KINDS), [
    "keep_in_clan",
    "keep_as_elder",
    "not_for_elder",
    "away",
  ]);
});

test("a member's exception history: each saved event, and an expiry when one ran out by itself", () => {
  const ran = {
    exception_id: "a",
    player_tag: "#0RC",
    kind: "keep_as_elder",
    visibility: "clan",
    set_at: iso(T0 - 20 * DAY),
    until: iso(T0 - 5 * DAY),
    events: [
      {
        event: "added",
        at: iso(T0 - 20 * DAY),
        by: "#0LEAD",
        by_name: "Lead",
        until: iso(T0 - 10 * DAY),
        visibility: "clan",
        note: null,
      },
      {
        event: "changed",
        at: iso(T0 - 12 * DAY),
        by: "#0LEAD",
        by_name: "Lead",
        until: iso(T0 - 5 * DAY),
        visibility: "clan",
        note: null,
      },
    ],
  };
  const ended = {
    exception_id: "b",
    player_tag: "#0RC",
    kind: "keep_in_clan",
    visibility: "leaders",
    set_at: iso(T0 - 3 * DAY),
    until: iso(T0 + 30 * DAY),
    ended_at: iso(T0 - DAY),
    events: [
      {
        event: "added",
        at: iso(T0 - 3 * DAY),
        by: "#0LEAD",
        by_name: "Lead",
        until: iso(T0 + 30 * DAY),
        visibility: "leaders",
        note: "Trip",
      },
      {
        event: "ended",
        at: iso(T0 - DAY),
        by: "#0LEAD",
        by_name: "Lead",
        until: iso(T0 + 30 * DAY),
        visibility: "leaders",
        note: null,
      },
    ],
  };
  const events = exceptionEvents([ended, ran], T0);
  assert.deepEqual(
    events.map((e) => [e.exception_id, e.kind, e.event]),
    [
      ["a", "keep_as_elder", "added"],
      ["a", "keep_as_elder", "changed"],
      ["a", "keep_as_elder", "expired"],
      ["b", "keep_in_clan", "added"],
      ["b", "keep_in_clan", "ended"],
    ],
  );
  const expired = events[2];
  assert.equal(expired.at, ran.until);
  assert.equal(expired.by, null, "Elixir's own");
  assert.equal(
    exceptionEvents([ended, ran], T0 - 6 * DAY).some(
      (e) => e.event === "expired",
    ),
    false,
    "nothing expires before its date",
  );
});
