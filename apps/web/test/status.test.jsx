import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { Status } from "../src/views/Status.jsx";
import { Fleet } from "../src/views/Collectors.jsx";
import { CollectorPage } from "../src/views/CollectorDetail.jsx";

const PAYLOAD = {
  as_of: "2026-09-06T15:00:00.000Z",
  health: {
    ok: true,
    last_fetch_seconds: 12,
    last_admission_seconds: 30,
    dlq_messages: 0,
    battles_last_hour: 5861,
    capture_audit_24h: { polls: 50, gaps: 0 },
  },
  jobs: null,
  queue: {
    due_now: 9,
    due_starved: 1,
    due_by_endpoint: { player_battlelog: 6, clan: 3 },
    queued: 2,
    leased: 1,
    done_hour: 80,
    last_tick_at: "2026-09-06T14:57:36.000Z",
    next_tick_at: "2026-09-06T15:02:36.000Z",
    tick_minutes: 5,
    next_tick_capacity: 270,
  },
  collectors: [
    {
      name: "Ram Rider",
      card_icon: null,
      status: "active",
      // Heartbeating seconds ago, but no ADMITTED payload for 20 minutes:
      // idle, not broken, and the page has to be able to say so.
      last_heartbeat_at: "2026-09-06T14:59:57.000Z",
      last_success_at: "2026-09-06T14:40:00.000Z",
      operator: "Thingelstad",
      operator_tag: "#20JJJ2CCRU",
      fetches_1h: 161,
    },
    {
      name: "Wall Breakers",
      card_icon: null,
      status: "active",
      last_heartbeat_at: "2026-09-06T14:59:55.000Z",
      last_success_at: "2026-09-06T14:59:00.000Z",
      // No owner, or an owner who claimed no player: no credit to give.
      operator: null,
      operator_tag: null,
      fetches_1h: 137,
    },
  ],
  capture_series: ["Ram Rider", "Wall Breakers"],
  capture_5m: [
    { bucket: "14:50", fetches: 0, admitted: 0, rejected: 0, by: {} },
    {
      bucket: "14:55",
      fetches: 30,
      admitted: 28,
      rejected: 2,
      by: { "Ram Rider": 18, "Wall Breakers": 12 },
    },
    // The bucket in progress: the server gap-fills up to now.
    { bucket: "15:00", fetches: 0, admitted: 0, rejected: 0, by: {} },
  ],
  capture_24h: [
    {
      bucket: "13:00",
      fetches: 210,
      admitted: 210,
      rejected: 0,
      by: { "Ram Rider": 130, "Wall Breakers": 80 },
    },
    { bucket: "14:00", fetches: 0, admitted: 0, rejected: 0, by: {} },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => PAYLOAD,
      text: async () => JSON.stringify(PAYLOAD),
    })),
  );
  // Freeze the clock so relative ages are assertable.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-06T15:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

const paint = async () => {
  render(<Status navigate={() => {}} />);
  await waitFor(() => expect(screen.getByText("Work waiting")).toBeTruthy());
};

/** The fleet and one collector moved off Status with the 2026-09-09 IA:
 *  a page is the information plus a click to drill in. Both read the
 *  same public payload, plus /api/me/gateways for what is yours. */
const paintFleet = async (mine = []) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      const body = String(path).includes("me/gateways")
        ? { gateways: mine }
        : PAYLOAD;
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
  render(<Fleet navigate={() => {}} />);
  await waitFor(() => expect(screen.getByText("Ram Rider")).toBeTruthy());
};

test("a collector record shows heartbeat AND data, so idle never reads as broken", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      const body = String(path).includes("me/gateways")
        ? { gateways: [] }
        : PAYLOAD;
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
  render(<CollectorPage id="Ram%20Rider" navigate={() => {}} />);
  const clocks = await waitFor(() =>
    screen.getByText("Two clocks").closest(".panel"),
  );
  // Same collector, two very different truths, both on screen — and the
  // page says which reading this combination is.
  expect(within(clocks).getByText("heartbeat")).toBeTruthy();
  expect(within(clocks).getByText("3s ago")).toBeTruthy();
  expect(within(clocks).getByText("data freshness")).toBeTruthy();
  expect(within(clocks).getByText("20m ago")).toBeTruthy();
  expect(within(clocks).getByText(/idle, not broken/)).toBeTruthy();
});

test("the fleet credits the player who runs a collector, and never the account", async () => {
  await paintFleet();
  const row = screen.getByText("Ram Rider").closest("tr");
  expect(within(row).getByText("Thingelstad")).toBeTruthy();
  // The operator is credited by their game identity; an address never
  // appears on a surface everyone can read.
  expect(document.querySelector("table").textContent).not.toMatch(/@/);
  const uncredited = screen.getByText("Wall Breakers").closest("tr");
  // Two dashes since 2026-09-11: no operator credit, and no yield yet.
  expect(within(uncredited).getAllByText("—").length).toBeGreaterThan(0);
});

test("the fleet marks what is yours in a word, never a tinted row", async () => {
  await paintFleet([
    {
      gateway_id: "g1",
      name: "jamie-mac",
      card_name: "Ram Rider",
      status: "active",
    },
  ]);
  const row = screen.getByText("Ram Rider").closest("tr");
  expect(within(row).getByText("yours")).toBeTruthy();
  expect(row.style.background).toBe("");
  // And a reader who runs one is not told to raise their hand.
  expect(screen.queryByText(/You don.t run one yet/)).toBeNull();
});

test("a reader who runs no collector is told what one is and what it earns", async () => {
  await paintFleet([]);
  expect(screen.getByText(/You don.t run one yet/)).toBeTruthy();
  expect(screen.getByText(/10 fetches buys one extra daily call/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Raise my hand/ })).toBeTruthy();
});

test("the retired SQS queue panel is gone", async () => {
  await paint();
  expect(screen.queryByText("Queues")).toBeNull();
  for (const label of ["live requests", "bulk requests", "results DLQ"]) {
    expect(screen.queryByText(label)).toBeNull();
  }
});

test("both capture windows render, stacked by collector", async () => {
  await paint();
  expect(screen.getByText("Capture, last hour")).toBeTruthy();
  expect(screen.getByText("Capture, last 24 hours")).toBeTruthy();
  // One <path>/<rect> segment per collector that actually fetched.
  const segs = document.querySelectorAll(".chart .seg");
  // 5m: 2 segments in the one non-empty bucket. 24h: 2 in its non-empty one.
  expect(segs.length).toBe(4);
  // A legend entry per collector on each chart. The roster row that used
  // to make this three moved to the fleet page.
  expect(screen.getAllByText("Ram Rider").length).toBe(2);
});

test("hovering a bucket breaks it down by collector", async () => {
  await paint();
  const hits = document.querySelectorAll(".chart .hit");
  // Second bucket of the 5-minute chart: 18 + 12, two of them rejected.
  fireEvent.mouseEnter(hits[1]);
  await waitFor(() => expect(screen.getByText(/14:55Z/)).toBeTruthy());
  const tip = document.querySelector(".charttip");
  expect(within(tip).getByText("Ram Rider")).toBeTruthy();
  expect(within(tip).getByText("18")).toBeTruthy();
  expect(within(tip).getByText("Wall Breakers")).toBeTruthy();
  expect(within(tip).getByText("12")).toBeTruthy();
  expect(within(tip).getByText(/2 rejected of 30/)).toBeTruthy();
  fireEvent.mouseLeave(hits[1]);
  await waitFor(() => expect(document.querySelector(".charttip")).toBeNull());
});

test("an empty bucket says so instead of rendering a phantom bar", async () => {
  await paint();
  const hits = document.querySelectorAll(".chart .hit");
  fireEvent.mouseEnter(hits[0]);
  await waitFor(() => expect(screen.getByText("nothing fetched")).toBeTruthy());
});

test("keyboard focus opens the same breakdown as hover", async () => {
  await paint();
  const hits = document.querySelectorAll(".chart .hit");
  fireEvent.focus(hits[1]);
  await waitFor(() => expect(document.querySelector(".charttip")).toBeTruthy());
});

test("the bucket in progress is labelled, not shown as nothing fetched", async () => {
  await paint();
  const hits = document.querySelectorAll(".chart .hit");
  // Third bucket of the 5-minute chart is the one being filled right now.
  fireEvent.mouseEnter(hits[2]);
  await waitFor(() => expect(screen.getByText(/15:00Z/)).toBeTruthy());
  const tip = document.querySelector(".charttip");
  expect(within(tip).getByText("bucket in progress")).toBeTruthy();
  expect(within(tip).queryByText("nothing fetched")).toBeNull();
  // 5-minute chart: empty in-progress bucket gets the outline. 24h chart:
  // its in-progress bucket (14:00) is empty too.
  expect(document.querySelectorAll(".chart .pending").length).toBe(2);
});

test("each capture panel states its total so a short last bar cannot read as zero", async () => {
  await paint();
  expect(screen.getByText(/30 fetches, last bucket in progress/)).toBeTruthy();
  expect(
    screen.getByText(/210 fetches, current hour in progress/),
  ).toBeTruthy();
});

test("work waiting is the pipeline in order: due, queued, leased, done", async () => {
  await paint();
  const panel = screen.getByText("Work waiting").closest(".panel");
  // Four stages of one journey, so four cells rather than four
  // fractions of a bar that does not have a whole.
  for (const [label, value] of [
    ["due now", "9"],
    ["queued", "2"],
    ["being fetched", "1"],
    ["done this hour", "80"],
  ]) {
    const cell = within(panel).getByText(label).closest(".stats__cell");
    expect(within(cell).getByText(value)).toBeTruthy();
  }
  expect(within(panel).getByText(/player_battlelog 6 · clan 3/)).toBeTruthy();
  expect(within(panel).getByText(/next tick can plan 270/)).toBeTruthy();
});
