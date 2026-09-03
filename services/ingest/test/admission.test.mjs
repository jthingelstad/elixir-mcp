import { test } from "node:test";
import assert from "node:assert/strict";
import { admit } from "../src/admission.mjs";
import { fixture } from "./helpers.mjs";

test("all fixture payloads admit", async () => {
  const cases = [
    ["player", "player/profile.json"],
    ["player_battlelog", "player_battlelog/with_boat_and_duel.json"],
    ["player_battlelog", "player_battlelog/with_clanmate_2v2.json"],
    ["player_battlelog", "player_battlelog/with_colosseum_duel.json"],
    ["player_battlelog", "player_battlelog/with_path_of_legend.json"],
    ["player_battlelog", "player_battlelog/empty.json"],
    ["clan", "clan/roster.json"],
    ["currentriverrace", "currentriverrace/war_day.json"],
    ["currentriverrace", "currentriverrace/training.json"],
    ["currentriverrace", "currentriverrace/colosseum.json"],
  ];
  for (const [endpoint, file] of cases) {
    const result = admit(endpoint, await fixture(file));
    assert.deepEqual(
      result,
      { ok: true },
      `${endpoint} ${file}: ${JSON.stringify(result)}`,
    );
  }
});

test("unknown endpoints are rejected, never silently admitted", () => {
  const result = admit("leaderboards", []);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /endpoint:unknown/);
});

test("clan member-count mismatch is rejected", async () => {
  const clan = await fixture("clan/roster.json");
  const corrupted = { ...clan, members: clan.members + 1 };
  const result = admit("clan", corrupted);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("members:count-mismatch"));
});

test("duplicate roster tags are rejected", async () => {
  const clan = await fixture("clan/roster.json");
  const corrupted = {
    ...clan,
    memberList: [...clan.memberList, clan.memberList[0]],
  };
  corrupted.members = corrupted.memberList.length;
  const result = admit("clan", corrupted);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.endsWith("tag:duplicate")));
});

test("battlelog entry missing battleTime is rejected", async () => {
  const log = await fixture("player_battlelog/with_path_of_legend.json");
  const corrupted = [{ ...log[0] }];
  delete corrupted[0].battleTime;
  const result = admit("player_battlelog", corrupted);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("[0].battleTime:missing"));
});

test("riverrace periodIndex/sectionIndex cross-check enforced", async () => {
  const rr = await fixture("currentriverrace/war_day.json");
  const corrupted = { ...rr, sectionIndex: rr.sectionIndex + 1 };
  const result = admit("currentriverrace", corrupted);
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("periodIndex:section-cross-check-failed"));
});
