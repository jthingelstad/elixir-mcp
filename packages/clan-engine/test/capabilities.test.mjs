import { test } from "node:test";
import assert from "node:assert/strict";
import { policyCapabilities } from "../src/capabilities.mjs";
import { EXAMPLE_POLICY } from "./fixture.mjs";

const byKey = (lines) => Object.fromEntries(lines.map((l) => [l.key, l]));

test("removal and the away question are live when switched on, off when not", () => {
  const on = byKey(
    policyCapabilities(
      {
        ...EXAMPLE_POLICY,
        removal_enabled: true,
        away_suggestions_enabled: true,
      },
      {
        members: 30,
      },
    ),
  );
  assert.equal(on.removal.status, "live");
  assert.equal(on.removal.status_label, "Live");
  assert.match(on.removal.detail, /removal day without a battle/);
  assert.equal(on.away.status, "live");
  assert.match(on.away.detail, /reaches at risk without a battle/);
  const off = byKey(
    policyCapabilities(
      { ...EXAMPLE_POLICY, removal_enabled: false },
      {
        members: 30,
      },
    ),
  );
  assert.equal(off.removal.status, "off");
  assert.equal(off.away.status, "off");
});

test("a live judgment needs more evidence below the minimum or before a review week", () => {
  const values = {
    ...EXAMPLE_POLICY,
    elder_mode: "categories",
    removal_enabled: true,
    departures_enabled: true,
  };
  const big = byKey(policyCapabilities(values, { members: 30 }));
  assert.equal(big.elder.status, "live");
  assert.equal(big.departures.status, "live");
  const small = byKey(policyCapabilities(values, { members: 6 }));
  assert.equal(small.elder.status, "needs_evidence");
  assert.match(small.elder.detail, /Needs 10 members; the clan has 6/);
  assert.equal(small.departures.status, "needs_evidence");
  assert.equal(small.removal.status, "needs_evidence");
  const fresh = byKey(
    policyCapabilities(values, { members: 30, boundaries: [] }),
  );
  assert.equal(fresh.elder.status, "needs_evidence");
  assert.match(fresh.elder.detail, /finished review week/);
  const unsaved = byKey(policyCapabilities(values, { set: false }));
  assert.ok(Object.values(unsaved).every((l) => l.status === "needs_evidence"));
});
