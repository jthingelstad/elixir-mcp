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
const CARDS = [
  {
    name: "Knight",
    icon: "https://cdn/knight.png",
    rarity: "common",
    elixir_cost: 3,
    taken: false,
  },
  {
    name: "Ram Rider",
    icon: "https://cdn/ram.png",
    rarity: "legendary",
    elixir_cost: 5,
    taken: true,
  },
  {
    name: "Golem",
    icon: "https://cdn/golem.png",
    rarity: "epic",
    elixir_cost: 8,
    taken: false,
  },
];

const paintFleet = async (mine = [], cards = []) => {
  const fetchMock = vi.fn(async (path, init) => {
    const p = String(path);
    const body = p.includes("me/gateways")
      ? { gateways: mine }
      : p.includes("gateways/cards")
        ? { cards }
        : p.endsWith("/api/gateways") && init?.method === "POST"
          ? { ok: true, status: "pending", card: JSON.parse(init.body).card }
          : PAYLOAD;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<Fleet navigate={() => {}} />);
  await waitFor(() => expect(screen.getByText("Ram Rider")).toBeTruthy());
  return fetchMock;
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
  // A reader who runs one is offered another, not told they run none:
  // raising a hand is the only way a collector comes to exist, so the
  // form never hides (Jamie, 2026-09-11).
  expect(screen.queryByText(/You don.t run one yet/)).toBeNull();
  expect(screen.getByText("Run another")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Raise my hand/ })).toBeTruthy();
});

test("a reader who runs no collector is told what one is and what it earns", async () => {
  await paintFleet([]);
  expect(screen.getByText(/You don.t run one yet/)).toBeTruthy();
  expect(screen.getByText(/10 fetches buys one extra daily call/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Raise my hand/ })).toBeTruthy();
});

test("an operator picks the card their collector wears, and a taken card cannot be picked", async () => {
  const fetchMock = await paintFleet([], CARDS);
  const grid = screen.getByRole("listbox", { name: "cards" });
  const raise = screen.getByRole("button", { name: /Raise my hand/ });
  fireEvent.change(screen.getByPlaceholderText("a name for the machine"), {
    target: { value: "attic-mini" },
  });
  // A name alone is not enough: the card is the collector's public face.
  expect(raise.disabled).toBe(true);

  // Ram Rider is somebody's already: shown so you can see it went,
  // dimmed, and a click does nothing.
  const ram = within(grid).getByRole("option", { name: "Ram Rider" });
  expect(ram.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(ram);
  expect(raise.disabled).toBe(true);
  expect(screen.getByText(/Pick a card/)).toBeTruthy();

  // The search narrows the grid; a free pick names the collector.
  fireEvent.change(screen.getByLabelText("find a card"), {
    target: { value: "gol" },
  });
  expect(within(grid).queryByRole("option", { name: "Knight" })).toBeNull();
  fireEvent.click(within(grid).getByRole("option", { name: "Golem" }));
  expect(screen.getByText(/Your collector will be/).textContent).toMatch(
    /Golem · epic · 8 elixir/,
  );
  expect(raise.disabled).toBe(false);

  fireEvent.click(raise);
  await waitFor(() => expect(screen.getByText(/Raised as Golem/)).toBeTruthy());
  const post = fetchMock.mock.calls.find(
    ([p, init]) =>
      String(p).endsWith("/api/gateways") && init?.method === "POST",
  );
  expect(JSON.parse(post[1].body)).toEqual({
    name: "attic-mini",
    card: "Golem",
  });
});

test("an operator can re-pick their own collector's card, and the record follows it", async () => {
  const navigate = vi.fn();
  const fetchMock = vi.fn(async (path, init) => {
    const p = String(path);
    const body = p.includes("me/gateways")
      ? {
          gateways: [
            {
              gateway_id: "g1",
              name: "jamie-mac",
              card_name: "Ram Rider",
              card_icon: "https://cdn/ram.png",
              status: "active",
            },
          ],
        }
      : p.includes("gateways/cards")
        ? { cards: CARDS }
        : p.includes("me/gateway-card")
          ? { ok: true, card: JSON.parse(init.body).card }
          : p.includes("gateway-detail")
            ? { gateway: {}, daily: [], endpoints_7d: [] }
            : PAYLOAD;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<CollectorPage id="Ram%20Rider" navigate={navigate} />);
  const panel = await waitFor(() =>
    screen.getByText("Your card").closest(".panel"),
  );
  expect(within(panel).getByText("Ram Rider")).toBeTruthy();
  fireEvent.click(within(panel).getByRole("button", { name: "Change" }));
  const grid = await waitFor(() =>
    within(panel).getByRole("listbox", { name: "cards" }),
  );
  // Your own card is yours, not "taken" from you; the button waits for
  // a DIFFERENT pick.
  expect(
    within(grid)
      .getByRole("option", { name: "Ram Rider" })
      .getAttribute("aria-disabled"),
  ).toBe("false");
  expect(within(panel).getByRole("button", { name: /Make it/ }).disabled).toBe(
    true,
  );
  fireEvent.click(within(grid).getByRole("option", { name: "Knight" }));
  fireEvent.click(
    within(panel).getByRole("button", { name: "Make it Knight" }),
  );
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("/status/collectors/Knight"),
  );
  const post = fetchMock.mock.calls.find(([p]) =>
    String(p).includes("me/gateway-card"),
  );
  expect(JSON.parse(post[1].body)).toEqual({ id: "g1", card: "Knight" });
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
