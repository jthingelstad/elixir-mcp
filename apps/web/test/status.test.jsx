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
  render(<Status />);
  await waitFor(() => expect(screen.getByText("Collectors")).toBeTruthy());
};

test("collectors show heartbeat AND data, so idle never reads as broken", async () => {
  await paint();
  // The name also appears in each chart legend, so scope to the panel.
  const panel = screen.getByText("Collectors").closest(".panel");
  const row = within(panel).getByText("Ram Rider").closest("div");
  // Same collector, two very different truths, both on screen.
  expect(within(row).getByText(/heartbeat/)).toBeTruthy();
  expect(within(row).getByText("3s ago")).toBeTruthy();
  expect(within(row).getByText(/^data$/)).toBeTruthy();
  expect(within(row).getByText("20m ago")).toBeTruthy();
});

test("a collector credits the player who runs it, and stays quiet when there is none", async () => {
  await paint();
  const panel = screen.getByText("Collectors").closest(".panel");
  const credited = within(panel).getByText("Ram Rider").closest("div");
  expect(within(credited).getByText(/run by/)).toBeTruthy();
  expect(within(credited).getByText("Thingelstad")).toBeTruthy();
  // The account is never named on a public page, only the game identity.
  expect(panel.textContent).not.toMatch(/@|email/i);
  const uncredited = within(panel).getByText("Wall Breakers").closest("div");
  expect(within(uncredited).queryByText(/run by/)).toBeNull();
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
  // A legend entry per collector, on each chart, beside the roster row.
  expect(screen.getAllByText("Ram Rider").length).toBe(3);
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

test("work waiting is its own gauge: due, queued, leased, done", async () => {
  await paint();
  expect(screen.getByText("Work waiting")).toBeTruthy();
  expect(screen.getByText(/12 waiting/)).toBeTruthy();
  expect(
    screen.getByText(
      /9 due for the next tick · 2 queued for a collector · 1 being fetched · 80 done this hour/,
    ),
  ).toBeTruthy();
  expect(screen.getByText(/next tick can plan 270/)).toBeTruthy();
  expect(screen.getByText(/player_battlelog 6 · clan 3/)).toBeTruthy();
});
