/**
 * The passport's reconcile gate (lib/reconcile-gate.js and reconcileOnOpen in lib/passport.js, #1015 tidy): a finished
 * run is not repeated within a minute in one tab; a run the server stopped
 * with `more`, a failed run, and the next open after a write that could
 * earn all still reconcile. setup-passport-gate.js lifts it before each test.
 */
import { test, expect, vi } from "vitest";
import {
  RECONCILE_GATE_MS,
  isEarningWrite,
  liftReconcileGate,
  noteWrite,
  reconcileDue,
} from "../src/lib/reconcile-gate.js";
import { reconcileOnOpen } from "../src/lib/passport.js";

const pass = (more, granted = []) => ({
  ok: true,
  status: 200,
  data: { passport: {}, granted, more },
});

const clock = (start = 1_000_000) => {
  let t = start;
  const now = () => t;
  now.advance = (ms) => (t += ms);
  return now;
};

test("a finished run holds the next open off for a minute, then runs again", async () => {
  const now = clock();
  const call = vi.fn(async () => pass(false));
  expect(await reconcileOnOpen(call, { now })).toEqual({
    read: 1,
    granted: 0,
    done: true,
  });
  expect(await reconcileOnOpen(call, { now })).toBeNull();
  now.advance(RECONCILE_GATE_MS - 1);
  expect(await reconcileOnOpen(call, { now })).toBeNull();
  expect(call).toHaveBeenCalledTimes(1);
  now.advance(1);
  expect(reconcileDue(now())).toBe(true);
  await reconcileOnOpen(call, { now });
  expect(call).toHaveBeenCalledTimes(2);
});

test("a run the server stopped with more is not finished, so the next open runs", async () => {
  const now = clock();
  const call = vi.fn(async () => pass(true));
  const first = await reconcileOnOpen(call, { now });
  expect(first).toEqual({ read: 3, granted: 0, done: false });
  expect(reconcileDue(now())).toBe(true);
  await reconcileOnOpen(call, { now });
  expect(call).toHaveBeenCalledTimes(6);
});

test("a failed run settles nothing, so the next open tries again", async () => {
  const now = clock();
  const refused = vi.fn(async () => ({ ok: false, status: 503, data: null }));
  expect(await reconcileOnOpen(refused, { now })).toEqual({
    read: 0,
    granted: 0,
    done: false,
  });
  const thrown = vi.fn(async () => {
    throw new Error("offline");
  });
  await reconcileOnOpen(thrown, { now });
  expect(reconcileDue(now())).toBe(true);
});

test("a successful write that could earn lifts the gate; a refused one or a read does not", async () => {
  const now = clock();
  const call = vi.fn(async () => pass(false));
  await reconcileOnOpen(call, { now });
  expect(reconcileDue(now())).toBe(false);
  noteWrite("PUT", "/api/me/cheers", { ok: false, status: 429, data: {} });
  noteWrite("GET", "/api/me/cheers", { ok: true, status: 200, data: {} });
  noteWrite("POST", "/api/me/sessions/revoke", { ok: true, status: 200 });
  expect(reconcileDue(now())).toBe(false);
  const env = { ok: true, status: 200, data: {} };
  expect(noteWrite("PUT", "/api/me/cheers", env)).toBe(env);
  expect(reconcileDue(now())).toBe(true);
  await reconcileOnOpen(call, { now });
  expect(call).toHaveBeenCalledTimes(2);
});

test("a write landing while a run is on its way keeps the gate open", async () => {
  const now = clock();
  let release;
  const held = new Promise((r) => (release = r));
  const call = vi.fn(async () => {
    await held;
    return pass(false);
  });
  const run = reconcileOnOpen(call, { now });
  // An open while the run is on its way joins it.
  expect(reconcileOnOpen(call, { now })).toBe(run);
  noteWrite("POST", "/api/me/highlights", { ok: true, status: 200 });
  release();
  await run;
  expect(call).toHaveBeenCalledTimes(1);
  expect(reconcileDue(now())).toBe(true);
});

test("the writes that can earn, by the app's own paths", () => {
  for (const [method, path] of [
    ["POST", "/api/claims"],
    ["POST", "/api/me/verify"],
    ["POST", "/api/me/players"],
    ["POST", "/api/me/follow-all"],
    ["POST", "/api/me/avatar"],
    ["PUT", "/api/me/email"],
    ["PUT", "/api/me/cheers"],
    ["POST", "/api/me/highlights"],
    ["PUT", "/api/me/highlights/abc123"],
    ["POST", "/api/me/passport/map"],
    ["PUT", "/api/clan/me/place"],
  ])
    expect(isEarningWrite(method, path), `${method} ${path}`).toBe(true);
  for (const [method, path] of [
    ["GET", "/api/me/passport"],
    ["POST", "/api/me/passport/reconcile"],
    ["POST", "/api/me/highlights/share"],
    ["POST", "/api/me/highlights/discord"],
    ["POST", "/api/agent/abc/players"],
    ["PUT", "/api/me/bell/seen"],
    ["DELETE", "/api/clan/me/place/x"],
  ])
    expect(isEarningWrite(method, path), `${method} ${path}`).toBe(false);
});

test("the gate lives without storage", async () => {
  const now = clock();
  const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  liftReconcileGate();
  const call = vi.fn(async () => pass(false));
  await reconcileOnOpen(call, { now });
  expect(await reconcileOnOpen(call, { now })).toBeNull();
  expect(call).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalled();
  vi.restoreAllMocks();
});
