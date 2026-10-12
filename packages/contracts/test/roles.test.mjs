import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  ROLE_ORDER,
  roleQuotas,
  isRole,
  canSetRole,
  tierSql,
  ADMIN_SETTABLE,
} from "../dist/index.js";
import * as contracts from "../dist/index.js";

test("the ladder is monotonic - no quota shrinks as you climb", () => {
  const keys = Object.keys(ROLES.member);
  for (let i = 1; i < ROLE_ORDER.length; i++) {
    const lower = ROLES[ROLE_ORDER[i - 1]];
    const upper = ROLES[ROLE_ORDER[i]];
    for (const k of keys) {
      assert.ok(
        upper[k] >= lower[k],
        `${ROLE_ORDER[i]}.${k} (${upper[k]}) < ${ROLE_ORDER[i - 1]}.${k} (${lower[k]})`,
      );
    }
  }
});

test("unknown or null role resolves to member - never a crash, never more", () => {
  assert.deepEqual(roleQuotas(null), ROLES.member);
  assert.deepEqual(roleQuotas("intruder"), ROLES.member);
  assert.equal(isRole("intruder"), false);
  assert.equal(isRole("family"), true);
});

test("no operator bonus: running a collector earns Family, nothing on top (#539)", () => {
  assert.equal(contracts.OPERATOR_BONUS, undefined);
  assert.deepEqual(roleQuotas("member", { operator: true }), ROLES.member);
  assert.deepEqual(roleQuotas("family"), ROLES.family);
});

test("Leader and Family are earned, never granted (#530)", () => {
  assert.deepEqual(ADMIN_SETTABLE, ["member", "partner"]);
  for (const actor of ["owner", "admin"]) {
    assert.equal(canSetRole(actor, "member", "leader"), false, actor);
    assert.equal(canSetRole(actor, "member", "family"), false, actor);
    assert.equal(canSetRole(actor, "member", "partner"), true, actor);
    assert.equal(canSetRole(actor, "partner", "member"), true, actor);
    // A stored grant from before 2026-10-12 can be moved off.
    assert.equal(canSetRole(actor, "leader", "member"), true, actor);
  }
  assert.equal(canSetRole("admin", "member", "admin"), false);
  assert.equal(canSetRole("owner", "member", "admin"), true);
  assert.equal(canSetRole("owner", "owner", "member"), false);
  assert.equal(canSetRole("partner", "member", "partner"), false);
});

test("tierSql reads grants for partner and up, grounds below, and refuses a bad alias", () => {
  const sql = tierSql("a");
  assert.match(sql, /a\.role in \('partner', ?'admin', ?'owner'\)/);
  assert.match(sql, /status = 'active'/);
  assert.match(sql, /status = 'verified'/);
  assert.match(sql, /'leader', ?'coLeader'/);
  assert.match(sql, /left_observed_at is null/);
  assert.throws(() => tierSql("a; drop table account"));
});

test("admin is unlimited on every axis", () => {
  for (const v of Object.values(ROLES.admin)) assert.equal(v, Infinity);
});

test("every tier tracks 50 players; the ladder differentiates elsewhere", () => {
  // Fifty because one comprehensive clan watch already records about that
  // many, and recordings are SHARED - a clanmate of a clan you already record
  // costs nothing to add. Player slots are deliberately no longer a rung:
  // clan watches, calls, the live lane, collections and integrations are.
  for (const role of ["member", "leader", "family", "partner"])
    assert.equal(ROLES[role].player_slots, 50, role);
  assert.equal(ROLES.admin.player_slots, Infinity);
});

test("the tiers still differ where cost actually scales", () => {
  assert.equal(ROLES.member.comprehensive_clans, 0);
  assert.equal(ROLES.member.activity_clans, 1);
  assert.equal(ROLES.member.comprehensive_clans, 0);
  assert.equal(ROLES.leader.comprehensive_clans, 1);
  assert.equal(ROLES.leader.comprehensive_clans, 1);
});
