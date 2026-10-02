import { test, expect, beforeEach } from "vitest";
import { rememberAfterSignIn, takeAfterSignIn } from "../src/App.jsx";

/**
 * A signed-out deep link (the mail footer's link to an email's record,
 * or to feedback about it) lands where it pointed once the person has
 * signed in, not on Overview. Console paths only; read once.
 */
beforeEach(() => window.localStorage.clear());

test("a console path is kept across sign-in and consumed once", () => {
  rememberAfterSignIn(
    "/console/account/activity/e/5c1c5dbf-0000-4000-8000-000000000001?report=1",
  );
  expect(takeAfterSignIn()).toBe(
    "/console/account/activity/e/5c1c5dbf-0000-4000-8000-000000000001?report=1",
  );
  expect(takeAfterSignIn()).toBeNull();
});

test("only console paths are remembered; anything else lands on Overview", () => {
  rememberAfterSignIn("/console/signin?login_token=abc");
  expect(takeAfterSignIn()).toBeNull();
  rememberAfterSignIn("https://evil.example/account/x");
  expect(takeAfterSignIn()).toBeNull();
  rememberAfterSignIn("/console/explore/player/2ABC");
  expect(takeAfterSignIn()).toBeNull();
  rememberAfterSignIn(
    "/console/admin/emails/5c1c5dbf-0000-4000-8000-000000000001",
  );
  expect(takeAfterSignIn()).toBe(
    "/console/admin/emails/5c1c5dbf-0000-4000-8000-000000000001",
  );
});

test("a Ladder path is kept across sign-in too; a look-alike is not", () => {
  rememberAfterSignIn("/ladder?player=VJQV8G8RL&mode=ranked");
  expect(takeAfterSignIn()).toBe("/ladder?player=VJQV8G8RL&mode=ranked");
  rememberAfterSignIn("/ladders/x");
  expect(takeAfterSignIn()).toBeNull();
  rememberAfterSignIn("https://evil.example/ladder");
  expect(takeAfterSignIn()).toBeNull();
});
