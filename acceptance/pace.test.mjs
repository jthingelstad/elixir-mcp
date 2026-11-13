/**
 * The pace (run.mjs PACE, 2026-11-13) on a fake clock: the runner rests
 * twice each door call's time before the next, inside its bounds, never
 * after the last call and never for a cached read, and stays one call at
 * a time. Back-to-back unpaced runs drained the database's EBS burst
 * balance to 0 on 2026-11-12/13.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONCURRENCY,
  PACE,
  SUITES,
  pacedDoor,
  restAfter,
  runSuite,
} from "./run.mjs";

/** A fake clock: `sleep` and each call advance it; nothing waits. */
function fakeClock() {
  let t = 0;
  const slept = [];
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

test("the pace rests twice a call's time, between 250 ms and 10 s", () => {
  assert.deepEqual(PACE, { ratio: 2, minRestMs: 250, maxRestMs: 10_000 });
  assert.equal(restAfter(0), 250);
  assert.equal(restAfter(100), 250);
  assert.equal(restAfter(800), 1600);
  assert.equal(restAfter(4_000), 8_000);
  assert.equal(restAfter(25_000), 10_000);
  assert.equal(restAfter(800, null), 0);
});

test("the runner stays one case at a time in every suite", () => {
  assert(Object.values(CONCURRENCY).every((n) => n === 1));
});

test("a paced door rests before the next call, never after the last", async () => {
  const clock = fakeClock();
  const durations = [800, 100, 6_000];
  const door = pacedDoor(
    {
      call: async () => {
        clock.advance(durations.shift());
        return { body: {} };
      },
    },
    { sleep: clock.sleep, now: clock.now },
  );
  await door.call("a", {});
  await door.call("b", {});
  await door.call("c", {});
  assert.deepEqual(clock.slept, [1600, 250]);
  assert.deepEqual(door.stats, { calls: 3, restedMs: 1850, callMs: 6900 });
});

test("a call that throws still sets the rest owed", async () => {
  const clock = fakeClock();
  const door = pacedDoor(
    {
      call: async () => {
        clock.advance(1_000);
        throw new Error("door down");
      },
    },
    { sleep: clock.sleep, now: clock.now },
  );
  await assert.rejects(door.call("a", {}), /door down/);
  await assert.rejects(door.call("a", {}), /door down/);
  assert.deepEqual(clock.slept, [2000]);
});

test("no pace is the door itself", () => {
  const door = { call: async () => ({}) };
  assert.equal(pacedDoor(door, { pace: null }), door);
});

test("a paced run rests between door calls and not for a cached read", async () => {
  const clock = fakeClock();
  let calls = 0;
  const door = {
    toolsList: async () => [{ name: "game_clock" }, { name: "war_current" }],
    call: async () => {
      calls += 1;
      clock.advance(500);
      return { body: { notes: [] }, isError: false, ms: 500 };
    },
  };
  const saved = { ...SUITES };
  for (const k of Object.keys(SUITES)) delete SUITES[k];
  SUITES.fake = [
    {
      id: "game_clock twice",
      run: async (ctx) => {
        await ctx.read("game_clock", {});
        await ctx.read("game_clock", {});
      },
    },
    {
      id: "war_current",
      run: async (ctx) => void (await ctx.read("war_current", {})),
    },
  ];
  try {
    const report = await runSuite(door, {
      quiet: true,
      pace: PACE,
      sleep: clock.sleep,
      now: clock.now,
    });
    assert.equal(report.failures, 0);
    assert.equal(calls, 2, "the second game_clock read is cached");
    assert.deepEqual(
      clock.slept,
      [1000],
      "one rest, between the two door calls",
    );
    assert.deepEqual(report.pace, {
      calls: 2,
      call_seconds: 1,
      rest_seconds: 1,
    });
    const unpaced = await runSuite(door, { quiet: true });
    assert.equal(unpaced.pace, undefined, "tests and replays run unpaced");
  } finally {
    for (const k of Object.keys(SUITES)) delete SUITES[k];
    Object.assign(SUITES, saved);
  }
});
