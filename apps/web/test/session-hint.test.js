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

test("the static identity carries explicit recent proof, never an art/role inference", () => {
  const now = Date.UTC(2026, 10, 14);
  const me = {
    claims: [
      {
        is_primary: true,
        player_tag: "#00C298UC",
        name: "Ada",
        status: "unverified",
      },
    ],
    avatar_card_id: 26000000,
    role: "leader",
  };
  const plain = sessionHint(me, now);
  expect(plain.verified).toBe(false);
  expect(plain.identity_until).toBe(now + 5 * 60_000);
  const proof = sessionHint(
    { ...me, player_verifications: { "#00C298UC": true } },
    now,
  );
  expect(proof.verified).toBe(true);
  expect(
    sessionHint({ claims: [{ is_primary: true, name: "Ada" }] }, now).verified,
  ).toBeUndefined();
});
