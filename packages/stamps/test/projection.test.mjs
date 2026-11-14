/**
 * The public passport's whitelist: extra fields on the input never reach
 * the output, an unverified claim shows as a claim without art, no player
 * shows "New player", and earned rows reduce to the highest level with
 * its day (or the legacy "earned before" day).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { NEW_PLAYER, publicPassport } from "../src/projection.mjs";

const PRIVATE = [
  "email",
  "email_hash",
  "account_id",
  "nickname",
  "discord",
  "username",
  "city",
  "country",
  "region",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "timezone",
  "time_zone",
  "token",
  "limit",
  "usage",
  "progress",
  "count",
];

function keysOf(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  return out;
}

test("only whitelisted fields leave, whatever the input carries", () => {
  const out = publicPassport({
    passport_id: "abcdefghjkmn",
    account_id: "00000000-0000-0000-0000-000000000001",
    email: "someone@example.com",
    primary: {
      tag: "#0PYLQ2",
      name: "Invented Player",
      verified: true,
      avatar_card_id: 26000000,
      nickname: "Private word",
      email: "someone@example.com",
      timezone: "America/Chicago",
    },
    earned: [
      {
        stamp_id: "on_the_map",
        level: 1,
        earned_on: "2026-11-14",
        city: "Somewhere",
        lat: 1,
      },
    ],
  });
  assert.deepEqual(out, {
    passport: {
      id: "abcdefghjkmn",
      display_name: "Invented Player",
      player: {
        tag: "#0PYLQ2",
        name: "Invented Player",
        verified: true,
        avatar_card_id: 26000000,
      },
      earned: [
        {
          stamp_id: "on_the_map",
          level: 1,
          earned_on: "2026-11-14",
          earned_before: null,
        },
      ],
    },
    catalog_version: 1,
  });
  const keys = keysOf(out);
  for (const k of PRIVATE) assert.ok(!keys.has(k), k);
  assert.doesNotMatch(JSON.stringify(out), /example\.com|Somewhere|Chicago/);
});

test("an unverified claim is a claim, without the picture", () => {
  const out = publicPassport({
    passport_id: "abcdefghjkmn",
    primary: {
      tag: "#0PYLQ2",
      name: "Invented Player",
      verified: false,
      avatar_card_id: 26000000,
    },
    earned: [],
  });
  assert.deepEqual(out.passport.player, {
    tag: "#0PYLQ2",
    name: "Invented Player",
    verified: false,
    avatar_card_id: null,
  });
});

test("no player: New player and no player object", () => {
  const out = publicPassport({
    passport_id: "abcdefghjkmn",
    primary: null,
    earned: [],
  });
  assert.equal(out.passport.display_name, NEW_PLAYER);
  assert.equal(out.passport.player, null);
  // A player not yet read has no name: New player, never the tag.
  const unread = publicPassport({
    passport_id: "abcdefghjkmn",
    primary: { tag: "#0PYLQ2", name: null, verified: false },
    earned: [],
  });
  assert.equal(unread.passport.display_name, NEW_PLAYER);
});

test("earned: highest level per Stamp, catalog order, unknown ids dropped", () => {
  const out = publicPassport({
    passport_id: "abcdefghjkmn",
    primary: null,
    earned: [
      { stamp_id: "storyteller", level: 1, earned_on: "2026-11-01" },
      { stamp_id: "storyteller", level: 2, earned_on: "2026-11-09" },
      { stamp_id: "player_verified", level: 1, earned_on: "2026-10-30" },
      { stamp_id: "retired_thing", level: 1, earned_on: "2026-10-30" },
      { stamp_id: "mutual", level: 4, earned_on: "2026-10-30" },
      {
        stamp_id: "cheerleader",
        level: 1,
        earned_on: null,
        legacy_before: "2026-11-20",
      },
    ],
  });
  assert.deepEqual(out.passport.earned, [
    {
      stamp_id: "player_verified",
      level: 1,
      earned_on: "2026-10-30",
      earned_before: null,
    },
    {
      stamp_id: "cheerleader",
      level: 1,
      earned_on: null,
      earned_before: "2026-11-20",
    },
    {
      stamp_id: "storyteller",
      level: 2,
      earned_on: "2026-11-09",
      earned_before: null,
    },
  ]);
});
