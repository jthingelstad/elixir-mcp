/**
 * Admin ▸ Beta pulse: counts by signup week and their shares of that
 * week's signups, a running came-back window marked open, mail sends by
 * kind, and nothing that links to an account.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, cleanup, within } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Admin } from "../src/views/Admin.jsx";
import { pulseRows, share, backCell } from "../src/lib/pulse.js";

const week = (w, counts = {}) => ({
  week: w,
  starts: "2026-09-28",
  signed_up: 0,
  added_player: 0,
  primary_set: 0,
  profile: 0,
  battles: 0,
  clan_followed: 0,
  clan_auto: 0,
  verified: 0,
  came_back_week1: 0,
  week1_open: 0,
  came_back_week2: 0,
  week2_open: 0,
  ...counts,
});
const W40 = week("2026-W40", {
  signed_up: 4,
  added_player: 3,
  primary_set: 3,
  profile: 2,
  battles: 2,
  clan_followed: 2,
  clan_auto: 1,
  verified: 1,
  came_back_week1: 2,
  came_back_week2: 1,
  week2_open: 2,
});
const W41 = week("2026-W41", { signed_up: 1, added_player: 1, week1_open: 1 });
const PULSE = {
  weeks: [W40, W41],
  totals: { ...W40, signed_up: 5, added_player: 4, week1_open: 1 },
  excluded: { staff: 1, test: 2 },
  mail: {
    weeks: ["2026-W40", "2026-W41"],
    kinds: [{ kind: "clan", label: "Clan report", sends: [7, 3] }],
  },
  opens: { measured_here: false },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => PULSE,
      text: async () => JSON.stringify(PULSE),
    })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

test("a share is a count and its percent of the week's signups", () => {
  expect(share(3, 4)).toBe("3 · 75%");
  expect(share(0, 0)).toBe("0");
  expect(backCell(1, 0, 4)).toBe("1 · 25%");
  expect(backCell(1, 2, 4).text).toBe("1 · 25% (2 open)");
});

test("rows run newest week first, with the window's total last", () => {
  const rows = pulseRows(PULSE);
  expect(rows.map((r) => r[0])).toEqual(["2026-W41", "2026-W40", "2 weeks"]);
  expect(rows[1].slice(1, 4)).toEqual(["4", "3 · 75%", "3 · 75%"]);
  expect(pulseRows(null)).toEqual([]);
});

test("the page shows the counts and the mail, and links to no account", async () => {
  renderWithProviders(
    <Admin me={{ is_admin: true }} page="pulse" navigate={vi.fn()} />,
  );
  await waitFor(() => expect(screen.getByText("Clan report")).toBeTruthy());
  // The funnel's row (the mail table names the week in its header).
  const row = screen
    .getAllByText("2026-W40")
    .map((n) => n.closest("tr"))
    .find((tr) => tr.closest("tbody"));
  expect(within(row).getAllByText("2 · 50%").length).toBeGreaterThan(0);
  expect(within(row).getByText("1 · 25% (2 open)")).toBeTruthy();
  expect(screen.getByText("Clan report")).toBeTruthy();
  expect(
    screen.getByText(/1 staff account and 2 staff test mailboxes/),
  ).toBeTruthy();
  const table = row.closest("table");
  expect(table.querySelectorAll("a").length).toBe(0);
});

test("a member is not shown the pulse", () => {
  renderWithProviders(
    <Admin me={{ is_admin: false }} page="pulse" navigate={vi.fn()} />,
  );
  expect(screen.getByText("Admins only.")).toBeTruthy();
});
