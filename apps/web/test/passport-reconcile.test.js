/**
 * Home's catch-up on open (#1015): repeats while `more`, bounded, quiet on
 * failure, at most once a minute.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MAX_CALLS,
  MIN_GAP_MS,
  asPassportRead,
  putPassport,
  reconcileOnce,
  reconcileUntilDone,
  resetReconcile,
} from "../src/lib/passport-reconcile.js";
import { api } from "../src/api.js";

const answer = (more, granted = []) => ({
  ok: true,
  status: 200,
  data: { owner: { profile: { version: 2 } }, granted, more },
});

afterEach(() => {
  resetReconcile();
  vi.restoreAllMocks();
});

describe("The passport's catch-up", () => {
  test("repeats while more, handing on each answer", async () => {
    const replies = [answer(true, [{}]), answer(true), answer(false, [{}])];
    const call = vi.fn(async () => replies.shift());
    const seen = [];
    const granted = await reconcileUntilDone(call, (e) => seen.push(e));
    expect(call).toHaveBeenCalledTimes(3);
    expect(granted).toBe(2);
    expect(seen).toHaveLength(3);
    expect(seen[0].data.more).toBe(true);
  });
  test(`stops at ${MAX_CALLS} calls however long more holds`, async () => {
    const call = vi.fn(async () => answer(true));
    await reconcileUntilDone(call, () => {});
    expect(call).toHaveBeenCalledTimes(MAX_CALLS);
  });
  test("quiet on failure: a refusal or a throw changes nothing", async () => {
    const onAnswer = vi.fn();
    expect(
      await reconcileUntilDone(
        async () => ({ ok: false, status: 429, data: {} }),
        onAnswer,
      ),
    ).toBe(0);
    expect(
      await reconcileUntilDone(async () => {
        throw new Error("offline");
      }, onAnswer),
    ).toBe(0);
    expect(onAnswer).not.toHaveBeenCalled();
  });
  test("at most once a minute; a pass that granted refreshes the bell", async () => {
    const spy = vi
      .spyOn(api, "reconcilePassport")
      .mockImplementation(async () => answer(false, [{}]));
    const qc = {
      cancelQueries: vi.fn(async () => {}),
      setQueryData: vi.fn(),
      invalidateQueries: vi.fn(async () => {}),
    };
    await reconcileOnce(qc, 1_000_000);
    await reconcileOnce(qc, 1_000_000 + MIN_GAP_MS - 1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(qc.setQueryData).toHaveBeenCalledWith(
      ["me", "passport"],
      expect.objectContaining({ ok: true }),
    );
    expect(qc.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["me", "bell"],
    });
    await reconcileOnce(qc, 1_000_000 + MIN_GAP_MS);
    expect(spy).toHaveBeenCalledTimes(2);
  });
  test("a write's answer cancels the read on its way, then replaces it", async () => {
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
  test("a write's answer becomes the read's envelope", () => {
    expect(asPassportRead(answer(true, [{}])).data).toEqual({
      owner: { profile: { version: 2 } },
    });
  });
});
