/**
 * Signing in to Clan without a click (lib/auto-signin.js): when the
 * landing may start a sign-in by itself, how it reads Elixir's session,
 * and the address a signed-out person opened.
 */
import { describe, expect, test } from "vitest";
import {
  elixirSignedIn,
  mayStart,
  rememberNext,
  takeNext,
} from "../src/lib/auto-signin.js";

/** A sessionStorage stand-in. */
function store(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    m,
  };
}

const NOW = Date.parse("2026-10-02T13:00:00Z");

describe("when the landing may start a sign-in", () => {
  test("a plain landing, or one after an expired session, may", () => {
    expect(mayStart({ search: "", now: NOW, store: store() })).toBe(true);
    expect(
      mayStart({
        search: "?error=session_expired",
        now: NOW,
        store: store(),
      }),
    ).toBe(true);
  });

  test("never after a sign-out or a sign-in that failed", () => {
    expect(
      mayStart({ search: "?signed_out=1", now: NOW, store: store() }),
    ).toBe(false);
    for (const error of ["exchange_failed", "state_mismatch", "x"])
      expect(
        mayStart({ search: `?error=${error}`, now: NOW, store: store() }),
      ).toBe(false);
  });

  test("never twice within a minute in one tab", () => {
    const s = store({ "elixir-clan.auto-signin": String(NOW - 30_000) });
    expect(mayStart({ search: "", now: NOW, store: s })).toBe(false);
    expect(mayStart({ search: "", now: NOW + 31_000, store: s })).toBe(true);
  });

  test("a browser that refuses storage still gets the landing's rules", () => {
    expect(mayStart({ search: "", now: NOW, store: null })).toBe(true);
    const throwing = {
      getItem() {
        throw new Error("denied");
      },
    };
    expect(mayStart({ search: "", now: NOW, store: throwing })).toBe(true);
  });
});

describe("reading Elixir's session", () => {
  const answer = (status, body) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  test("only an authenticated answer is a yes", async () => {
    expect(await elixirSignedIn(answer(200, { authenticated: true }))).toBe(
      true,
    );
    expect(await elixirSignedIn(answer(200, { authenticated: false }))).toBe(
      false,
    );
    expect(await elixirSignedIn(answer(500, { authenticated: true }))).toBe(
      false,
    );
    expect(
      await elixirSignedIn(async () => {
        throw new Error("offline");
      }),
    ).toBe(false);
  });

  test("it asks the same origin's /api/me", async () => {
    const calls = [];
    await elixirSignedIn(async (url, init) => {
      calls.push([url, init.credentials]);
      return { ok: true, json: async () => ({ authenticated: false }) };
    });
    expect(calls).toEqual([["/api/me", "same-origin"]]);
  });
});

describe("the address a signed-out person opened", () => {
  test("is where they land, once, while it is fresh", () => {
    const s = store();
    rememberNext(s, "/clan/2PQRJ8LV/actions", NOW);
    expect(takeNext(s, NOW + 60_000)).toBe("/clan/2PQRJ8LV/actions");
    expect(takeNext(s, NOW + 61_000)).toBe(null);

    rememberNext(s, "/clan/2PQRJ8LV/week", NOW);
    expect(takeNext(s, NOW + 11 * 60_000)).toBe(null);
  });

  test("only a Clan address is kept", () => {
    const s = store();
    for (const path of ["/console/account", "//evil.example/clan/x", "/clan"])
      rememberNext(s, path, NOW);
    expect(s.m.size).toBe(0);
    s.setItem(
      "elixir-clan.next",
      JSON.stringify({ path: "https://evil.example/", at: NOW }),
    );
    expect(takeNext(s, NOW)).toBe(null);
    s.setItem("elixir-clan.next", "{not json");
    expect(takeNext(s, NOW)).toBe(null);
  });
});
