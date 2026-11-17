/**
 * Kept apart from passport.js, which imports page paths: the API clients
 * import this module, and it imports nothing, so it can never close an
 * import cycle through them.
 */

/**
 * The reconciliation's gate (stamps tidy, 2026-11-14). Home and your
 * passport both reconcile on open, so moving between them, or reopening
 * Home, asked the server again for a pass it had just finished. A run that
 * finished is not repeated within RECONCILE_GATE_MS in this browser tab
 * (sessionStorage, with memory when storage is refused). What still runs:
 * a run the server stopped with `more` (not finished, so not gated), a run
 * that failed (nothing was settled), and the next open after a write that
 * could earn (`noteWrite` lifts the gate). Signing out lifts it too.
 */
export const RECONCILE_GATE_MS = 60_000;
const GATE_KEY = "passport-reconciled-at";
let gateMemory = null;
// Counts gate lifts, so a run that was on its way when a write lifted the
// gate does not close it again: that run may have read before the write.
let lifts = 0;

/** How many times the gate was lifted, for a run to compare. */
export const gateLifts = () => lifts;

function readGate() {
  try {
    const raw = sessionStorage.getItem(GATE_KEY);
    if (raw !== null) return Number(raw);
  } catch {
    /* Storage refused: memory holds it. */
  }
  return gateMemory;
}

function writeGate(at) {
  gateMemory = at;
  try {
    if (at === null) sessionStorage.removeItem(GATE_KEY);
    else sessionStorage.setItem(GATE_KEY, String(at));
  } catch {
    /* Storage refused: memory holds it. */
  }
}

/** Whether an open should reconcile now: no finished run in the last
 *  RECONCILE_GATE_MS, or the gate was lifted since. */
export function reconcileDue(now = Date.now()) {
  const at = readGate();
  if (at === null || !Number.isFinite(at)) return true;
  // A clock moved backwards is no reason to wait.
  return now - at >= RECONCILE_GATE_MS || now < at;
}

/** A run finished: hold the next open off for the gate's span. */
export function markReconciled(now = Date.now()) {
  writeGate(now);
}

/** Lift the gate: the next open reconciles whatever the clock says. */
export function liftReconcileGate() {
  lifts += 1;
  writeGate(null);
}

/**
 * The writes that can earn a Stamp or move what a reconciliation reads
 * (the hooks in docs/notes/2026-11-14-passport-stamps-earning.md): a
 * player added, followed, verified or changed; a picture; a digest choice;
 * a cheer; a post about a battle with words; the map's place or Not now. Paths are
 * the app's own (api.js, clan/api.js); an agent's scoped routes earn
 * nothing for the person, so they are not here.
 */
const EARNING_WRITES = [
  /^\/api\/claims$/,
  /^\/api\/me\/verify$/,
  /^\/api\/me\/players$/,
  /^\/api\/me\/follow-all$/,
  /^\/api\/me\/avatar$/,
  /^\/api\/me\/email$/,
  /^\/api\/me\/cheers$/,
  /^\/api\/me\/posts(?:\/[^/]+)?$/,
  /^\/api\/me\/passport\/map$/,
  /^\/api\/clan\/me\/place$/,
];

export function isEarningWrite(method, path) {
  if (!method || String(method).toUpperCase() === "GET") return false;
  const clean = String(path ?? "").split("?")[0];
  return EARNING_WRITES.some((re) => re.test(clean));
}

/** Called with every answered request (api.js, clan/api.js): a write that
 *  could earn and succeeded lifts the gate. A refused one changed nothing. */
export function noteWrite(method, path, env) {
  if (env?.ok && isEarningWrite(method, path)) liftReconcileGate();
  return env;
}
