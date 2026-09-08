/**
 * The magic link in every sign-in email did nothing for as long as it existed.
 *
 * The token was scrubbed from the URL before React rendered — correct on its
 * own terms, since a live credential must not reach history, a bookmark or a
 * Referer — and the sign-in view then read the URL and found nothing. Only the
 * six-digit code ever worked, and nothing failed loudly enough to notice.
 */

import { describe, test, expect, beforeEach, vi } from "vitest";

async function freshModule(href) {
  vi.resetModules();
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: { href },
    history: { state: null, replaceState },
    document: { title: "" },
  });
  vi.stubGlobal("document", { title: "" });
  const mod = await import("../src/url-hygiene.js");
  return { mod, replaceState };
}

describe("takeLoginToken", () => {
  beforeEach(() => vi.unstubAllGlobals());

  test("returns the token AND removes it from the address bar", async () => {
    const { mod, replaceState } = await freshModule(
      "https://elixir.poapkings.com/signin?login_token=abc123",
    );
    expect(mod.takeLoginToken()).toBe("abc123");
    expect(replaceState).toHaveBeenCalled();
    // Whatever we rewrote to must not still carry the credential.
    expect(String(replaceState.mock.calls[0][2])).not.toContain("abc123");
  });

  test("is memoised, because two callers read it at different times", async () => {
    // main.jsx lifts it before render; the sign-in view asks for it after.
    // If the second read went back to the URL it would find nothing, which is
    // exactly the bug this replaces.
    const { mod } = await freshModule(
      "https://elixir.poapkings.com/signin?login_token=xyz789",
    );
    expect(mod.takeLoginToken()).toBe("xyz789");
    expect(mod.takeLoginToken()).toBe("xyz789");
  });

  test("no token is null, and the URL is left alone", async () => {
    const { mod, replaceState } = await freshModule(
      "https://elixir.poapkings.com/signin",
    );
    expect(mod.takeLoginToken()).toBe(null);
    expect(replaceState).not.toHaveBeenCalled();
  });

  test("other query parameters survive the scrub", async () => {
    const { mod, replaceState } = await freshModule(
      "https://elixir.poapkings.com/signin?login_token=t&next=/explore",
    );
    expect(mod.takeLoginToken()).toBe("t");
    expect(String(replaceState.mock.calls[0][2])).toContain("next=%2Fexplore");
  });
});
