import { test } from "node:test";
import assert from "node:assert/strict";
import {
  departuresFrom,
  openRemovalAtLeave,
  LEFT_CLAN_REASON,
  removalLinkLine,
} from "../src/departures.mjs";
import { reconcileCards } from "../src/evaluate.mjs";
import { actionReason } from "../src/mail.mjs";

const LEFT_AT = "2026-11-08T20:00:00.000Z";
const left = (tag, at = LEFT_AT) => ({
  type: "member_left",
  at,
  detail: { player_tag: tag, name: tag, role_at_departure: "member" },
});
const removal = (over = {}) => ({
  card_id: "rm-1",
  number: 92,
  player_tag: "#A",
  type: "removal",
  status: "proposed",
  raised_at: "2026-11-07T11:00:00.000Z",
  ...over,
});

test("a leave while the removal was still open asks, linked to it, with Kicked suggested", () => {
  const [d] = departuresFrom([left("#A")], [removal()]);
  assert.deepEqual(d.removal, { card_id: "rm-1", number: 92 });
  assert.equal(d.suggested, "kick", "Kicked is offered first");
});

test("a removal the leave withdrew still links the departure", () => {
  const withdrawn = removal({
    status: "withdrawn",
    withdrawn_at: "2026-11-09T11:30:00.000Z",
    withdraw_reason: LEFT_CLAN_REASON,
    withdraw_detail: { left_clan: true },
  });
  const [d] = departuresFrom([left("#A")], [withdrawn]);
  assert.equal(d.removal.number, 92);
  assert.equal(d.suggested, "kick");
  // One withdrawn before the marker existed is read by its reason.
  const older = { ...withdrawn, withdraw_detail: null };
  assert.equal(openRemovalAtLeave([older], "#A", LEFT_AT)?.card_id, "rm-1");
});

test("a removal withdrawn for another reason, or raised after the leave, links nothing", () => {
  const played = removal({
    status: "withdrawn",
    withdrawn_at: "2026-11-07T20:00:00.000Z",
    withdraw_reason: "The member played; the inactivity clock reset.",
  });
  const later = removal({ raised_at: "2026-11-09T11:00:00.000Z" });
  const other = removal({ player_tag: "#B" });
  const [d] = departuresFrom([left("#A")], [played, later, other]);
  assert.equal(d.removal, null);
  assert.equal(d.suggested, null);
});

test("a removal marked Done explains the leave: no question, unchanged", () => {
  const done = removal({
    status: "done",
    decided_at: "2026-11-08T19:00:00.000Z",
  });
  assert.deepEqual(departuresFrom([left("#A")], [done]), []);
});

test("a departure with no removal is unchanged: asked, nothing suggested", () => {
  const [d] = departuresFrom([left("#A")], []);
  assert.equal(d.player_tag, "#A");
  assert.equal(d.removal, null);
  assert.equal(d.suggested, null);
});

test("reconcile marks a withdrawal made because the member left", () => {
  const { withdraw } = reconcileCards({ members: [] }, [removal()]);
  assert.deepEqual(
    withdraw.map((w) => [w.reason, w.detail]),
    [[LEFT_CLAN_REASON, { left_clan: true }]],
  );
});

test("the morning email names the removal Action", () => {
  assert.equal(
    removalLinkLine(92),
    "Elixir recommended removing them in Action #92.",
  );
  assert.equal(
    actionReason({
      type: "departure",
      evidence: { suggested_classification: "kick", removal_number: 92 },
    }),
    "Elixir recommended removing them in Action #92. Confirm Kicked or Left.",
  );
  assert.equal(
    actionReason({ type: "departure", evidence: {} }),
    "A departure no action explained.",
  );
});
