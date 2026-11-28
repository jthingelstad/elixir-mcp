/**
 * The doors' half of Turnstile (src/turnstile.mjs): what a page says about
 * its token is logged, never trusted, and never decides anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TURNSTILE_ACTIONS,
  turnstileAtDoor,
  turnstileWhyFrom,
} from "../src/turnstile.mjs";

const observe = { TURNSTILE_MODE: "observe" };

test("a page's reason and wait ride the door's log, checked to a small charset", () => {
  assert.deepEqual(
    turnstileWhyFrom(
      { turnstile_reason: "error:600010", turnstile_wait_ms: 5003 },
      false,
    ),
    { turnstile_reason: "error:600010", turnstile_wait_ms: 5003 },
  );
  // The OAuth form posts strings.
  assert.deepEqual(
    turnstileWhyFrom(
      { turnstile_reason: "no-script", turnstile_wait_ms: "" },
      false,
    ),
    { turnstile_reason: "no-script" },
  );
  assert.deepEqual(turnstileWhyFrom({ turnstile_wait_ms: "120004" }, false), {
    turnstile_wait_ms: 120004,
  });
  // Junk is named as junk, never repeated.
  for (const junk of [
    "someone@example.com",
    "<script>",
    "x".repeat(41),
    "Error:600010",
  ])
    assert.deepEqual(turnstileWhyFrom({ turnstile_reason: junk }, false), {
      turnstile_reason: "invalid",
    });
  for (const wait of [-1, 1.5, 600_001, "12ms", "9999999", null, {}])
    assert.deepEqual(turnstileWhyFrom({ turnstile_wait_ms: wait }, false), {});
  assert.deepEqual(turnstileWhyFrom({ turnstile_reason: 7 }, false), {});
  // Beside a token a reason means nothing and is dropped.
  assert.deepEqual(
    turnstileWhyFrom(
      { turnstile_reason: "no-widget", turnstile_wait_ms: 40 },
      true,
    ),
    { turnstile_wait_ms: 40 },
  );
});

test("the door's log fields; the carried message and the refusal are unchanged by them", () => {
  const quiet = turnstileAtDoor(
    { turnstile_reason: "script-blocked", turnstile_wait_ms: 12 },
    "web",
    observe,
  );
  assert.deepEqual(quiet.log, {
    turnstile: "missing",
    turnstile_reason: "script-blocked",
    turnstile_wait_ms: 12,
  });
  assert.deepEqual(quiet.carry, { surface: "web", token: "" });
  assert.equal(quiet.refuse, false);
  const enforced = turnstileAtDoor({ turnstile_reason: "no-widget" }, "oauth", {
    TURNSTILE_MODE: "enforce",
  });
  assert.equal(enforced.refuse, true);
  const person = turnstileAtDoor(
    { "cf-turnstile-response": "tok", turnstile_wait_ms: "800" },
    "oauth",
    observe,
  );
  assert.deepEqual(person.log, { turnstile: "token", turnstile_wait_ms: 800 });
  assert.deepEqual(person.carry, { surface: "oauth", token: "tok" });
  assert.deepEqual(turnstileAtDoor({}, "web", { TURNSTILE_MODE: "off" }).log, {
    turnstile: "off",
  });
});

test("each door's widget action", () => {
  assert.deepEqual(TURNSTILE_ACTIONS, { web: "signin", oauth: "oauth-signin" });
});
