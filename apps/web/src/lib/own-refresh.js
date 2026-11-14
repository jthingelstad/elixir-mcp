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
 * new battle shows without a reload. Nothing here ever blocks a render or
 * shows an error: `checking` is the one thing a view reads.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";

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

/**
 * One app's refresher. `ask` never throws; `snapshot()` is
 * `{ checking }`. Built once per query client (useOwnRefresh).
 */
export function makeOwnRefresh({
  ask: askServer = api.ownRefresh,
  status = api.ownRefreshStatus,
  invalidate,
  wait = sleep,
  hidden = hiddenDoc,
  now = () => Date.now(),
}) {
  let state = { checking: false };
  let busy = false;
  let lastAsk = -Infinity;
  const listeners = new Set();
  const set = (next) => {
    state = next;
    for (const l of listeners) l();
  };

  async function landed() {
    await Promise.all(LANDED_KEYS.map((queryKey) => invalidate(queryKey)));
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

  async function ask() {
    if (busy || now() - lastAsk < ASK_SPACING_MS) return;
    busy = true;
    lastAsk = now();
    set({ checking: true });
    try {
      const r = await askServer().catch(() => null);
      const body = r?.ok ? r.data : null;
      const players = body?.players ?? [];
      if (body?.queued) {
        const waits = players
          .filter((p) => p.state === "queued")
          .map((p) => p.retry_after_s ?? 15);
        if (await poll(Math.min(...waits))) await landed();
      } else if (players.some((p) => p.state === "fresh")) {
        // Read in the last two minutes, maybe after this page last read.
        await invalidate(["me", "home"]);
      }
    } finally {
      busy = false;
      set({ checking: false });
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

const byClient = new WeakMap();

function refresherFor(queryClient) {
  let r = byClient.get(queryClient);
  if (!r) {
    r = makeOwnRefresh({
      invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey }),
    });
    byClient.set(queryClient, r);
  }
  return r;
}

const IDLE = { checking: false };

/** `{ checking, ask }`: the app's one refresher. */
export function useOwnRefresh() {
  const queryClient = useQueryClient();
  const r = refresherFor(queryClient);
  const state = useSyncExternalStore(r.subscribe, r.snapshot, () => IDLE);
  const ask = useCallback(() => {
    void r.ask();
  }, [r]);
  return { checking: state.checking, ask };
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
  const { ask } = useOwnRefresh();
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
