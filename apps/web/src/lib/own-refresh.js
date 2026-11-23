/**
 * Your own battles, read now (2026-11-14). The app asks once when it
 * starts, again when the tab comes back after five minutes or more hidden,
 * when you tap the freshness chip, open your own player page or a battle
 * you could post about. The server holds the real limits (one ask per five
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
 * one thing most views read. A player page's button (2026-11-23) reads
 * more: what the check found, a slow path, and a refusal it can say.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";
import { HOME_FEED_KEY, PLAYER_PAIR_KEY } from "./queries.js";

/** Back after this long hidden: ask again. */
export const HIDDEN_ASK_MS = 5 * 60_000;
/** The client's own spacing between asks; the server's floor is the rule. */
export const ASK_SPACING_MS = 30_000;
/** Follow-up reads after one ask, at most. */
export const MAX_POLLS = 4;
const MIN_WAIT_S = 5;
const MAX_WAIT_S = 60;

/** Player reads, including every Together summary and battle page. */
export const PLAYER_LANDED_KEYS = [
  ["me", "player"],
  ["me", "player-evidence"],
  ["me", "player-record"],
  PLAYER_PAIR_KEY,
];
/** The account's read completion includes those same player reads. */
export const LANDED_KEYS = [["me", "home"], ...PLAYER_LANDED_KEYS];

/** A button's slow path (2026-11-23): after the first few follow-up reads,
 *  this many more, this far apart (about three minutes), never while the
 *  tab is hidden. */
export const SLOW_POLLS = 9;
export const SLOW_WAIT_MS = 20_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hiddenDoc = () =>
  typeof document !== "undefined" && document.visibilityState === "hidden";
/** A read still on its way: the battle log, or the profile a tap asked for. */
const waiting = (p) => p.pending === true || p.profile_pending === true;

/**
 * One refresher. `ask` never throws; `snapshot()` is `{ checking,
 * outcome, retryAfterS, at, result }`: `outcome` is "updated" (a read
 * landed, or one was read in the last two minutes), "limited" (a limit said
 * wait `retryAfterS` seconds) or null, from the last ask that finished at
 * `at`. The app's own is built once per query client (useOwnRefresh).
 *
 * A player page's button (`button: true`, one per player:
 * usePlayerRefresh) is a tap that also reads the profile, and says what it
 * found. It sends the ask's `since` marker with each follow-up read, and
 * `result` is the page player's entry from the last one (`new_battles`,
 * `newest_battle_at`, `latest_is_new`, `profile_changes`). Two more
 * outcomes are its own: "slow" (still on its way after the first reads; it
 * keeps reading, slower, then lands as "updated" or "unavailable") and
 * "unavailable" (refused with no wait to name, or the ask failed).
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
  button = false,
  tag = null,
}) {
  let state = {
    checking: false,
    outcome: null,
    retryAfterS: null,
    at: null,
    result: null,
  };
  let busy = false;
  let lastAsk = -Infinity;
  /** Each ask's number: a newer ask ends an older one's slow reads. */
  let generation = 0;
  const listeners = new Set();
  const set = (next) => {
    state = next;
    for (const l of listeners) l();
  };
  const entryOf = (players) =>
    (tag && players.find((p) => p.tag === tag)) || null;

  async function landed(asked) {
    await Promise.all(
      landedKeys.map((queryKey) => invalidate(queryKey, { asked })),
    );
  }

  /** "landed", "waiting" (still on its way, or the tab hid) or "failed",
   *  with the page player's entry from the last read. */
  async function poll(waitS, since) {
    let feedTries = 0;
    let entry = null;
    for (let i = 0; i < MAX_POLLS; i++) {
      await wait(Math.min(MAX_WAIT_S, Math.max(MIN_WAIT_S, waitS)) * 1000);
      if (hidden()) return { kind: "waiting", entry };
      const r = await status(since).catch(() => null);
      if (!r?.ok) return { kind: "failed", entry };
      const players = r.data?.players ?? [];
      entry = entryOf(players) ?? entry;
      if (players.some(waiting)) continue;
      // Landed. The feed's stored week builds again after a read (the
      // follow-up read woke it); give it one short wait, then refresh.
      if (r.data?.feed_current === false && feedTries++ < 1) {
        waitS = MIN_WAIT_S;
        i -= 1;
        continue;
      }
      return { kind: "landed", entry };
    }
    return { kind: "waiting", entry };
  }

  /** A button's slow path: a read every SLOW_WAIT_MS, skipped while the
   *  tab is hidden, at most SLOW_POLLS; a newer ask ends it. */
  async function slow(g, since, asked, entry) {
    for (let i = 0; i < SLOW_POLLS; i++) {
      await wait(SLOW_WAIT_MS);
      if (g !== generation) return;
      if (hidden()) continue;
      const r = await status(since).catch(() => null);
      if (g !== generation) return;
      if (!r?.ok) continue;
      const players = r.data?.players ?? [];
      entry = entryOf(players) ?? entry;
      if (players.some(waiting)) continue;
      await landed(asked);
      if (g !== generation) return;
      set({ ...state, outcome: "updated", at: now(), result: entry });
      return;
    }
    if (g === generation)
      set({ ...state, outcome: "unavailable", at: now(), result: null });
  }

  /** `asked`: the reader asked (a tap), not the app on its own. */
  async function ask({ asked = false } = {}) {
    if (busy || now() - lastAsk < spacingMs) return;
    busy = true;
    lastAsk = now();
    const g = ++generation;
    set({ ...state, checking: true });
    let outcome = null;
    let retryAfterS = null;
    let result = null;
    let slowFrom = null;
    let since = null;
    try {
      const r = await askServer().catch(() => null);
      const body = r?.ok ? r.data : null;
      const players = body?.players ?? [];
      since = body?.since ?? null;
      const profileQueued =
        button && players.some((p) => p.profile === "queued");
      if (body?.queued || profileQueued) {
        const waits = players
          .filter((p) => p.state === "queued")
          .map((p) => p.retry_after_s ?? 15);
        const read = await poll(waits.length ? Math.min(...waits) : 15, since);
        result = read.entry;
        if (read.kind === "landed") {
          await landed(asked);
          outcome = "updated";
        } else if (button && read.kind === "waiting") {
          outcome = "slow";
          slowFrom = read.entry;
        } else if (button) {
          outcome = "unavailable";
        }
      } else if (players.some((p) => p.state === "fresh")) {
        // Read in the last two minutes, maybe after this page last read,
        // and maybe after Home's stored week was built: the follow-up read
        // wakes that week's rebuild, so ask it once (and once more after a
        // short wait while the week catches up) before reading again.
        const s = await status(since).catch(() => null);
        if (s?.ok && s.data?.feed_current === false && !hidden()) {
          await wait(MIN_WAIT_S * 1000);
          await status(since).catch(() => null);
        }
        result = s?.ok ? entryOf(s.data?.players ?? []) : null;
        await landed(asked);
        outcome = "updated";
      } else {
        const waits = players
          .map((p) => p.retry_after_s)
          .filter((s) => typeof s === "number" && s > 0);
        if (waits.length) {
          outcome = "limited";
          retryAfterS = Math.max(...waits);
        } else if (button) {
          // Refused with no wait to name (no token free, or the ask
          // failed): say so, rather than nothing.
          outcome = "unavailable";
        }
      }
    } finally {
      busy = false;
      set({ checking: false, outcome, retryAfterS, at: now(), result });
    }
    if (outcome === "slow") void slow(g, since, asked, slowFrom);
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

const IDLE = {
  checking: false,
  outcome: null,
  retryAfterS: null,
  at: null,
  result: null,
};

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

/** One player page's button: a tap, so it also reads the page player's
 *  profile and says what it found (2026-11-23). On anyone else's page, a
 *  read of that player alone under the server's per-player limits; on your
 *  own, your own refresh (every verified player of yours, your limits), and
 *  what lands refreshes Home too. No spacing of its own, since the server
 *  answers every tap and the button shows what it said. */
export function usePlayerRefresh(tag, { own = false } = {}) {
  const queryClient = useQueryClient();
  let map = byPlayer.get(queryClient);
  if (!map) {
    map = new Map();
    byPlayer.set(queryClient, map);
  }
  const key = `${own ? "own" : "other"} ${tag}`;
  let r = map.get(key);
  if (!r) {
    r = makeOwnRefresh({
      ask: () => api.refreshPlayer(tag, { tap: true }),
      status: (since) => api.refreshPlayerStatus(tag, since),
      invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey }),
      spacingMs: 0,
      landedKeys: own ? LANDED_KEYS : PLAYER_LANDED_KEYS,
      button: true,
      tag,
    });
    map.set(key, r);
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
 *  battle you could post about): the same call, under the same limits. */
export function useAskOnOpen(enabled) {
  const { ask } = useOwnRefresh();
  useEffect(() => {
    if (enabled) ask();
  }, [enabled, ask]);
}
