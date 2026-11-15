/**
 * The passport's reconcile gate (lib/passport.js) lives in the tab's
 * sessionStorage, which outlives one test within a file. Every test starts
 * with it lifted, as a fresh tab would; test/passport-gate.test.js tests
 * the gate itself.
 */
import { beforeEach } from "vitest";
import { liftReconcileGate } from "../src/lib/reconcile-gate.js";

beforeEach(() => {
  liftReconcileGate();
});
