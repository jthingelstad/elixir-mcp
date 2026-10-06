import test from "node:test";
import assert from "node:assert/strict";
import { gym } from "./checks/gym.mjs";

const run = (id, body) =>
  gym
    .find((c) => c.id === id)
    .run({
      read: async () => ({ body, isError: Boolean(body.error), ms: 1 }),
    });

test("calendar-sensitive progress control follows the newest snapshot, keeping its negative control", async () => {
  const body = {
    snapshot: {
      date: "2026-10-06",
      progress: [
        {
          key: "seasonal-trophy-road-202609",
          day: "2026-10-04",
          current: false,
        },
        {
          key: "seasonal-trophy-road-202610",
          day: "2026-10-06",
          current: true,
        },
      ],
    },
  };
  assert.equal((await run("329.4", body)).skip, undefined);
  body.snapshot.progress[1].current = false;
  await assert.rejects(run("329.4", body), /false !== true/);
});

test("a priced-page control applies only to actual cap refusals and still catches a missing retry hint", async () => {
  assert.match(
    (await run("316.4", { battles: [], notes: [] })).skip,
    /SKIPPED/,
  );
  await run("316.4", {
    error: { code: "result_too_large", hint: "a limit of 5 should fit" },
  });
  await assert.rejects(
    run("316.4", { error: { code: "result_too_large", hint: "too large" } }),
    /no note says it/,
  );
});

test("the live future-window control remains future and rejects an unexplained empty answer", async () => {
  const probe = gym.find((c) => c.id === "220-future-window");
  await probe.run({
    read: async (tool, args) => {
      assert.equal(tool, "game_events");
      assert.ok(Date.parse(args.from) > Date.now());
      assert.ok(Date.parse(args.to) > Date.parse(args.from));
      return {
        body: { notes: ["This future window has not yet been observed."] },
        isError: false,
      };
    },
  });
  await assert.rejects(
    run("220-future-window", { notes: [] }),
    /not been observed yet/,
  );
});
