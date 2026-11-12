/**
 * Cheers on a feed item and the RSS link panel (#765). The six cheers are
 * the ruling's set (Jamie, 2026-11-12: "Yes, six cheers (Recommended)"),
 * pinned here to the database's own list; one per person per item, the
 * same one again takes it back, and the item shows counts, never who.
 * Invented players only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import {
  CHEERS,
  cheerCounts,
  cheeredBy,
  nextCheer,
  withMyCheer,
} from "../src/home/cheer-set.js";
import { Cheers } from "../src/home/Cheers.jsx";
import { RssLinkPanel } from "../src/views/account/RssLink.jsx";
import { ScopeProvider } from "../src/lib/scope.js";

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

let calls;
beforeEach(() => {
  cleanup();
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const ITEM = {
  id: "tl_0123456789abcdef0123",
  subject_tag: "#PYLQ88",
  subjects: [{ kind: "player", tag: "#QQ8822" }],
  cheers: { on_fire: 2, royal: 1 },
  my_cheer: "on_fire",
};

test("the six cheers are the database's six, in the canvas's order", () => {
  const sql = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../db/migrations/0243_cheers_and_feed_link.sql",
    ),
    "utf8",
  );
  const listed = /cheer in \(([^)]*)\)/.exec(sql)[1];
  const keys = [...listed.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect(CHEERS.map((c) => c.key)).toEqual(keys);
  expect(CHEERS.map((c) => c.label)).toEqual([
    "Well played",
    "On fire",
    "Royal",
    "Wow",
    "Ha",
    "Grind",
  ]);
});

test("counts in words never say who", () => {
  expect(cheeredBy({}, null)).toBe("");
  expect(cheeredBy({ wow: 1 }, null)).toBe("1 person");
  expect(cheeredBy({ wow: 2, ha: 1 }, null)).toBe("3 people");
  expect(cheeredBy({ wow: 1 }, "wow")).toBe("You");
  expect(cheeredBy({ wow: 1, ha: 1 }, "wow")).toBe("You and 1 other");
  expect(cheeredBy({ wow: 3 }, "wow")).toBe("You and 2 others");
  expect(cheerCounts({ grind: 1, wow: 2 }).map((c) => c.key)).toEqual([
    "wow",
    "grind",
  ]);
});

test("one cheer per person: another changes it, the same takes it back", () => {
  expect(nextCheer("wow", "wow")).toBeNull();
  expect(nextCheer("wow", "ha")).toBe("ha");
  expect(nextCheer(null, "ha")).toBe("ha");
  const changed = withMyCheer(ITEM, "royal");
  expect(changed.cheers).toEqual({ on_fire: 1, royal: 2 });
  expect(changed.my_cheer).toBe("royal");
  const gone = withMyCheer({ ...ITEM, cheers: { on_fire: 1 } }, null);
  expect(gone.cheers).toEqual({});
  expect(gone.my_cheer).toBeNull();
});

test("tapping a cheer sends it with the item's subjects and shows the server's counts", async () => {
  global.fetch = vi.fn(async (path, init = {}) => {
    calls.push({ path: String(path), method: init.method, body: init.body });
    return reply({
      item_id: ITEM.id,
      cheers: { on_fire: 1, royal: 2 },
      my_cheer: "royal",
    });
  });
  renderWithProviders(<Cheers it={ITEM} />);
  expect(
    screen
      .getByRole("button", { name: "On fire, 2, yours" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByText("You and 2 others")).toBeTruthy();

  const open = screen.getByRole("button", { name: "Cheer" });
  expect(open.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(open);
  const picker = screen.getByRole("group", { name: "Choose a cheer" });
  expect(picker.querySelectorAll("button")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: /Royal$/ }));

  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].path).toBe("/api/me/cheers");
  expect(calls[0].method).toBe("PUT");
  expect(JSON.parse(calls[0].body)).toEqual({
    item_id: ITEM.id,
    cheer: "royal",
    subjects: ["#PYLQ88", "#QQ8822"],
  });
});

test("a cheer the server refuses says so", async () => {
  global.fetch = vi.fn(async () =>
    reply({ error: "rate_limited", message: "Too many" }, 429),
  );
  renderWithProviders(<Cheers it={ITEM} />);
  fireEvent.click(screen.getByRole("button", { name: "On fire, 2, yours" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Your cheer was not saved. Try again.",
  );
});

test("on an agent's console the counts show and nothing can be pressed", () => {
  global.fetch = vi.fn(async () => reply({}));
  renderWithProviders(
    <ScopeProvider value="ag_example">
      <Cheers it={ITEM} />
    </ScopeProvider>,
  );
  expect(screen.queryAllByRole("button")).toHaveLength(0);
  expect(screen.getByRole("img", { name: "On fire, 2, yours" })).toBeTruthy();
});

test("the RSS link shows once after it is made, then only that it is on", async () => {
  let on = false;
  global.fetch = vi.fn(async (path, init = {}) => {
    calls.push({ path: String(path), method: init.method ?? "GET" });
    if (init.method === "POST") {
      on = true;
      return reply({
        on: true,
        url: "https://elixir.poapkings.com/api/rss/abcdefghijklmnopqrstuvwxyz012345.xml",
        created_at: "2026-11-12T15:00:00.000Z",
      });
    }
    return reply(
      on
        ? { on: true, created_at: "2026-11-12T15:00:00.000Z" }
        : { on: false, created_at: null },
    );
  });
  renderWithProviders(<RssLinkPanel />);
  await screen.findByText("Off: no link reads your timeline.");
  fireEvent.click(screen.getByRole("button", { name: "Make my link" }));
  await screen.findByText(/abcdefghijklmnopqrstuvwxyz012345\.xml$/);
  expect(screen.getByText(/keeps only a fingerprint/)).toBeTruthy();
  await screen.findByRole("button", { name: "Reset link" });
  expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
  expect(calls.some((c) => c.method === "POST")).toBe(true);
});

test("one cheer write at a time per item: the chips wait for the answer", async () => {
  let answer;
  global.fetch = vi.fn((path, init = {}) => {
    calls.push({ path: String(path), method: init.method, body: init.body });
    return new Promise((resolve) => {
      answer = () =>
        resolve(
          reply({ item_id: ITEM.id, cheers: { on_fire: 1 }, my_cheer: null }),
        );
    });
  });
  renderWithProviders(<Cheers it={ITEM} />);
  const mine = screen.getByRole("button", { name: "On fire, 2, yours" });
  fireEvent.click(mine);
  await waitFor(() => expect(calls).toHaveLength(1));
  for (const b of screen.getAllByRole("button")) expect(b.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Royal, 1/ }));
  expect(calls).toHaveLength(1);
  answer();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Cheer" }).disabled).toBe(false),
  );
  expect(calls).toHaveLength(1);
});
