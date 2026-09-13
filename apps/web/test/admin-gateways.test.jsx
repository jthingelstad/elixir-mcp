import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  within,
  fireEvent,
} from "@testing-library/react";
import { Admin } from "../src/views/Admin.jsx";
import { CollectorPage } from "../src/views/CollectorDetail.jsx";

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
    // A completed fetch always consumes a lease and a submit. The table
    // reports extra door calls above that necessary pair, so this is perfect.
    door_calls_hour: 504,
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
    vi.fn(async (path) => {
      const body = path.includes("gateways") ? { gateways: GATEWAYS } : EMPTY;
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-06T15:30:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

const paint = async (navigate = vi.fn()) => {
  // The page slug took the product's word for it with the 2026-09-09 IA.
  render(
    <Admin me={{ is_admin: true }} page="collectors" navigate={navigate} />,
  );
  await waitFor(() => expect(screen.getByText("Ram Rider")).toBeTruthy());
};

test("the fleet list finds a collector; it does not operate on one", async () => {
  const navigate = vi.fn();
  await paint(navigate);
  // Five columns, not ten. The machine name is a hover title on the card
  // name rather than a column: the card is the identity every other
  // surface uses, and the list is for finding the row you want.
  const row = screen.getByText("Ram Rider").closest("tr");
  // Five columns became eight on 2026-09-11: yield, edge filter, calls/fetch.
  expect(row.querySelectorAll("td").length).toBe(8);
  expect(within(row).getByTitle("jamie-mac")).toBeTruthy();
  expect(within(row).getByText("Thingelstad")).toBeTruthy();
  expect(within(row).getByText("active")).toBeTruthy();
  expect(within(row).getByText("3s ago")).toBeTruthy();
  expect(within(row).getByText("1.0")).toBeTruthy();
  // No lifecycle action inline — those moved to the record.
  expect(within(row).queryByText("Drain")).toBeNull();
});

test("an unowned collector says so rather than rendering a blank cell", async () => {
  await paint();
  const row = screen.getByText("Wall Breakers").closest("tr");
  expect(within(row).getByText("unowned")).toBeTruthy();
});

test("the name opens the collector's own record — the one the status page opens", async () => {
  const navigate = vi.fn();
  await paint(navigate);
  fireEvent.click(screen.getByText("Ram Rider"));
  expect(navigate).toHaveBeenCalledWith("/status/collectors/Ram%20Rider");
});

test("every row has a cell for every header", async () => {
  await paint();
  const table = screen.getByText("Ram Rider").closest("table");
  const headers = table.querySelectorAll("thead th").length;
  for (const row of table.querySelectorAll("tbody tr")) {
    expect(row.querySelectorAll("td").length).toBe(headers);
  }
});

test("the record carries the operations an admin may run, and names what it is acting on", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      const body = path.includes("admin/gateways")
        ? { gateways: GATEWAYS }
        : path.includes("public/status")
          ? {
              collectors: [
                { name: "Ram Rider", status: "active", operator: "Jamie" },
              ],
            }
          : path.includes("me/gateways")
            ? { gateways: [] }
            : EMPTY;
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
  render(
    <CollectorPage id="Ram Rider" navigate={vi.fn()} me={{ is_admin: true }} />,
  );
  await waitFor(() => expect(screen.getByText("Operations")).toBeTruthy());
  // The machine name is here, where you are acting on it.
  expect(screen.getByText("jamie-mac")).toBeTruthy();
  // Forward-only: an active collector is offered exactly one move.
  expect(screen.getByRole("button", { name: "Drain" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
});

test("a reader who is not an admin gets the record without the operations", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path) => {
      const body = path.includes("public/status")
        ? {
            collectors: [
              { name: "Ram Rider", status: "active", operator: "Jamie" },
            ],
          }
        : { gateways: [] };
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    }),
  );
  render(<CollectorPage id="Ram Rider" navigate={vi.fn()} me={{}} />);
  await waitFor(() => expect(screen.getByText("Two clocks")).toBeTruthy());
  expect(screen.queryByText("Operations")).toBeNull();
});
