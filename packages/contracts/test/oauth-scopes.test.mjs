import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OAUTH_SCOPE,
  OAUTH_SCOPES,
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
  ]);
});

test("every tool has exactly the capability its behavior requires", () => {
  const expectedWrites = {
    collections_edit: OAUTH_SCOPE.COLLECTIONS_WRITE,
    elixir_add_clan: OAUTH_SCOPE.RECORDINGS_WRITE,
    elixir_add_player: OAUTH_SCOPE.RECORDINGS_WRITE,
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
