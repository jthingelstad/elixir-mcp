import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ROLES,
  ROLE_ORDER,
  roleQuotas,
  isRole,
  OPERATOR_BONUS,
} from "../dist/index.js";

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

test("operator bonus stacks on member/leader/family, never partner/admin", () => {
  const m = roleQuotas("member", { operator: true });
  assert.equal(
    m.player_slots,
    ROLES.member.player_slots + OPERATOR_BONUS.player_slots,
  );
  assert.equal(
    m.activity_clans,
    ROLES.member.activity_clans + OPERATOR_BONUS.activity_clans,
  );
  assert.deepEqual(roleQuotas("partner", { operator: true }), ROLES.partner);
  assert.deepEqual(roleQuotas("admin", { operator: true }), ROLES.admin);
});

test("admin is unlimited on every axis", () => {
  for (const v of Object.values(ROLES.admin)) assert.equal(v, Infinity);
});

test("member tier matches the ratified sketch: 3 players, 1 activity clan, no comprehensive", () => {
  assert.equal(ROLES.member.player_slots, 3);
  assert.equal(ROLES.member.activity_clans, 1);
  assert.equal(ROLES.member.comprehensive_clans, 0);
  assert.equal(ROLES.leader.player_slots, 5);
  assert.equal(ROLES.leader.comprehensive_clans, 1);
});
