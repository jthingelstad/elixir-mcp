import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FULL_OAUTH_SCOPE,
  OAUTH_SCOPE,
  OAUTH_SCOPE_DETAILS,
  OAUTH_SCOPES,
  STANDARD_OAUTH_SCOPES,
  DEFAULT_OAUTH_SCOPE,
  requiredOAuthScope,
  TOOL_GROUPS,
} from "../dist/index.js";

test("OAuth scope catalog is closed and read is the safe default", () => {
  assert.equal(DEFAULT_OAUTH_SCOPE, "cr:read");
  assert.deepEqual(OAUTH_SCOPES, [
    "cr:read",
    "recordings:write",
    "collections:write",
    "account:write",
    "feedback:write",
    "account:email",
  ]);
  // The default grant and the consent page's ticked extras are the
  // STANDARD five; account:email is granted only to a client that names it.
  assert.deepEqual(STANDARD_OAUTH_SCOPES, OAUTH_SCOPES.slice(0, 5));
  assert.equal(FULL_OAUTH_SCOPE, STANDARD_OAUTH_SCOPES.join(" "));
  assert.equal(
    OAUTH_SCOPE_DETAILS.find((d) => d.scope === "account:email").standard,
    false,
  );
});

test("every tool has exactly the capability its behavior requires", () => {
  const expectedWrites = {
    collections_edit: OAUTH_SCOPE.COLLECTIONS_WRITE,
    elixir_track_clan: OAUTH_SCOPE.RECORDINGS_WRITE,
    elixir_track_player: OAUTH_SCOPE.RECORDINGS_WRITE,
    // The feed advances the caller's own bookmark and nothing else; the
    // scheduled read-only routine is what it exists for (feedback #16).
    elixir_events: OAUTH_SCOPE.READ,
    elixir_feedback: OAUTH_SCOPE.FEEDBACK_WRITE,
    // Remembering which human is which is account state, like a nickname: it
    // writes nothing about the game and grants nothing, since recorded reads
    // are universal either way.
    elixir_identify: OAUTH_SCOPE.ACCOUNT_WRITE,
    elixir_nickname: OAUTH_SCOPE.ACCOUNT_WRITE,
  };

  for (const [name, cls] of Object.entries(TOOL_GROUPS)) {
    const expected = cls.readOnly ? OAUTH_SCOPE.READ : expectedWrites[name];
    assert.ok(expected, `${name} has an explicit write capability`);
    assert.equal(requiredOAuthScope(name), expected, name);
  }
});
