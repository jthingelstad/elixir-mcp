import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertResponseMeta,
  responseMeta,
  DISCLAIMER,
  CONTRACT_VERSION,
  ERROR_CODES,
  toolError,
} from "../dist/index.js";

test("every response meta carries disclaimer and contract version", () => {
  const meta = responseMeta({ as_of: "2026-09-03T12:00:00Z" });
  assert.equal(meta.disclaimer, DISCLAIMER);
  assert.equal(meta.contract_version, CONTRACT_VERSION);
  assert.ok(DISCLAIMER.includes("not endorsed by Supercell"));
});

test("error taxonomy is closed and stable", () => {
  assert.deepEqual([...ERROR_CODES].sort(), [
    "bad_request",
    "invalid_tag",
    "live_unavailable",
    "not_entitled",
    "not_found",
    "not_recorded",
    "quota_exceeded",
  ]);
});

test("toolError omits hint cleanly when absent", () => {
  assert.deepEqual(toolError("not_recorded", "no recording for #ABC"), {
    code: "not_recorded",
    message: "no recording for #ABC",
  });
});

test("pre-reset window: final hour before Monday 00:10 UTC only", async () => {
  const { inPreResetWindow, nextDonationResetMs } =
    await import("../dist/index.js");
  // Sunday 2026-09-06 23:20Z -> inside (reset Monday 2026-09-07 00:10Z)
  assert.equal(inPreResetWindow(new Date("2026-09-06T23:20:00Z")), true);
  // Sunday 22:00Z -> outside
  assert.equal(inPreResetWindow(new Date("2026-09-06T22:00:00Z")), false);
  // Monday 00:05Z -> still inside (reset at 00:10)
  assert.equal(inPreResetWindow(new Date("2026-09-07T00:05:00Z")), true);
  // Monday 00:15Z -> outside; next reset is NEXT Monday
  assert.equal(inPreResetWindow(new Date("2026-09-07T00:15:00Z")), false);
  assert.equal(
    new Date(
      nextDonationResetMs(new Date("2026-09-07T00:15:00Z")),
    ).toISOString(),
    "2026-09-14T00:10:00.000Z",
  );
  // Midweek -> outside
  assert.equal(inPreResetWindow(new Date("2026-09-03T12:00:00Z")), false);
});

test("metadata distinguishes absent history and unknown sources from zero age", () => {
  const meta = responseMeta({
    as_of: "2026-09-08T00:00:00Z",
    recorded_since: "2026-08-01T00:00:00Z",
    recording_active_since: "2026-09-01T00:00:00Z",
    timezone_applied: "America/Chicago",
    freshness_seconds: null,
    source_polls: {
      player: { observed_at: "2026-09-08T00:00:00Z", freshness_seconds: 0 },
      player_battlelog: { observed_at: null, freshness_seconds: null },
    },
  });
  assert.doesNotThrow(() =>
    assertResponseMeta(JSON.parse(JSON.stringify(meta))),
  );
  for (const changed of [
    { recorded_since: null },
    { recorded_since: "2026-09-08" },
    { recording_started: "2026-09-08T00:00:00Z" },
    { freshness_seconds: -1 },
    { freshness_seconds: NaN },
    { events_pending: "2" },
    { source_polls: { player: { observed_at: null, freshness_seconds: 0 } } },
    {
      source_polls: {
        player: {
          observed_at: "2026-09-08T00:00:00Z",
          freshness_seconds: null,
        },
      },
    },
    { request_id: "not-a-receipt" },
    { contract_version: "stale" },
    { disclaimer: "" },
  ])
    assert.throws(() => assertResponseMeta({ ...meta, ...changed }), TypeError);
  for (const key of ["as_of", "disclaimer", "contract_version"]) {
    const incomplete = { ...meta };
    delete incomplete[key];
    assert.throws(() => assertResponseMeta(incomplete), TypeError);
  }
  assert.throws(() => responseMeta({ as_of: "yesterday" }), TypeError);
});
