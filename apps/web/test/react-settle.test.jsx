/**
 * settleReact (react-settle.js), which every test runs as it ends: the
 * tree is unmounted and no scheduler task is left to run after jsdom
 * is gone. The queued task stands in for React's passive-effect flush,
 * whose first line reads `window.event`.
 */
import { test, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { unstable_NormalPriority, unstable_scheduleCallback } from "scheduler";
import { settleReact } from "./react-settle.js";

const queue = (log) =>
  unstable_scheduleCallback(unstable_NormalPriority, () => {
    log.push(typeof window);
  });

test("unmounting alone leaves a queued scheduler task to run later", () => {
  const log = [];
  render(<p>here</p>);
  queue(log);
  cleanup();
  expect(document.body.textContent).toBe("");
  expect(log).toEqual([]);
});

test("settleReact unmounts and runs every queued task while window exists", async () => {
  const log = [];
  const unmounted = [];
  function Probe() {
    return <p ref={(el) => el === null && unmounted.push(true)}>here</p>;
  }
  render(<Probe />);
  queue(log);
  queue(log);
  await settleReact();
  expect(unmounted).toEqual([true]);
  expect(document.body.textContent).toBe("");
  expect(log).toEqual(["object", "object"]);
});
