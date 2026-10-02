/**
 * The season sweep (lib/battle-sweep.js) against a hub that prices an
 * oversized page: the live Days page showed "Result is 49162
 * characters; the cap is 48000" on 2026-10-02, because the sweep asked
 * for compact pages of 50 and gave up on the refusal.
 */
import { test, expect } from "vitest";
import { fittingLimit, sweepBattles } from "../src/lib/battle-sweep.js";

const refusal = (hint) =>
  Object.assign(new Error("Result is 49162 characters; the cap is 48000."), {
    code: "result_too_large",
    hint,
  });

/** A hub of `n` battles that refuses any page above `fits`, pricing it
 *  as renderToolResultText() does. `calls` collects every read. */
function hub(n, fits, { priced = true } = {}) {
  const all = Array.from({ length: n }, (_, i) => ({ battle_id: `b${i}` }));
  const calls = [];
  const read = async (tool, args) => {
    calls.push({ tool, ...args });
    if (args.limit > fits)
      throw refusal(
        priced
          ? `Narrow the arguments (limit, from, to). This page was 49162 characters at limit ${args.limit} (verbosity compact); a limit of ${fits} should fit the same arguments.`
          : "Narrow the arguments (limit, from, to).",
      );
    const from = Number(args.cursor ?? 0);
    const page = all.slice(from, from + args.limit);
    return {
      applied: { limit: args.limit, verbosity: "compact" },
      battles: page,
      ...(args.include_total ? { total_count: n } : {}),
      next_cursor: from + args.limit < n ? String(from + args.limit) : null,
    };
  };
  return { read, calls };
}

const ARGS = { player_tag: "#P", season: "current", verbosity: "compact" };

test("a page the cap refuses is read again at the limit the refusal names", async () => {
  const { read, calls } = hub(70, 23);
  const out = await sweepBattles(read, { ...ARGS, limit: 40 }, 12);
  expect(out.battles).toHaveLength(70);
  expect(out.capped).toBe(false);
  expect(out.total).toBe(70);
  // One refusal, then every page at the limit that fits, from the top.
  expect(calls.map((c) => [c.limit, c.cursor ?? null])).toEqual([
    [40, null],
    [23, null],
    [23, "23"],
    [23, "46"],
    [23, "69"],
  ]);
  expect(calls[1].include_total).toBe(true);
});

test("a refusal that names no limit halves the page", async () => {
  const { read, calls } = hub(30, 12, { priced: false });
  const out = await sweepBattles(read, { ...ARGS, limit: 50 }, 12);
  expect(out.battles).toHaveLength(30);
  expect(calls.map((c) => c.limit)).toEqual([50, 25, 12, 12, 12]);
});

test("a refused read counts against the sweep's reads", async () => {
  const { read, calls } = hub(100, 10);
  const out = await sweepBattles(read, { ...ARGS, limit: 40 }, 3);
  expect(calls).toHaveLength(3);
  expect(out.battles).toHaveLength(20);
  expect(out.capped).toBe(true);
});

test("a page that fits as asked is read once, and other errors still fail", async () => {
  const { read, calls } = hub(30, 40);
  const out = await sweepBattles(read, { ...ARGS, limit: 40 }, 12);
  expect(out.battles).toHaveLength(30);
  expect(calls).toHaveLength(1);

  const broken = async () => {
    throw Object.assign(new Error("deadline"), { code: "query_timeout" });
  };
  await expect(sweepBattles(broken, ARGS, 12)).rejects.toThrow("deadline");
  const tooBig = async () => {
    throw refusal("a limit of 1 should fit");
  };
  await expect(sweepBattles(tooBig, { ...ARGS, limit: 1 }, 12)).rejects.toThrow(
    "the cap is 48000",
  );
});

test("the limit a refusal names is always smaller than the one refused", () => {
  expect(fittingLimit({ hint: "a limit of 23 should fit" }, 40)).toBe(23);
  expect(fittingLimit({ hint: "a limit of 60 should fit" }, 40)).toBe(39);
  expect(fittingLimit({ hint: "" }, 40)).toBe(20);
  expect(fittingLimit({}, 1)).toBe(1);
});
