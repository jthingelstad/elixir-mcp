import { afterEach, expect, test } from "vitest";
import {
  SESSION_HINT_KEY,
  forgetSession,
  rememberSession,
  sessionHint,
} from "../src/lib/session-hint.js";

afterEach(() => window.localStorage.clear());

const read = () => JSON.parse(window.localStorage.getItem(SESSION_HINT_KEY));

test("a session leaves the static half a hint with the player's name", () => {
  rememberSession({
    authenticated: true,
    email: "fictional@example.test",
    claims: [{ is_primary: true, name: "Fictional" }],
  });
  expect(read().name).toBe("Fictional");
  expect(read().until).toBeGreaterThan(Date.now());
});

test("the address is never written to browser storage", () => {
  rememberSession({ authenticated: true, email: "fictional@example.test" });
  expect(read().name).toBeNull();
  expect(window.localStorage.getItem(SESSION_HINT_KEY)).not.toContain(
    "fictional@example.test",
  );
});

test("signed out clears the hint; an unknown session changes nothing", () => {
  rememberSession({ authenticated: true });
  rememberSession(null);
  expect(read()).not.toBeNull();
  rememberSession({ authenticated: false });
  expect(read()).toBeNull();
  rememberSession({ authenticated: true });
  forgetSession();
  expect(read()).toBeNull();
});

test("a hint lasts the session's sliding window", () => {
  const now = Date.UTC(2026, 10, 5);
  expect(sessionHint({ claims: [] }, now).until).toBe(now + 30 * 86_400_000);
});
