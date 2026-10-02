import { expect, test } from "vitest";
import { clanAccount } from "../src/App.jsx";

// The bar's account slot is filled from Clan's own session, never
// Elixir's: empty while Clan asks, "Sign in" signed out, and signed in,
// the player you act as and Clan's own sign-out (a form post).
test("the account slot: unknown, signed out, signed in", () => {
  expect(clanAccount(null)).toBeUndefined();
  expect(clanAccount({ signed_in: true, unavailable: true })).toBeUndefined();
  expect(clanAccount({ signed_in: false })).toBeNull();

  const acct = clanAccount({
    signed_in: true,
    selected: {
      player_name: "Ada",
      role: "leader",
      role_label: "Leader",
      name: "Example Clan",
    },
  });
  expect(acct.name).toBe("Ada");
  expect(acct.detail).toBe("Leader · Example Clan");
  expect(acct.links.map((l) => l.href)).toEqual([
    "/clan/you",
    "/clan/feedback",
  ]);
  expect(acct.signOut.action).toBe("/api/clan/auth/logout");
  expect(acct.signOut.onClick).toBeUndefined();

  // Signed in with no clan chosen yet: the primary player, with Elixir.
  const none = clanAccount({ signed_in: true, primary: { name: "Ada" } });
  expect(none.name).toBe("Ada");
  expect(none.detail).toBe("with Elixir");
});
