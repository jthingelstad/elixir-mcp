import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { Admin } from "../src/views/Admin.jsx";

const GATEWAYS = [
  {
    gateway_id: "g1",
    name: "jamie-mac",
    card_name: "Ram Rider",
    card_icon: null,
    status: "active",
    channel: "live",
    owner_account_id: "acct-1",
    owner_is_me: true,
    owner_email_hash: "abcdef0123456789",
    owner_player_name: "Thingelstad",
    owner_player_tag: "#20JJJ2CCRU",
    enrolled_at: "2026-09-01T00:00:00.000Z",
    last_heartbeat_at: "2026-09-06T15:29:57.000Z",
    last_success_at: "2026-09-06T15:28:00.000Z",
    fetch_points: 4639,
    last_seen_sha: "v0.1.16",
    fetches_last_hour: 252,
    provision_ready: false,
  },
  {
    gateway_id: "g2",
    name: "magic-pines",
    card_name: "Wall Breakers",
    card_icon: null,
    status: "active",
    channel: "bulk",
    owner_account_id: null, // never provisioned to an account
    owner_is_me: false,
    owner_email_hash: null,
    owner_player_name: null,
    owner_player_tag: null,
    enrolled_at: "2026-09-06T14:00:00.000Z",
    last_heartbeat_at: "2026-09-06T15:29:52.000Z",
    last_success_at: "2026-09-06T15:20:00.000Z",
    fetch_points: 2,
    last_seen_sha: "v0.1.16",
    fetches_last_hour: 202,
    provision_ready: false,
  },
];

// Admin renders every panel at once; each needs its own shape or the
// component throws before the gateways table is reached.
const EMPTY = {
  requests: [],
  accounts: [],
  tools: [],
  totals: {},
  feedback: [],
  tokens: [],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => ({
      ok: true,
      status: 200,
      json: async () =>
        path.includes("gateways") ? { gateways: GATEWAYS } : EMPTY,
    })),
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-06T15:30:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

const paint = async () => {
  render(<Admin me={{ is_admin: true }} page="gateways" />);
  await waitFor(() => expect(screen.getByText("Ram Rider")).toBeTruthy());
};

test("a collector is identified by card name AND machine name", async () => {
  await paint();
  const row = screen.getByText("Ram Rider").closest("tr");
  // The card is the identity every other surface uses; the machine name
  // is what you SSH into. Admin is where they have to meet.
  expect(within(row).getByText("Ram Rider")).toBeTruthy();
  expect(within(row).getByText("jamie-mac")).toBeTruthy();
});

test("the operator is named, with the hash as the stable identifier", async () => {
  await paint();
  const row = screen.getByText("Ram Rider").closest("tr");
  expect(within(row).getByText("Thingelstad")).toBeTruthy();
  expect(within(row).getByText("abcdef0123")).toBeTruthy();
  expect(within(row).getByText("you")).toBeTruthy();
});

test("an unowned collector says so rather than rendering a blank cell", async () => {
  await paint();
  const row = screen.getByText("Wall Breakers").closest("tr");
  expect(within(row).getByText("unowned")).toBeTruthy();
  expect(within(row).getByText("magic-pines")).toBeTruthy();
});

test("heartbeat and data are both shown, on the relative clock", async () => {
  await paint();
  const row = screen.getByText("Ram Rider").closest("tr");
  expect(within(row).getByText("3s ago")).toBeTruthy();
  expect(within(row).getByText("2m ago")).toBeTruthy();
});

test("every row has a cell for every header", async () => {
  await paint();
  const table = screen.getByText("Ram Rider").closest("table");
  const headers = table.querySelectorAll("thead th").length;
  for (const row of table.querySelectorAll("tbody tr")) {
    expect(row.querySelectorAll("td").length).toBe(headers);
  }
});
