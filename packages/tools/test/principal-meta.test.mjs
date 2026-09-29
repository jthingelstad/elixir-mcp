/**
 * Principal identity as data, not prose.
 *
 * `instructions` says "YOU ACT FOR POAP KINGS #J2RGCRVG" -- right for the
 * model reading it, wrong for the client hosting the model. The
 * elixir-mcp-discord author reported having to either regex that prose or
 * infer the kind from which tools were absent in order to refuse to boot on
 * the wrong token, or to label a channel with the clan it serves. Both break
 * when the wording changes, and the wording is tuned for the model.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { principalBlock, PRINCIPAL_META_KEY } from "../src/identity.mjs";

test("the key is namespaced, because unprefixed _meta keys are reserved", () => {
  // MCP reserves bare keys for itself. If it ever standardises a principal
  // field we adopt it without having collided with it first.
  assert.match(PRINCIPAL_META_KEY, /^[a-z0-9.-]+\.[a-z]+\//);
});

test("an agent reports the clan it acts for", () => {
  const block = principalBlock("agent", {
    kind: "agent",
    clans: [{ clan_tag: "#J2RGCRVG", name: "POAP KINGS", members: 47 }],
  });
  assert.deepEqual(block, {
    kind: "agent",
    subject: {
      type: "clan",
      tag: "#J2RGCRVG",
      name: "POAP KINGS",
      members: 47,
    },
  });
});

test("an agent with no clan says so, rather than going quiet", () => {
  // A misconfiguration a client should be able to catch at boot. Omitting the
  // key would make it indistinguishable from a client that never asked.
  const block = principalBlock("agent", { kind: "agent", clans: [] });
  assert.equal(block.kind, "agent");
  assert.equal(block.subject, null);
  assert.ok("subject" in block);
});

test("a person reports their primary player, and their clan separately", () => {
  // A person's subject is a player; the clan is context, not the subject --
  // which is exactly the distinction an agent inverts.
  const block = principalBlock("person", {
    kind: "person",
    grouped: { primary: [{ player_tag: "#20JJJ2CCRU", name: "Jamie" }] },
    clans: [{ clan_tag: "#J2RGCRVG", name: "POAP KINGS" }],
  });
  assert.deepEqual(block, {
    kind: "person",
    subject: { type: "player", tag: "#20JJJ2CCRU", name: "Jamie" },
    clan: { tag: "#J2RGCRVG", name: "POAP KINGS" },
  });
});

test("a brand-new person has no subject yet, and that is reportable", () => {
  const block = principalBlock("person", {
    kind: "person",
    grouped: {},
    clans: [],
  });
  assert.deepEqual(block, { kind: "person", subject: null });
});

test("an integration has no subject of its own", () => {
  assert.deepEqual(principalBlock("integration", { kind: "integration" }), {
    kind: "integration",
    subject: null,
  });
});

test("an absent kind reads as a person, matching every other door", () => {
  // Strictly-expand rule: an unknown or absent kind is a person everywhere
  // else in this system, and this must not be the one place it is not.
  assert.equal(principalBlock(null, null).kind, "person");
});

test("the block never carries anything a client could mistake for a grant", () => {
  // It reports the connection you already hold; every tool re-derives rights
  // server-side. A client that lies to itself here changes only its labels.
  const block = principalBlock("agent", {
    kind: "agent",
    clans: [{ clan_tag: "#J2RGCRVG", name: "POAP KINGS", members: 47 }],
  });
  const keys = JSON.stringify(block);
  for (const forbidden of ["scope", "token", "quota", "role", "account_id"])
    assert.ok(!keys.includes(forbidden), `block leaks ${forbidden}`);
});
