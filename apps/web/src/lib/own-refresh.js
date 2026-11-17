/**
 * Your own battles, read now (2026-11-14). The app asks once when it
 * starts, again when the tab comes back after five minutes or more hidden,
 * when you tap the freshness chip, open your own player page or a battle
 * you could highlight. The server holds the real limits (one ask per five
 * minutes per account, your own verified players only, the global bucket
 * and a daily allowance: services/web-api/src/own-refresh.mjs); a refusal
 * is `queued: false` and the page simply carries on.
 *
 * When a read is queued, the page polls the cheap follow-up read at the
 * lane's `retry_after_s`, a few times at most, and never while hidden. Once
 * the reads have landed (and Home's stored week has them, or the attempts
 * run out), your Home, player pages and their games are read again, so the
 * new battle shows without a reload. An open Home's feed is the exception
 * when the app asked on its own (opening, coming back to the tab): its
 * "N new" pill offers what landed, so nothing moves under the reader. When
 * the reader asked (the freshness chip, the refresh button), the feed is
 * read again with the rest, since new games are what they asked to see.
 * Nothing here ever blocks a render or shows an error: `checking` is the
 * one thing a view reads.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { HOME_FEED_KEY } from "./queries.js";

/** Back after this long hidden: ask again. */
export const HIDDEN_ASK_MS = 5 * 60_000;
/** The client's own spacing between asks; the server's floor is the rule. */
export const ASK_SPACING_MS = 30_000;
/** Follow-up reads after one ask, at most. */
export const MAX_POLLS = 4;
const MIN_WAIT_S = 5;
const MAX_WAIT_S = 60;

/** What landing refreshes: your Home's reads (head, feed, week), player
 *  pages and their games (the list a highlight is picked from). */
export const LANDED_KEYS = [
  ["me", "home"],
  ["me", "player"],
  ["me", "player-evidence"],
  ["me", "player-record"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hiddenDoc = () =>
  typeof document !== "undefined" && document.visibilityState === "hidden";

/** What landing refreshes for one player's page: the page and its games. */
export const PLAYER_LANDED_KEYS = [
  ["me", "player"],
  ["me", "player-evidence"],
  ["me", "player-record"],
];

/**
 * One refresher. `ask` never throws; `snapshot()` is `{ checking,
 * outcome, retryAfterS, at }`: `outcome` is "updated" (a read landed, or
 * one was read in the last two minutes), "limited" (a limit said wait
 * `retryAfterS` seconds) or null, from the last ask that finished at `at`.
 * The app's own is built once per query client (useOwnRefresh); a player
 * page's button has one per player (usePlayerRefresh).
 */
export function makeOwnRefresh({
  ask: askServer = api.ownRefresh,
  status = api.ownRefreshStatus,
  invalidate,
  wait = sleep,
  hidden = hiddenDoc,
  now = () => Date.now(),
  spacingMs = ASK_SPACING_MS,
  landedKeys = LANDED_KEYS,
}) {
  let state = { checking: false, outcome: null, retryAfterS: null, at: null };
  let busy = false;
  let lastAsk = -Infinity;
  const listeners = new Set();
  const set = (next) => {
    state = next;
    for (const l of listeners) l();
  };

  async function landed(asked) {
    await Promise.all(
      landedKeys.map((queryKey) => invalidate(queryKey, { asked })),
    );
  }

  async function poll(waitS) {
    let feedTries = 0;
    for (let i = 0; i < MAX_POLLS; i++) {
      await wait(Math.min(MAX_WAIT_S, Math.max(MIN_WAIT_S, waitS)) * 1000);
      if (hidden()) return false;
      const r = await status().catch(() => null);
      if (!r?.ok) return false;
      const players = r.data?.players ?? [];
      if (players.some((p) => p.pending)) continue;
      // Landed. The feed's stored week builds again after a read (the
      // follow-up read woke it); give it one short wait, then refresh.
      if (r.data?.feed_current === false && feedTries++ < 1) {
        waitS = MIN_WAIT_S;
        i -= 1;
        continue;
      }
      return true;
    }
    return false;
  }

  /** `asked`: the reader asked (a tap), not the app on its own. */
  async function ask({ asked = false } = {}) {
    if (busy || now() - lastAsk < spacingMs) return;
    busy = true;
    lastAsk = now();
    set({ ...state, checking: true });
    let outcome = null;
    let retryAfterS = null;
    try {
      const r = await askServer().catch(() => null);
      const body = r?.ok ? r.data : null;
      const players = body?.players ?? [];
      if (body?.queued) {
        const waits = players
          .filter((p) => p.state === "queued")
          .map((p) => p.retry_after_s ?? 15);
        if (await poll(Math.min(...waits))) {
          await landed(asked);
          outcome = "updated";
        }
      } else if (players.some((p) => p.state === "fresh")) {
        // Read in the last two minutes, maybe after this page last read,
        // and maybe after Home's stored week was built: the follow-up read
        // wakes that week's rebuild, so ask it once (and once more after a
        // short wait while the week catches up) before reading again.
        const s = await status().catch(() => null);
        if (s?.ok && s.data?.feed_current === false && !hidden()) {
          await wait(MIN_WAIT_S * 1000);
          await status().catch(() => null);
        }
        await landed(asked);
        outcome = "updated";
      } else {
        const waits = players
          .map((p) => p.retry_after_s)
          .filter((s) => typeof s === "number" && s > 0);
        if (waits.length) {
          outcome = "limited";
          retryAfterS = Math.max(...waits);
        }
      }
    } finally {
      busy = false;
      set({ checking: false, outcome, retryAfterS, at: now() });
    }
  }

  return {
    ask,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    snapshot: () => state,
  };
}

/** An open Home's feed is not read again under the reader when the app
 *  asked on its own (2026-11-14): its "N new" pill counts what landed (its
 *  key is under ["me", "home"], so landing asks it now) and the reader taps
 *  to see it. A feed nobody is looking at is marked stale as before, and a
 *  reader who asked gets the feed read again too. */
const notOpenFeed = (q) =>
  !(
    // The feed in any mode (homeFeedKey): the key, or the key and a mode.
    q.queryKey.length <= HOME_FEED_KEY.length + 1 &&
    HOME_FEED_KEY.every((k, i) => q.queryKey[i] === k) &&
    q.isActive()
  );

const byClient = new WeakMap();

function refresherFor(queryClient) {
  let r = byClient.get(queryClient);
  if (!r) {
    r = makeOwnRefresh({
      invalidate: (queryKey, { asked } = {}) =>
        queryClient.invalidateQueries(
          asked ? { queryKey } : { queryKey, predicate: notOpenFeed },
        ),
    });
    byClient.set(queryClient, r);
  }
  return r;
}

const IDLE = { checking: false, outcome: null, retryAfterS: null, at: null };

/** A view's `ask` is a tap: the reader asked. */
function useRefresher(r) {
  const state = useSyncExternalStore(r.subscribe, r.snapshot, () => IDLE);
  const ask = useCallback(() => {
    void r.ask({ asked: true });
  }, [r]);
  return { ...state, ask };
}

/** `{ checking, outcome, retryAfterS, at, ask }`: the app's one refresher. */
export function useOwnRefresh() {
  return useRefresher(refresherFor(useQueryClient()));
}

const byPlayer = new WeakMap();

/** One player page's button: a read of that player alone, under the
 *  server's per-player limits; no spacing of its own, since the server
 *  answers every tap and the button shows what it said. */
export function usePlayerRefresh(tag) {
  const queryClient = useQueryClient();
  let map = byPlayer.get(queryClient);
  if (!map) {
    map = new Map();
    byPlayer.set(queryClient, map);
  }
  let r = map.get(tag);
  if (!r) {
    r = makeOwnRefresh({
      ask: () => api.refreshPlayer(tag),
      status: () => api.refreshPlayerStatus(tag),
      invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey }),
      spacingMs: 0,
      landedKeys: PLAYER_LANDED_KEYS,
    });
    map.set(tag, r);
  }
  return useRefresher(r);
}

/** Whether `me` has a verified player of its own: the only reason to ask. */
export const hasOwnVerified = (me) =>
  me?.authenticated === true &&
  (me.claims ?? []).some(
    (c) =>
      c.claim_status === "verified" &&
      (c.is_primary ||
        c.relationship === "primary" ||
        c.relationship === "alt"),
  );

/**
 * The app's own asks: once when a signed-in app with a verified player of
 * its own starts, and again when the tab is shown after HIDDEN_ASK_MS or
 * more hidden. Mounted once, at the root.
 */
export function useRefreshOnOpen(me) {
  const r = refresherFor(useQueryClient());
  const ask = useCallback(() => {
    void r.ask();
  }, [r]);
  const eligible = hasOwnVerified(me);
  useEffect(() => {
    if (!eligible) return undefined;
    ask();
    let hiddenAt = hiddenDoc() ? Date.now() : null;
    const onVisibility = () => {
      if (hiddenDoc()) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= HIDDEN_ASK_MS) ask();
      hiddenAt = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [eligible, ask]);
}

/** Ask when a page that starts sharing opens (your own player page, a
 *  battle you could highlight): the same call, under the same limits. */
export function useAskOnOpen(enabled) {
  const { ask } = useOwnRefresh();
  useEffect(() => {
    if (enabled) ask();
  }, [enabled, ask]);
}
