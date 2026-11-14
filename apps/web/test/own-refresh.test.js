import { describe, expect, test, vi } from "vitest";
import { refreshLabel } from "../src/home/RefreshPlayer.jsx";
import {
  ASK_SPACING_MS,
  LANDED_KEYS,
  MAX_POLLS,
  hasOwnVerified,
  makeOwnRefresh,
} from "../src/lib/own-refresh.js";

/** Your own battles read now: the client half (lib/own-refresh.js). The
 *  server's limits are pinned in services/web-api/test/own-refresh.test.mjs;
 *  here, how the page waits, polls and refreshes. Invented tags only. */

const TAG = "#0GRJCUV";
const ok = (data) => ({ ok: true, status: 200, data });

function harness({ ask, statuses = [], hidden = () => false, now }) {
  const waits = [];
  const invalidated = [];
  const status = vi.fn(async () => statuses.shift() ?? ok({ players: [] }));
  let t = 0;
  const r = makeOwnRefresh({
    ask: vi.fn(ask),
    status,
    invalidate: async (key) => {
      invalidated.push(key);
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    hidden,
    now: now ?? (() => (t += ASK_SPACING_MS)),
  });
  return { r, waits, invalidated, status };
}

describe("makeOwnRefresh", () => {
  test("a queued read: polls at the lane's retry_after_s, then refreshes the pages", async () => {
    const seen = [];
    const { r, waits, invalidated, status } = harness({
      ask: async () =>
        ok({
          queued: true,
          players: [{ tag: TAG, state: "queued", retry_after_s: 15 }],
        }),
      statuses: [
        ok({ players: [{ tag: TAG, pending: true }] }),
        ok({ players: [{ tag: TAG, pending: false }], feed_current: true }),
      ],
    });
    r.subscribe(() => seen.push(r.snapshot().checking));
    await r.ask();
    expect(waits).toEqual([15_000, 15_000]);
    expect(status).toHaveBeenCalledTimes(2);
    expect(invalidated).toEqual(LANDED_KEYS);
    expect(seen).toEqual([true, false]);
  });

  test("landed before Home's week has it: one short wait for the week", async () => {
    const { r, waits, invalidated } = harness({
      ask: async () =>
        ok({
          queued: true,
          players: [{ tag: TAG, state: "queued", retry_after_s: 15 }],
        }),
      statuses: [
        ok({ players: [{ tag: TAG, pending: false }], feed_current: false }),
        ok({ players: [{ tag: TAG, pending: false }], feed_current: true }),
      ],
    });
    await r.ask();
    expect(waits).toEqual([15_000, 5_000]);
    expect(invalidated).toEqual(LANDED_KEYS);
  });

  test("a few attempts at most, then it stops without refreshing", async () => {
    const pending = ok({ players: [{ tag: TAG, pending: true }] });
    const { r, status, invalidated } = harness({
      ask: async () =>
        ok({
          queued: true,
          players: [{ tag: TAG, state: "queued", retry_after_s: 15 }],
        }),
      statuses: Array.from({ length: 10 }, () => pending),
    });
    await r.ask();
    expect(status).toHaveBeenCalledTimes(MAX_POLLS);
    expect(invalidated).toEqual([]);
    expect(r.snapshot().checking).toBe(false);
  });

  test("hidden: no more polling", async () => {
    const { r, status, invalidated } = harness({
      ask: async () =>
        ok({
          queued: true,
          players: [{ tag: TAG, state: "queued", retry_after_s: 15 }],
        }),
      hidden: () => true,
    });
    await r.ask();
    expect(status).not.toHaveBeenCalled();
    expect(invalidated).toEqual([]);
  });

  test("refused, missing or failing: quiet, and nothing is polled", async () => {
    for (const answer of [
      async () => ok({ queued: false, players: [] }),
      async () => ({ ok: false, status: 404, data: { error: "not_found" } }),
      async () => {
        throw new Error("offline");
      },
    ]) {
      const { r, status, invalidated } = harness({ ask: answer });
      await expect(r.ask()).resolves.toBeUndefined();
      expect(status).not.toHaveBeenCalled();
      expect(invalidated).toEqual([]);
      expect(r.snapshot().checking).toBe(false);
    }
  });

  test("read in the last two minutes: one follow-up read, then Home is read again", async () => {
    const { r, status, waits, invalidated } = harness({
      ask: async () =>
        ok({ queued: false, players: [{ tag: TAG, state: "fresh" }] }),
      statuses: [
        ok({ players: [{ tag: TAG, pending: false }], feed_current: true }),
      ],
    });
    await r.ask();
    expect(status).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([]);
    expect(invalidated).toEqual(LANDED_KEYS);
    expect(r.snapshot().outcome).toBe("updated");
  });

  test("read in the last two minutes, after Home's week was built: one wait for the week", async () => {
    const { r, status, waits, invalidated } = harness({
      ask: async () =>
        ok({ queued: false, players: [{ tag: TAG, state: "fresh" }] }),
      statuses: [
        ok({ players: [{ tag: TAG, pending: false }], feed_current: false }),
        ok({ players: [{ tag: TAG, pending: false }], feed_current: true }),
      ],
    });
    await r.ask();
    expect(status).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([5_000]);
    expect(invalidated).toEqual(LANDED_KEYS);
  });

  test("asks close together are one ask", async () => {
    let t = 0;
    const ask = vi.fn(async () => ok({ queued: false, players: [] }));
    const { r } = harness({ ask, now: () => t });
    await r.ask();
    t += ASK_SPACING_MS - 1;
    await r.ask();
    t += 1;
    await r.ask();
    expect(ask).toHaveBeenCalledTimes(2);
  });
});

test("only a verified player of your own is a reason to ask", () => {
  const me = (claims) => ({ authenticated: true, claims });
  expect(hasOwnVerified(null)).toBe(false);
  expect(
    hasOwnVerified(
      me([{ claim_status: "verified", is_primary: true, player_tag: TAG }]),
    ),
  ).toBe(true);
  expect(
    hasOwnVerified(
      me([
        { claim_status: "verified", relationship: "friend", player_tag: TAG },
      ]),
    ),
  ).toBe(false);
  expect(
    hasOwnVerified(
      me([{ claim_status: "unverified", is_primary: true, player_tag: TAG }]),
    ),
  ).toBe(false);
});

describe("the player page's button", () => {
  test("a limit says when to try again, and the button comes back after", async () => {
    const t = 1_000_000;
    const { r } = harness({
      ask: async () =>
        ok({
          queued: false,
          players: [{ tag: TAG, state: "skipped", retry_after_s: 100 }],
        }),
      now: () => t,
    });
    await r.ask();
    const s = r.snapshot();
    expect(s.outcome).toBe("limited");
    expect(s.retryAfterS).toBe(100);
    expect(refreshLabel(s, t)).toBe("Try again in 2 min");
    expect(refreshLabel(s, t + 50_000)).toBe("Try again in 1 min");
    expect(refreshLabel(s, t + 100_000)).toBe("Check for new battles");
  });

  test("checking, then updated just now, then the button again", async () => {
    const { r } = harness({
      ask: async () =>
        ok({
          queued: true,
          players: [{ tag: TAG, state: "queued", retry_after_s: 5 }],
        }),
      statuses: [ok({ players: [{ tag: TAG, pending: false }] })],
      now: () => 5_000,
    });
    expect(refreshLabel({ checking: true }, 0)).toBe("Checking…");
    await r.ask();
    const s = r.snapshot();
    expect(refreshLabel(s, 5_000)).toBe("Updated just now");
    expect(refreshLabel(s, 5_000 + 121_000)).toBe("Check for new battles");
    expect(refreshLabel({ checking: false, outcome: null }, 0)).toBe(
      "Check for new battles",
    );
  });

  test("no spacing of its own: every tap reaches the server", async () => {
    const ask = vi.fn(async () => ok({ queued: false, players: [] }));
    const r = makeOwnRefresh({
      ask,
      status: vi.fn(),
      invalidate: async () => {},
      wait: async () => {},
      hidden: () => false,
      now: () => 0,
      spacingMs: 0,
    });
    await r.ask();
    await r.ask();
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
