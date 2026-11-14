import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api.js";

/**
 * The passport's catch-up on open (#1015): `POST /api/me/passport/reconcile`,
 * the owner's bounded, idempotent pass that grants what was earned while no
 * write was watching (a friendly with someone you follow, a hook that
 * failed, the profile list's latches).
 *
 *  - Never before first paint: it starts after the page has drawn, and
 *    nothing waits for it.
 *  - Repeats while the answer says `more`, at most MAX_CALLS times.
 *  - Quiet on failure: a refused or failed pass changes nothing on screen;
 *    the next open tries again.
 *  - At most once a minute per tab (the route allows 120 an hour), so
 *    moving between pages does not call it again and again; StrictMode's
 *    second mount joins the pass already running.
 *
 * Each answer is the owner's passport, so it replaces the cached
 * `["me", "passport"]` read in place (the profile list redraws from it).
 * A pass that granted something refreshes the bell, where a new Stamp is
 * one line.
 */
export const MAX_CALLS = 5;
export const MIN_GAP_MS = 60_000;

let running = null;
let lastStarted = -Infinity;

/** A write's answer as the passport read's envelope: the owner's passport
 *  without the write's own `granted` and `more`. */
export function asPassportRead(res) {
  const out = { ...res.data };
  delete out.granted;
  delete out.more;
  return { ...res, data: out };
}

/** Put a write's answer in the cached passport read. A read already on
 *  its way is cancelled first: it left before the write, and landing
 *  after it would paint the state from before (as src/client/write.ts
 *  does for the reads a write invalidates). */
export async function putPassport(queryClient, res) {
  await queryClient.cancelQueries({
    queryKey: ["me", "passport"],
    exact: true,
  });
  queryClient.setQueryData(["me", "passport"], asPassportRead(res));
}

/** One run: up to MAX_CALLS passes while `more`, each answer handed to
 *  `onAnswer` as it came. Resolves to how many levels were granted;
 *  never rejects. */
export async function reconcileUntilDone(call, onAnswer) {
  let granted = 0;
  for (let n = 0; n < MAX_CALLS; n++) {
    let res;
    try {
      res = await call();
    } catch {
      return granted;
    }
    if (!res?.ok || !res.data) return granted;
    const got = res.data.granted;
    granted += Array.isArray(got) ? got.length : 0;
    await onAnswer(res);
    if (res.data.more !== true) return granted;
  }
  return granted;
}

/** Start a run unless one is running or one started within MIN_GAP_MS. */
export function reconcileOnce(queryClient, nowMs = Date.now()) {
  if (running) return running;
  if (nowMs - lastStarted < MIN_GAP_MS) return Promise.resolve(0);
  lastStarted = nowMs;
  running = reconcileUntilDone(api.reconcilePassport, (res) =>
    putPassport(queryClient, res),
  )
    .then(async (granted) => {
      if (granted > 0)
        await queryClient.invalidateQueries({ queryKey: ["me", "bell"] });
      return granted;
    })
    .catch(() => 0)
    .finally(() => {
      running = null;
    });
  return running;
}

/** For tests: forget the last run. */
export function resetReconcile() {
  running = null;
  lastStarted = -Infinity;
}

/** Home's catch-up on open, after the first paint. `enabled` false (a
 *  signed-out view) does nothing. */
export function useReconcileOnOpen(enabled = true) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return undefined;
    // After the browser has painted: a timer, not the effect itself.
    const t = setTimeout(() => {
      reconcileOnce(queryClient);
    }, 0);
    return () => clearTimeout(t);
  }, [enabled, queryClient]);
}
