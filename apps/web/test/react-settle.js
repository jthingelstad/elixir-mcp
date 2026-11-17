/**
 * What every jsdom test does when it ends (setup-react-settle.js): the
 * tree it rendered is unmounted, and React's scheduler has run every
 * task it had queued.
 *
 * Why (2026-11-17, PR #1092's CI): Testing Library unmounts only when
 * told to, and with vitest's `globals: false` its automatic afterEach is
 * not registered. A file's last test left the whole App mounted, its
 * queries still answering, and React's scheduler still working through
 * the renders and passive-effect flushes they queued, one setImmediate
 * slice at a time. vitest then tore the jsdom environment down between
 * two slices, and the next slice read `window.event`: an unhandled
 * "window is not defined" that failed a run whose 1017 tests all passed.
 *
 * Unmounting stops new work, since an update to an unmounted tree
 * schedules nothing. A task already queued still runs, and React's
 * passive flush reads `window` before anything else, so the scheduler is
 * drained too: an idle-priority task runs after every task queued ahead
 * of it, and this waits for that one.
 */
import { cleanup } from "@testing-library/react";
import { unstable_IdlePriority, unstable_scheduleCallback } from "scheduler";

export async function settleReact() {
  cleanup();
  await new Promise((resolve) =>
    unstable_scheduleCallback(unstable_IdlePriority, () => {
      resolve();
    }),
  );
}
