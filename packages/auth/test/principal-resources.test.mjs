/**
 * Which URLs name a protected resource (0054).
 *
 * This is a security boundary in two halves that must agree: a CHECK
 * constraint decides what audience may be STORED, and resourceForPath decides
 * what audience a request is FOR. Every audience the code names must be one
 * the constraint allows, so both get the same adversarial matrix, and it
 * lives next to the code rather than in a migration nobody re-reads. The
 * constraint still allows the retired agent door's shape, for the rows that
 * hold it until they are deleted; the code names no such audience.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { resourceForPath, isFirstPartyClient } from "../src/oauth.mjs";

const ISSUER = "https://elixir.poapkings.com";
// Kept identical to the CHECK in db/migrations/0257_pivot_leftovers_contract.sql
// (0160's, less the integration door /i/<id>/mcp that 0257 closed).
const SQL_PATTERN =
  /^https:\/\/elixir\.poapkings\.com\/(mcp|api\/v1|a\/[a-z0-9]{8,16}\/mcp)$/;

const CASES = [
  ["/mcp", "person"],
  ["/api/v1", "api"],
  // Everything below must produce nothing at all.
  ["/a/abcd1234/mcp", null], // the retired agent door
  ["/i/abcd12345678/mcp", null],
  ["/api/v1/", null],
  ["/api/v1/me", null],
  ["/api/v2", null],
  ["/api", null],
  ["/a//mcp", null],
  ["/x/abcd1234/mcp", null],
  ["/mcp/", null],
  ["/MCP", null],
  ["/mcp?x=1", null],
  ["/mcp#f", null],
  ["//evil.com/mcp", null],
  ["/../mcp", null],
  ["", null],
];

test("only two shapes name a resource, and the code agrees with the constraint", () => {
  for (const [path, kind] of CASES) {
    const got = resourceForPath(path, ISSUER);
    if (kind === null) {
      assert.equal(got, null, `${path} must not name a resource`);
      continue;
    }
    assert.ok(got, `${path} should name a resource`);
    assert.equal(got.kind, kind, path);
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

test("/mcp and /api/v1 are different audiences", () => {
  const mcp = resourceForPath("/mcp", ISSUER);
  const api = resourceForPath("/api/v1", ISSUER);
  assert.equal(mcp.kind, "person");
  assert.equal(api.kind, "api");
  assert.notEqual(api.resource, mcp.resource);
});

test("a first-party client is provisioned by Elixir, and its codes can only reach the family's servers", () => {
  const fp = (redirectUris, provisioned = true) =>
    isFirstPartyClient({ redirectUris, provisioned });
  assert.ok(fp(["https://elixir.poapkings.com/api/clan/auth/callback"]));
  assert.ok(
    fp([
      "https://elixir.poapkings.com/api/clan/auth/callback",
      "https://drop.poapkings.com/auth/callback",
    ]),
  );
  // Family redirects prove nothing about who holds the client: registration
  // is open. Only a provisioned client is the family's.
  assert.ok(
    !fp(["https://elixir.poapkings.com/api/clan/auth/callback"], false),
  );
  // One foreign redirect makes the whole client third-party.
  assert.ok(
    !fp([
      "https://elixir.poapkings.com/api/clan/auth/callback",
      "https://evil.example/cb",
    ]),
  );
  assert.ok(!fp(["http://elixir.poapkings.com/api/clan/auth/callback"]));
  assert.ok(!fp(["https://elixir.poapkings.com.evil.example/cb"]));
  // Retired with Clan's move to /clan (2026-09-28): no longer the family's.
  assert.ok(!fp(["https://clan.poapkings.com/auth/callback"]));
  assert.ok(!fp([]));
  assert.ok(!fp(null));
  assert.ok(!isFirstPartyClient({}));
});
