/**
 * The topic registry is data, and these are the invariants that keep it data.
 *
 * elixir-bot's event_contracts.py earns its keep by declaring stream, payload
 * floor and routing together, so changing when the agent hears about something
 * is a one-line data change rather than a branch in a reader. The failure mode
 * it warns about is a registry that drifts from the code around it -- a topic
 * emitted but never declared, or declared with no way to reach anybody.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TOPIC_CONTRACTS, FEED_TOPICS } from "../src/feed.mjs";

const KINDS = ["person", "agent", "integration"];
const STREAMS = ["player", "clan", "account"];

test("every topic declares a complete contract", () => {
  for (const [topic, c] of Object.entries(TOPIC_CONTRACTS)) {
    assert.ok(STREAMS.includes(c.stream), `${topic}: bad stream ${c.stream}`);
    assert.equal(typeof c.coalesce, "boolean", `${topic}: coalesce`);
    assert.ok(Array.isArray(c.payload), `${topic}: payload floor`);
    assert.ok(
      c.audience && typeof c.audience === "object",
      `${topic}: audience`,
    );
    for (const kind of Object.keys(c.audience))
      assert.ok(KINDS.includes(kind), `${topic}: unknown kind ${kind}`);
  }
});

test("FEED_TOPICS is the registry, not a second list", () => {
  // The tool validates `topics` against FEED_TOPICS. If that list is ever
  // maintained by hand again, a declared topic becomes unrequestable.
  assert.deepEqual(FEED_TOPICS, Object.keys(TOPIC_CONTRACTS));
});

test("no topic is declared that can never reach anybody", () => {
  for (const [topic, c] of Object.entries(TOPIC_CONTRACTS)) {
    const reachable = Object.values(c.audience).some((v) => v === true);
    assert.ok(reachable, `${topic} has no audience at all`);
  }
});

test("integrations receive nothing: they have no 'me'", () => {
  // An integration is scoped API access -- Elixir Drop reading war clocks for
  // players it has no relationship with. A feed implies a subject you care
  // about, and it has none. This is the one audience rule with teeth today,
  // because it is what the `a.kind = any($2)` filter enforces at fan-out.
  for (const [topic, c] of Object.entries(TOPIC_CONTRACTS))
    assert.notEqual(
      c.audience.integration,
      true,
      `${topic} reaches integrations`,
    );
});

test("a coalescing topic's payload floor is the count, and only the count", () => {
  // Coalescing folds unread rows and rebuilds the payload as {count}. A floor
  // promising anything else would be a promise the fold silently breaks.
  for (const [topic, c] of Object.entries(TOPIC_CONTRACTS)) {
    if (!c.coalesce) continue;
    assert.deepEqual(
      c.payload,
      ["count"],
      `${topic}: coalescing payload floor`,
    );
  }
});

test("high-volume streams coalesce; roster changes stay discrete", () => {
  // WHO joined is the entire signal, so folding roster events to "3 changes"
  // forces exactly the lookup the notification exists to save (Jamie).
  for (const t of [
    "battles_recorded",
    "badge_earned",
    "legendary_badge_earned",
  ])
    assert.equal(TOPIC_CONTRACTS[t].coalesce, true, `${t} must coalesce`);
  for (const t of ["member_joined", "member_left", "member_role_changed"])
    assert.equal(TOPIC_CONTRACTS[t].coalesce, false, `${t} must stay discrete`);
});

test("badge tiers are split at the emitter, never behind a field", () => {
  // A reader that hardcodes one name must not be able to silently drop the
  // other half -- elixir-bot lost its entire Legendary back catalogue to
  // exactly this. Two topics, so the name itself carries the tier.
  assert.ok(TOPIC_CONTRACTS.badge_earned);
  assert.ok(TOPIC_CONTRACTS.legendary_badge_earned);
});

test("the departing role rides member_left; it is unrecoverable afterwards", () => {
  // Everything else about a departure can be pulled from clans_roster later.
  // The role at the moment of leaving cannot -- the membership row closes.
  assert.ok(TOPIC_CONTRACTS.member_left.payload.includes("role"));
  // And no verified variant: we cannot tell a leave from a kick, so naming
  // one would be a guess wearing a confident name (Jamie).
  assert.equal(TOPIC_CONTRACTS.member_left_verified, undefined);
});

test("the deprecated tier topic points at its replacement", () => {
  assert.equal(TOPIC_CONTRACTS.role_changed.deprecated, "account_tier_changed");
  assert.ok(TOPIC_CONTRACTS.account_tier_changed);
  // Both are account-stream: addressed directly, never fanned out.
  assert.equal(TOPIC_CONTRACTS.account_tier_changed.stream, "account");
});
