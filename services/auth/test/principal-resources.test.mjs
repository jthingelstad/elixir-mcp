/**
 * Which URLs name a protected resource, and who may present a credential at
 * one (0054).
 *
 * This is a security boundary in two halves that must agree: a CHECK
 * constraint decides what audience may be STORED, and resourceForPath decides
 * what audience a request is FOR. If they disagree, either tokens exist that no
 * door accepts, or doors accept audiences the database would never have issued.
 * So both get the same adversarial matrix, and it lives next to the code rather
 * than in a migration nobody re-reads.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resourceForPath, principalMatchesResource } from "../src/oauth.mjs";

const ISSUER = "https://elixir.poapkings.com";
// Kept identical to the CHECK in db/migrations/0054_principal_resources.sql.
const SQL_PATTERN =
  /^https:\/\/elixir\.poapkings\.com\/(mcp|[ai]\/[a-z0-9]{8,16}\/mcp)$/;

const CASES = [
  ["/mcp", "person", null],
  ["/a/abcd1234/mcp", "agent", "abcd1234"],
  ["/i/abcd12345678/mcp", "integration", "abcd12345678"],
  // Everything below must produce nothing at all.
  ["/a/AB/mcp", null, null],
  ["/a//mcp", null, null],
  ["/a/abcd1234/mcp/extra", null, null],
  ["/a/abcdefghijklmnopq/mcp", null, null], // 17 chars, over the ceiling
  ["/x/abcd1234/mcp", null, null],
  ["/mcp/", null, null],
  ["/MCP", null, null],
  ["/a/abcd1234/mcp?x=1", null, null],
  ["/a/abcd1234/mcp#f", null, null],
  ["//evil.com/mcp", null, null],
  ["/../mcp", null, null],
  ["", null, null],
];

test("only three shapes name a resource, and the code agrees with the constraint", () => {
  for (const [path, kind, publicId] of CASES) {
    const got = resourceForPath(path, ISSUER);
    if (kind === null) {
      assert.equal(got, null, `${path} must not name a resource`);
      continue;
    }
    assert.ok(got, `${path} should name a resource`);
    assert.equal(got.kind, kind, path);
    assert.equal(got.publicId, publicId, path);
    // The half the database enforces.
    assert.match(
      got.resource,
      SQL_PATTERN,
      `${path} would be rejected on write`,
    );
  }
});

test("no path can steer the audience off this origin", () => {
  // The host in both patterns is a literal, not a wildcard. These are the
  // shapes that beat naive host checks.
  for (const path of [
    "https://evil.com/mcp",
    "//elixir.poapkings.com.evil.com/mcp",
    "/mcp/../../a/abcd1234/mcp",
  ]) {
    const got = resourceForPath(path, ISSUER);
    if (got) assert.match(got.resource, SQL_PATTERN, path);
  }
  // And the constraint itself rejects a lookalike host outright.
  assert.doesNotMatch("https://elixir.poapkings.com.evil.com/mcp", SQL_PATTERN);
});

test("a credential belongs at exactly one door", () => {
  const personUrl = resourceForPath("/mcp", ISSUER);
  const agentUrl = resourceForPath("/a/abcd1234/mcp", ISSUER);
  const otherAgentUrl = resourceForPath("/a/zzzz9999/mcp", ISSUER);
  const integrationUrl = resourceForPath("/i/abcd1234/mcp", ISSUER);

  const person = { kind: "person" };
  const legacy = {}; // every credential issued before the three-kind model
  const agent = { kind: "agent", publicId: "abcd1234" };
  const integration = { kind: "integration", publicId: "abcd1234" };

  assert.ok(principalMatchesResource(person, personUrl));
  assert.ok(
    principalMatchesResource(legacy, personUrl),
    "unknown kind is a person",
  );
  assert.ok(principalMatchesResource(agent, agentUrl));
  assert.ok(principalMatchesResource(integration, integrationUrl));

  // The failures this whole scheme exists to convert into refusals.
  assert.ok(
    !principalMatchesResource(person, agentUrl),
    "person at an agent door",
  );
  assert.ok(
    !principalMatchesResource(agent, personUrl),
    "agent at the personal door",
  );
  assert.ok(
    !principalMatchesResource(agent, otherAgentUrl),
    "one agent's key at another agent's door",
  );
  assert.ok(
    !principalMatchesResource(agent, integrationUrl),
    "same id, different kind, still no",
  );
  assert.ok(!principalMatchesResource(null, personUrl));
  assert.ok(!principalMatchesResource(agent, null));
});

test("an agent with no public id cannot match anything", () => {
  // Belt and braces: a half-created agent must not fall through to a match.
  const agentUrl = resourceForPath("/a/abcd1234/mcp", ISSUER);
  assert.ok(
    !principalMatchesResource({ kind: "agent", publicId: null }, agentUrl),
  );
  assert.ok(!principalMatchesResource({ kind: "agent" }, agentUrl));
});
