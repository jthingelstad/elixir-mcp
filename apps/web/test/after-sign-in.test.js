import { test, expect, beforeEach } from "vitest";
import { rememberAfterSignIn, takeAfterSignIn } from "../src/App.jsx";

/**
 * A signed-out deep link (the mail footer's link to an email's record,
 * or to feedback about it) lands where it pointed once the person has
 * signed in, not on Overview. Console paths only; read once.
 */
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

test("a console path is kept across sign-in and consumed once", () => {
  rememberAfterSignIn(
    "/console/account/activity/e/5c1c5dbf-0000-4000-8000-000000000001?report=1",
  );
  expect(takeAfterSignIn()).toBe(
    "/console/account/activity/e/5c1c5dbf-0000-4000-8000-000000000001?report=1",
  );
  expect(takeAfterSignIn()).toBeNull();
});

test("sign-in and external destinations are not remembered", () => {
  rememberAfterSignIn("/console/signin?login_token=abc");
  expect(takeAfterSignIn()).toBeNull();
  rememberAfterSignIn("https://evil.example/account/x");
  expect(takeAfterSignIn()).toBeNull();
  rememberAfterSignIn(
    "/console/admin/emails/5c1c5dbf-0000-4000-8000-000000000001",
  );
  expect(takeAfterSignIn()).toBe(
    "/console/admin/emails/5c1c5dbf-0000-4000-8000-000000000001",
  );
});

test("Explore and public battle context survive sign-in", () => {
  for (const path of [
    "/console/explore/player/2ABC?from=mail",
    "/battle/ccd04012bda8",
  ]) {
    rememberAfterSignIn(path);
    expect(takeAfterSignIn()).toBe(path);
    expect(takeAfterSignIn()).toBeNull();
  }
});

test("a link tab can consume the shared copy without consuming the requesting tab's copy", () => {
  const path = "/console/explore/player/2ABC";
  rememberAfterSignIn(path);
  window.localStorage.removeItem("elixir.after_sign_in");
  expect(takeAfterSignIn()).toBe(path);
  expect(takeAfterSignIn()).toBeNull();
});

test("a tab's own return leaves another tab's newer shared destination intact", () => {
  rememberAfterSignIn("/console/explore/player/2ABC");
  window.localStorage.setItem("elixir.after_sign_in", "/clan/2PQRJ8LV/actions");
  expect(takeAfterSignIn()).toBe("/console/explore/player/2ABC");
  expect(window.localStorage.getItem("elixir.after_sign_in")).toBe(
    "/clan/2PQRJ8LV/actions",
  );
});

test("return paths refuse normalized traversal, credentials, external and look-alike spellings", () => {
  for (const path of [
    "//evil.example/console/account/x",
    "/\\evil.example/console/account/x",
    "/console/explore/../signin",
    "/console/explore/%2e%2e/signin",
    "/ladder/../signin",
    "/console/explore/player/2ABC#login_token=secret",
    "/battles/ccd04012bda8",
    "/battle/garbage",
  ]) {
    rememberAfterSignIn(path);
    expect(takeAfterSignIn(), path).toBeNull();
  }
});

test("a Ladder path is kept across sign-in too; a look-alike is not", () => {
  rememberAfterSignIn("/ladder?player=VJQV8G8RL&mode=ranked");
  expect(takeAfterSignIn()).toBe("/ladder?player=VJQV8G8RL&mode=ranked");
  rememberAfterSignIn("/ladders/x");
  expect(takeAfterSignIn()).toBeNull();
  rememberAfterSignIn("https://evil.example/ladder");
  expect(takeAfterSignIn()).toBeNull();
});

test("Clan action links survive the common sign-in; external and look-alike paths refuse", () => {
  rememberAfterSignIn("/clan/2PQRJ8LV/actions/37");
  expect(takeAfterSignIn()).toBe("/clan/2PQRJ8LV/actions/37");
  for (const path of [
    "//evil.example/clan",
    "https://evil.example/clan",
    "/clans/2PQRJ8LV",
    "/clan/../admin",
  ]) {
    rememberAfterSignIn(path);
    expect(takeAfterSignIn()).toBeNull();
  }
});
