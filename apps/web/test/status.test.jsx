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
  collectors: [
    {
      name: "Ram Rider",
      card_icon: null,
      status: "active",
      // Heartbeating seconds ago, but no ADMITTED payload for 20 minutes:
      // idle, not broken, and the page has to be able to say so.
      last_heartbeat_at: "2026-09-06T14:59:57.000Z",
      last_success_at: "2026-09-06T14:40:00.000Z",
      fetches_1h: 161,
    },
    {
      name: "Wall Breakers",
      card_icon: null,
      status: "active",
      last_heartbeat_at: "2026-09-06T14:59:55.000Z",
      last_success_at: "2026-09-06T14:59:00.000Z",
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
    vi.fn(async () => ({ ok: true, status: 200, json: async () => PAYLOAD })),
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
