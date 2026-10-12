import { test } from "node:test";
import assert from "node:assert/strict";
import { policyCapabilities } from "../src/capabilities.mjs";
import { REMOVAL_NOT_ENFORCEABLE } from "../src/inactivity.mjs";
import { EXAMPLE_POLICY } from "./fixture.mjs";

const byKey = (lines) => Object.fromEntries(lines.map((l) => [l.key, l]));

test("#426: removal reads not enforceable while it is switched on, off when it is not", () => {
  const on = byKey(
    policyCapabilities(
      { ...EXAMPLE_POLICY, removal_enabled: true },
      {
        members: 30,
      },
    ),
  );
  assert.equal(on.removal.status, "not_enforceable");
  assert.equal(on.removal.status_label, "Not enforceable");
  assert.ok(on.removal.detail.startsWith(REMOVAL_NOT_ENFORCEABLE));
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

test("a live judgment needs more evidence below the minimum or before a review week; not enforceable stays so", () => {
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
  assert.equal(small.removal.status, "not_enforceable");
  const fresh = byKey(
    policyCapabilities(values, { members: 30, boundaries: [] }),
  );
  assert.equal(fresh.elder.status, "needs_evidence");
  assert.match(fresh.elder.detail, /finished review week/);
  const unsaved = byKey(policyCapabilities(values, { set: false }));
  assert.ok(
    Object.values(unsaved).every((l) =>
      ["needs_evidence", "not_enforceable"].includes(l.status),
    ),
  );
});
