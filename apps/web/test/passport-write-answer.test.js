/**
 * A passport write's answer (Home's Not now and Hide, #1015) goes into the
 * cached passport read in place, after any read already on its way.
 */
import { describe, expect, test, vi } from "vitest";
import { asPassportRead, putPassport } from "../src/lib/passport.js";

const answer = (more, granted = []) => ({
  ok: true,
  status: 200,
  data: { owner: { profile: { version: 2 } }, granted, more },
});

describe("A passport write's answer", () => {
  test("cancels the read on its way, then replaces it", async () => {
    const order = [];
    const qc = {
      cancelQueries: vi.fn(async (q) => order.push(["cancel", q])),
      setQueryData: vi.fn((key, env) => order.push(["set", key, env.data])),
    };
    await putPassport(qc, answer(false, [{}]));
    expect(order).toEqual([
      ["cancel", { queryKey: ["me", "passport"], exact: true }],
      ["set", ["me", "passport"], { owner: { profile: { version: 2 } } }],
    ]);
  });
  test("becomes the read's envelope", () => {
    expect(asPassportRead(answer(true, [{}])).data).toEqual({
      owner: { profile: { version: 2 } },
    });
  });
});
