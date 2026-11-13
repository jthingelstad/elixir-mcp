/**
 * The battle-activity graphic: a day with battles is always drawn (even
 * outside coverage), a not-recorded day is its own kind of cell, a
 * recorded quiet day says zero, a tap lands the day in the caption, the
 * and a player without a row yet is told so. (The rhythm tile retired
 * 2026-09-19.)
 */
import { test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  ActivityGraph,
  level,
  weeks,
} from "../src/components/ActivityGraph.jsx";

afterEach(cleanup);

function fixture() {
  const days = [];
  const end = Date.parse("2026-09-13T00:00:00Z");
  for (let i = 364; i >= 0; i -= 1) {
    const day = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    const battles =
      day === "2026-09-08"
        ? 6
        : day === "2026-09-12"
          ? 2
          : day === "2026-05-14"
            ? 3
            : 0;
    // Fixture evidence covers July onward, with a stray positive outside
    // coverage and one partial September day.
    const covered = day >= "2026-07-08" && day !== "2026-09-06";
    // Tallies: the busy day 4-1 with a draw, the partial day all draws
    // (no share), the May appearance a bare count (a row not yet rebuilt).
    const tallies =
      day === "2026-09-08"
        ? { wins: 4, losses: 1 }
        : day === "2026-09-12"
          ? { wins: 0, losses: 0 }
          : {};
    days.push({
      day,
      battles,
      ...tallies,
      coverage:
        day === "2026-09-12" ? "partial" : covered ? "complete" : "unknown",
      status: battles > 0 || covered ? "recorded" : "not_recorded",
      ...(day === "2026-09-12" ? { partial: true } : {}),
    });
  }
  return {
    computed_at: "2026-09-13T05:30:00Z",
    window_days: 365,
    half_life_days: 28,
    log_reads_from: "2026-07-08",
    recorded_from: "2026-09-03T18:13:44Z",
    days,
  };
}

test("level scales to the player's own busiest day", () => {
  expect(level(0, 10)).toBe(0);
  expect(level(1, 10)).toBe(1);
  expect(level(5, 10)).toBe(2);
  expect(level(7, 10)).toBe(3);
  expect(level(10, 10)).toBe(4);
});

test("weeks pads the first column to Monday", () => {
  // 2026-09-09 is a Wednesday: two pads before it.
  const cols = weeks([
    { day: "2026-09-09", battles: 0, status: "recorded" },
    { day: "2026-09-10", battles: 0, status: "recorded" },
  ]);
  expect(cols.length).toBe(1);
  expect(cols[0].slice(0, 2)).toEqual([null, null]);
  expect(cols[0][2].day).toBe("2026-09-09");
});

test("one hue by battle count, empty days need whole-day reads, and a tap writes the evidence caption", () => {
  render(<ActivityGraph data={fixture()} />);
  const notRecorded = screen.getByRole("button", {
    name: /^Sun Sep 6 2026: unknown · no battles recorded$/,
  });
  expect(notRecorded.className).toContain("activity__cell--none");
  const busy = screen.getByRole("button", {
    name: /^Tue Sep 8 2026: 6 battles recorded · the whole day was read$/,
  });
  expect(busy.className).toContain("activity__cell--l4");
  // Won and lost stay in the two-week list: the cell is the count alone.
  expect(busy.className).not.toContain("--hue");
  const quiet = screen.getByRole("button", {
    name: /^Thu Sep 10 2026: 0 battles · read in full$/,
  });
  expect(quiet.className).toContain("activity__cell--l0");
  expect(quiet.className).not.toContain("activity__cell--none");
  // Hatched: every day before the July evidence except the May appearance,
  // plus the unknown quiet day. 2025-09-14 .. 2026-07-07 is 297 days.
  expect(
    screen.getAllByRole("button", {
      name: /unknown · no battles recorded/,
    }).length,
  ).toBe(297);
  // A stray appearance is drawn; the quiet days around it are hatched.
  const stray = screen.getByRole("button", {
    name: /^Thu May 14 2026: 3 battles recorded · unknown$/,
  });
  expect(stray.className).toContain("activity__cell--l2");
  expect(
    screen.getByRole("button", {
      name: /^Fri May 15 2026: unknown · no battles recorded$/,
    }).className,
  ).toContain("activity__cell--none");
  expect(
    screen.getByRole("button", {
      name: /^Sat Sep 12 2026: 2 battles recorded · part of the day was read$/,
    }),
  ).toBeTruthy();
  expect(screen.getByText(/Followed since \w+ Sep [23]( 2026)?/)).toBeTruthy();
  fireEvent.click(busy);
  expect(
    screen.getByText(
      "Tue Sep 8 2026: 6 battles recorded · the whole day was read",
    ).className,
  ).toBe("activity__caption");
  // The legend runs fewer to more; win share is not on it.
  expect(screen.queryByText("losses")).toBeNull();
  expect(screen.getByText("Fewer")).toBeTruthy();
  expect(screen.getByText("Unknown")).toBeTruthy();
  // No rhythm tile: nothing renders as an img.
  expect(screen.queryAllByRole("img").length).toBe(0);
});

test("no row yet says so instead of drawing an empty year", () => {
  render(<ActivityGraph data={{ computed_at: null, days: [] }} />);
  expect(screen.getByText(/Activity is unavailable/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

test("legacy recorded flags cannot turn empty days into quiet, and no nightly row is required", () => {
  render(
    <ActivityGraph
      data={{
        as_of: "2026-01-01T12:00:00Z",
        computed_at: null,
        days: [
          { day: "2025-12-31", battles: 0, status: "recorded" },
          {
            day: "2026-01-01",
            battles: 2,
            status: "not_recorded",
            coverage: "unknown",
          },
        ],
      }}
    />,
  );
  expect(
    screen.getByRole("button", { name: /Dec 31 2025: unknown/ }).className,
  ).toContain("activity__cell--none");
  expect(
    screen.getByRole("button", { name: /Jan 1 2026: 2 battles recorded/ })
      .className,
  ).toContain("activity__cell--l4");
  expect(
    screen.queryByRole("button", { name: /covered quiet day/ }),
  ).toBeNull();
});

test("failed reads retain positive evidence, retry reads, and an expired selected day does not crash", () => {
  const retry = vi.fn();
  const { rerender } = render(<ActivityGraph data={fixture()} />);
  fireEvent.click(
    screen.getByRole("button", { name: /Tue Sep 8 2026: 6 battles recorded/ }),
  );
  rerender(
    <ActivityGraph data={fixture()} error={{ status: 503 }} onRetry={retry} />,
  );
  expect(screen.getByText(/Showing the last successful read/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /Tue Sep 8 2026: 6 battles recorded/ }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry activity read" }));
  expect(retry).toHaveBeenCalledTimes(1);
  rerender(<ActivityGraph data={{ ...fixture(), days: [] }} />);
  expect(screen.getByText(/0 days with recorded battles/)).toBeTruthy();
  rerender(<ActivityGraph error={{ status: 503 }} onRetry={retry} />);
  expect(screen.getByText(/What was read is unknown/)).toBeTruthy();
  expect(screen.queryByRole("group")).toBeNull();
});
