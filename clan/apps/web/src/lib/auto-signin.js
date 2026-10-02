/**
 * Signing in to Clan without a click (Jamie, 2026-10-02: "It isn't
 * automatically signing me into clan"). Clan keeps its own session, so a
 * person signed in to the Console met Clan's landing and its button. On
 * one origin the landing can see Elixir's own session (`/api/me`), and a
 * person who has one starts Clan's sign-in at once: Elixir, holding the
 * grant they gave Clan, sends them straight back (consentRemembered in
 * services/mcp/src/oauth-routes.mjs). Without a grant (the first time,
 * or after Clan's sign-out revoked it) Elixir asks, as it always did.
 *
 * It does not start after a sign-out (`?signed_out=1`, which the API's
 * logout adds), after a sign-in that came back with an error other than
 * an expired session, or twice in a minute in one tab, so a sign-in that
 * cannot complete is never a loop. A Clan address a signed-out person
 * opened is kept for ten minutes and is where they land once signed in.
 */
import { useEffect, useState } from "react";
import { trackEvent } from "../analytics.js";

const SIGN_IN = "/api/clan/auth/login";
const TRIED = "elixir-clan.auto-signin";
const NEXT = "elixir-clan.next";
const RETRY_MS = 60_000;
const NEXT_MS = 10 * 60_000;
const CLAN_PATH = /^\/clan\/[A-Za-z0-9/_-]+$/;

/** The tab's sessionStorage, or null where the browser refuses it. */
export function tabStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
const read = (store, key) => {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (store, key, value) => {
  try {
    store?.setItem(key, value);
  } catch {
    // A refused store only costs the guard or the way back.
  }
};
const drop = (store, key) => {
  try {
    store?.removeItem(key);
  } catch {
    // As above.
  }
};

/** Whether this landing may start a sign-in by itself. */
export function mayStart({ search, now, store }) {
  const q = new URLSearchParams(search);
  if (q.has("signed_out")) return false;
  const error = q.get("error");
  if (error && error !== "session_expired") return false;
  const last = Number(read(store, TRIED) ?? 0);
  return !(last > 0 && now - last < RETRY_MS);
}

/** Signed in to Elixir on this origin? Anything but a clear yes is no. */
export async function elixirSignedIn(fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl("/api/me", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!r.ok) return false;
    const body = await r.json();
    return body?.authenticated === true;
  } catch {
    return false;
  }
}

/** Keep the Clan address a signed-out person opened. */
export function rememberNext(store, path, now) {
  if (CLAN_PATH.test(path))
    write(store, NEXT, JSON.stringify({ path, at: now }));
}

/** The kept address, once, while it is fresh. */
export function takeNext(store, now) {
  const raw = read(store, NEXT);
  if (!raw) return null;
  drop(store, NEXT);
  try {
    const { path, at } = JSON.parse(raw);
    return typeof path === "string" &&
      CLAN_PATH.test(path) &&
      now - Number(at) < NEXT_MS
      ? path
      : null;
  } catch {
    return null;
  }
}

/**
 * The landing's state for a signed-out person: "checking" while Elixir's
 * session is read, "signing-in" once Clan's sign-in has started, and
 * "landing" when the page is the one to show.
 */
export function useAutoSignIn(signedOut, search) {
  const [state, setState] = useState("checking");
  useEffect(() => {
    if (!signedOut) return undefined;
    const store = tabStore();
    if (!mayStart({ search, now: Date.now(), store })) {
      setState("landing");
      return undefined;
    }
    let live = true;
    elixirSignedIn().then((yes) => {
      if (!live) return;
      if (!yes) {
        setState("landing");
        return;
      }
      write(store, TRIED, String(Date.now()));
      setState("signing-in");
      trackEvent("clan.signin_started", "auto");
      window.location.assign(SIGN_IN);
    });
    return () => {
      live = false;
    };
  }, [signedOut, search]);
  return state;
}
