import { describe, expect, test, vi } from "vitest";
import {
  RESULT_SHOWN_S,
  refreshLabel,
  refreshLines,
} from "../src/home/RefreshPlayer.jsx";
import {
  ASK_SPACING_MS,
  LANDED_KEYS,
  MAX_POLLS,
  PLAYER_LANDED_KEYS,
  SLOW_POLLS,
  SLOW_WAIT_MS,
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

  test("checking, then a result for two minutes, then the button again", async () => {
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
    expect(refreshLabel(s, 5_000)).toBe("Check again");
    expect(refreshLabel(s, 5_000 + (RESULT_SHOWN_S + 1) * 1000)).toBe(
      "Check for new battles",
    );
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

/* A player page's button (2026-11-23): the tap also reads the profile, and
 * the lines under the button say what the check found. */

const SINCE = "marker";

function button({ ask, statuses = [], hidden = () => false, t = 1_000_000 }) {
  const waits = [];
  const invalidated = [];
  const sinces = [];
  const status = vi.fn(async (since) => {
    sinces.push(since);
    return statuses.shift() ?? ok({ players: [] });
  });
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
    now: () => t,
    spacingMs: 0,
    landedKeys: PLAYER_LANDED_KEYS,
    button: true,
    tag: TAG,
  });
  return { r, waits, invalidated, sinces, status };
}

const queuedTap = async () =>
  ok({
    queued: true,
    since: SINCE,
    players: [
      { tag: TAG, state: "queued", retry_after_s: 15, profile: "queued" },
    ],
  });
const found = {
  tag: TAG,
  pending: false,
  profile_pending: false,
  new_battles: 3,
  newest_battle_at: "2026-11-21T02:42:00Z",
  latest_is_new: true,
  profile_changes: [
    { field: "trophies", from: 12560, to: 12593 },
    { field: "clan", from: null, to: { tag: "#0C2C8", name: "Test Clan" } },
  ],
};
const when = (ts) => `at ${ts.slice(11, 16)}`;

describe("a player page's button", () => {
  test("waits for the profile too, sends the marker, and keeps what it found", async () => {
    const { r, sinces, invalidated } = button({
      ask: queuedTap,
      statuses: [
        ok({
          players: [{ tag: TAG, pending: false, profile_pending: true }],
        }),
        ok({ players: [found] }),
      ],
    });
    await r.ask({ asked: true });
    expect(sinces).toEqual([SINCE, SINCE]);
    expect(invalidated).toEqual(PLAYER_LANDED_KEYS);
    const s = r.snapshot();
    expect(s.outcome).toBe("updated");
    expect(s.result).toEqual(found);
    expect(refreshLines(s, 1_000_000, { when })).toEqual([
      "3 new battles. Last battle at 02:42.",
      "Trophies 12,560 → 12,593 · Joined Test Clan",
    ]);
  });

  test("the words while checking, yours and theirs", () => {
    const checking = { checking: true };
    expect(refreshLines(checking, 0, { when })).toEqual([
      "Asking Clash Royale for their latest battles and profile. This takes a few seconds.",
    ]);
    expect(refreshLines(checking, 0, { when, own: true })).toEqual([
      "Asking Clash Royale for your latest battles and profile. This takes a few seconds.",
    ]);
    expect(refreshLabel(checking, 0)).toBe("Checking…");
  });

  test("what a check found, in every shape", () => {
    const at = 1_000;
    const lines = (result, own = false) =>
      refreshLines({ outcome: "updated", at, result }, at, { when, own });
    const last = "2026-11-21T02:42:00Z";
    expect(
      lines({ new_battles: 1, newest_battle_at: last, latest_is_new: true }),
    ).toEqual(["1 new battle. Last battle at 02:42."]);
    expect(
      lines({ new_battles: 2, newest_battle_at: last, latest_is_new: false }),
    ).toEqual(["Found 2 older battles. Last battle at 02:42."]);
    expect(
      lines({ new_battles: 0, newest_battle_at: last, latest_is_new: false }),
    ).toEqual(["No new battles. Last battle at 02:42."]);
    expect(lines({ new_battles: 0, newest_battle_at: null })).toEqual([
      "Elixir has no battles for them yet.",
    ]);
    expect(lines({ new_battles: 0, newest_battle_at: null }, true)).toEqual([
      "Elixir has no battles for you yet.",
    ]);
    expect(lines(null)).toEqual(["Up to date."]);
    expect(
      lines({
        new_battles: 0,
        newest_battle_at: last,
        latest_is_new: false,
        profile_changes: [
          { field: "name", from: "Pip", to: "Pip Two" },
          {
            field: "clan",
            from: { tag: "#0C2C8", name: "Old Clan" },
            to: { tag: "#0PLUG2V9", name: "New Clan" },
          },
          { field: "trophies", from: 9800, to: 10050 },
          { field: "best_trophies", from: 10000, to: 10050 },
          { field: "arena", from: "Arena One", to: "Arena Two" },
          { field: "league", from: "Master II", to: "Master III" },
          { field: "something_else", from: 1, to: 2 },
        ],
      })[1],
    ).toBe(
      "Now named Pip Two · Left Old Clan, joined New Clan · Trophies 9,800 → 10,050 · New best 10,050 · Arena One → Arena Two · League Master II → Master III",
    );
    expect(
      lines({
        new_battles: 0,
        newest_battle_at: last,
        profile_changes: [
          {
            field: "clan",
            from: { tag: "#0C2C8", name: "Old Clan" },
            to: null,
          },
        ],
      })[1],
    ).toBe("Left Old Clan");
    // Two minutes on, the lines go and the button is itself again.
    const later = at + (RESULT_SHOWN_S + 1) * 1000;
    const s = { outcome: "updated", at, result: found };
    expect(refreshLines(s, later, { when })).toEqual([]);
    expect(refreshLabel(s, later)).toBe("Check for new battles");
  });

  test("slow: says so, keeps reading slower while shown, then lands", async () => {
    const pending = ok({ players: [{ tag: TAG, pending: true }] });
    const seen = [];
    const { r, waits, invalidated, status } = button({
      ask: queuedTap,
      statuses: [
        ...Array.from({ length: MAX_POLLS }, () => pending),
        pending,
        ok({ players: [found] }),
      ],
    });
    r.subscribe(() => seen.push(r.snapshot().outcome));
    await r.ask({ asked: true });
    expect(r.snapshot().outcome).toBe("slow");
    expect(refreshLabel(r.snapshot(), 1_000_000)).toBe("Checking…");
    expect(refreshLines(r.snapshot(), 1_000_000, { when })).toEqual([
      "Still checking. New battles show up here shortly.",
    ]);
    await vi.waitFor(() => expect(r.snapshot().outcome).toBe("updated"));
    expect(waits.slice(MAX_POLLS)).toEqual([SLOW_WAIT_MS, SLOW_WAIT_MS]);
    expect(status).toHaveBeenCalledTimes(MAX_POLLS + 2);
    expect(invalidated).toEqual(PLAYER_LANDED_KEYS);
    expect(r.snapshot().result).toEqual(found);
    expect(seen.at(-1)).toBe("updated");
  });

  test("slow: never reads while hidden, and gives up after about three minutes", async () => {
    const pending = ok({ players: [{ tag: TAG, pending: true }] });
    const statuses = Array.from({ length: 40 }, () => pending);
    // The tab hides once the first few reads are done.
    const { r, waits, status, invalidated } = button({
      ask: queuedTap,
      statuses,
      hidden: () => statuses.length <= 40 - MAX_POLLS,
    });
    await r.ask({ asked: true });
    expect(r.snapshot().outcome).toBe("slow");
    await vi.waitFor(() => expect(r.snapshot().outcome).toBe("unavailable"));
    expect(status).toHaveBeenCalledTimes(MAX_POLLS);
    expect(waits.filter((ms) => ms === SLOW_WAIT_MS)).toHaveLength(SLOW_POLLS);
    expect(SLOW_POLLS * SLOW_WAIT_MS).toBe(180_000);
    expect(invalidated).toEqual([]);
    expect(refreshLines(r.snapshot(), 1_000_000, { when })).toEqual([
      "Couldn't check right now. Try again in a bit.",
    ]);
  });

  test("a newer tap ends an older one's slow reads", async () => {
    const pending = ok({ players: [{ tag: TAG, pending: true }] });
    const statuses = Array.from({ length: MAX_POLLS }, () => pending);
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const asks = [
      queuedTap,
      async () =>
        ok({
          queued: false,
          since: SINCE,
          players: [{ tag: TAG, state: "fresh", profile: "fresh" }],
        }),
    ];
    const status = vi.fn(async () => statuses.shift() ?? ok({ players: [] }));
    const r = makeOwnRefresh({
      ask: () => asks.shift()(),
      status,
      invalidate: async () => {},
      wait: (ms) => (ms === SLOW_WAIT_MS ? gate : Promise.resolve()),
      hidden: () => false,
      now: () => 1_000_000,
      spacingMs: 0,
      landedKeys: PLAYER_LANDED_KEYS,
      button: true,
      tag: TAG,
    });
    await r.ask({ asked: true });
    expect(r.snapshot().outcome).toBe("slow");
    statuses.push(ok({ players: [found] }));
    await r.ask({ asked: true });
    expect(r.snapshot().outcome).toBe("updated");
    const calls = status.mock.calls.length;
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(status).toHaveBeenCalledTimes(calls);
    expect(r.snapshot().outcome).toBe("updated");
    expect(r.snapshot().result).toEqual(found);
  });

  test("refused with no wait to name: says so, rather than nothing", async () => {
    for (const ask of [
      async () =>
        ok({
          queued: false,
          since: SINCE,
          players: [{ tag: TAG, state: "skipped", profile: "skipped" }],
        }),
      async () => ({ ok: false, status: 500, data: null }),
      async () => {
        throw new Error("offline");
      },
    ]) {
      const { r } = button({ ask });
      await r.ask({ asked: true });
      const s = r.snapshot();
      expect(s.outcome).toBe("unavailable");
      expect(refreshLabel(s, 1_000_000)).toBe("Check again");
      expect(refreshLines(s, 1_000_000, { when })).toEqual([
        "Couldn't check right now. Try again in a bit.",
      ]);
    }
  });

  test("a limit still names its wait, with no line", async () => {
    const { r } = button({
      ask: async () =>
        ok({
          queued: false,
          since: SINCE,
          players: [
            {
              tag: TAG,
              state: "skipped",
              retry_after_s: 100,
              profile: "skipped",
            },
          ],
        }),
    });
    await r.ask({ asked: true });
    const s = r.snapshot();
    expect(refreshLabel(s, 1_000_000)).toBe("Try again in 2 min");
    expect(refreshLines(s, 1_000_000, { when })).toEqual([]);
  });

  test("read in the last two minutes: one follow-up read says what it found", async () => {
    const { r, sinces } = button({
      ask: async () =>
        ok({
          queued: false,
          since: SINCE,
          players: [{ tag: TAG, state: "fresh", profile: "fresh" }],
        }),
      statuses: [
        ok({
          players: [{ ...found, new_battles: 0, profile_changes: [] }],
          feed_current: true,
        }),
      ],
    });
    await r.ask({ asked: true });
    expect(sinces).toEqual([SINCE]);
    expect(refreshLines(r.snapshot(), 1_000_000, { when })).toEqual([
      "No new battles. Last battle at 02:42.",
    ]);
  });

  test("the log fresh, the profile on its way: waits for the profile", async () => {
    const { r, waits } = button({
      ask: async () =>
        ok({
          queued: false,
          since: SINCE,
          players: [{ tag: TAG, state: "fresh", profile: "queued" }],
        }),
      statuses: [ok({ players: [found] })],
    });
    await r.ask({ asked: true });
    expect(waits).toEqual([15_000]);
    expect(r.snapshot().result).toEqual(found);
  });

  test("the app's own refresher never says unavailable or slow", async () => {
    const pending = ok({ players: [{ tag: TAG, pending: true }] });
    const { r } = harness({
      ask: async () =>
        ok({
          queued: true,
          players: [{ tag: TAG, state: "queued", retry_after_s: 5 }],
        }),
      statuses: Array.from({ length: MAX_POLLS }, () => pending),
    });
    await r.ask();
    expect(r.snapshot().outcome).toBe(null);
    const refused = harness({
      ask: async () => ok({ queued: false, players: [] }),
    });
    await refused.r.ask();
    expect(refused.r.snapshot().outcome).toBe(null);
  });
});
