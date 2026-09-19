/**
 * Status ▸ Efficiency: the rule in words, the seven-day tiles, one row
 * per closed day newest first, today's row with its loss left blank,
 * and no player named anywhere.
 */
import { test, expect, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { Efficiency } from "../src/views/Efficiency.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BODY = {
  as_of: "2026-09-20T12:00:00Z",
  rule: {
    followup_minutes: 30,
    ceiling_minutes: 120,
    profile_daily: true,
    since: "2026-09-19",
  },
  days: [
    {
      day: "2026-09-18",
      battlelog_polls: 7200,
      productive_polls: 2800,
      nothing_new_polls: 4400,
      battles_captured: 22000,
      audited_polls: 7100,
      gaps: 110,
      lost_battles: 1000,
      players_with_gaps: 80,
    },
    {
      day: "2026-09-19",
      battlelog_polls: 12000,
      productive_polls: 3000,
      nothing_new_polls: 9000,
      battles_captured: 23000,
      audited_polls: 11900,
      gaps: 4,
      lost_battles: 20,
      players_with_gaps: 3,
    },
  ],
  today: {
    day: "2026-09-20",
    battlelog_polls: 6000,
    productive_polls: 1500,
    nothing_new_polls: 4500,
    battles_captured: 11000,
    audited_polls: 5900,
    gaps: 1,
    lost_battles: null,
  },
  last_hour: { battlelog_polls: 800, nothing_new_polls: 600, gaps: 0 },
};

function mockFetch(body = BODY) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
}

test("the rule, the week's tiles and the days, newest first, today blank on loss", async () => {
  mockFetch();
  renderWithProviders(<Efficiency navigate={() => {}} />);
  await waitFor(() => screen.getByText("Efficiency"));
  expect(screen.getByText(/read every 30 minutes/)).toBeTruthy();
  expect(screen.getByText(/never passes 120 minutes/)).toBeTruthy();
  // Seven-day tiles over the two closed days: 19,200 reads, 1,020 lost.
  expect(screen.getByText("19,200")).toBeTruthy();
  expect(screen.getByText("1,020")).toBeTruthy();
  const rows = screen.getAllByRole("row").slice(1); // minus the header
  expect(rows.map((r) => r.textContent.slice(0, 10))).toEqual([
    "2026-09-20",
    "2026-09-19",
    "2026-09-18",
  ]);
  expect(rows[0].textContent).toMatch(/so far/);
  expect(rows[0].textContent).toMatch(/tomorrow/);
  expect(rows[1].textContent).toMatch(/75%/); // 9,000 of 12,000 found nothing
  expect(document.body.textContent).not.toMatch(/#[0289PYLQGRJCUV]{5,}/);
});

test("an empty first day says when the first row lands", async () => {
  mockFetch({ ...BODY, days: [] });
  renderWithProviders(<Efficiency navigate={() => {}} />);
  await waitFor(() => screen.getByText(/first closed day lands/));
});
