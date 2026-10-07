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
  shareBin,
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
  // The win share in tenths; undecided days (all draws, or a row the
  // nightly job has not rebuilt with tallies) have none.
  expect(shareBin({ wins: 4, losses: 1 })).toBe(8);
  expect(shareBin({ wins: 1, losses: 2 })).toBe(3);
  expect(shareBin({ wins: 0, losses: 3 })).toBe(0);
  expect(shareBin({ wins: 0, losses: 0 })).toBe(null);
  expect(shareBin({ battles: 3 })).toBe(null);
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

test("positive battles keep their hue, empty days need complete capture, and a tap writes the evidence caption", () => {
  render(<ActivityGraph data={fixture()} />);
  const notRecorded = screen.getByRole("button", {
    name: /^Sun 6 Sep 2026: capture unknown · no battles recorded$/,
  });
  expect(notRecorded.className).toContain("activity__cell--none");
  const busy = screen.getByRole("button", {
    name: /^Tue 8 Sep 2026: 6 battles recorded · 4 wins, 1 loss, 1 draw · complete day capture$/,
  });
  expect(busy.className).toContain("activity__cell--l4");
  // 4 of 5 decided: the 80% hue bin.
  expect(busy.className).toContain("activity__cell--hue activity__cell--w8");
  const quiet = screen.getByRole("button", {
    name: /^Thu 10 Sep 2026: 0 battles · covered quiet day$/,
  });
  expect(quiet.className).toContain("activity__cell--l0");
  expect(quiet.className).not.toContain("activity__cell--none");
  // Hatched: every day before the July evidence except the May appearance,
  // plus the unknown quiet day. 2025-09-14 .. 2026-07-07 is 297 days.
  expect(
    screen.getAllByRole("button", {
      name: /capture unknown · no battles recorded/,
    }).length,
  ).toBe(297);
  // A stray appearance is drawn; the quiet days around it are hatched.
  const stray = screen.getByRole("button", {
    name: /^Thu 14 May 2026: 3 battles recorded · capture unknown$/,
  });
  expect(stray.className).toContain("activity__cell--l2");
  // A bare count (no tallies yet) keeps the accent ramp.
  expect(stray.className).not.toContain("activity__cell--hue");
  expect(
    screen.getByRole("button", {
      name: /^Fri 15 May 2026: capture unknown · no battles recorded$/,
    }).className,
  ).toContain("activity__cell--none");
  // All draws: volume, but no share, so no hue - and no "0 wins, 0 losses"
  // is not what it says; it says what happened.
  const partial = screen.getByRole("button", {
    name: /^Sat 12 Sep 2026: 2 battles recorded · 0 wins, 0 losses, 2 draws · capture incomplete or not comparable$/,
  });
  expect(partial.className).not.toContain("activity__cell--hue");
  expect(screen.getByText(/tracked since 2026-09-03/)).toBeTruthy();
  fireEvent.click(busy);
  expect(
    screen.getByText(
      "Tue 8 Sep 2026: 6 battles recorded · 4 wins, 1 loss, 1 draw · complete day capture",
    ).className,
  ).toBe("activity__caption");
  // The legend runs losses to wins, then fewer to more.
  expect(screen.getByText("losses")).toBeTruthy();
  expect(screen.getByText("wins")).toBeTruthy();
  expect(screen.getByText("fewer")).toBeTruthy();
  // The legend swatch and the list both name it.
  expect(
    screen.getAllByText("capture incomplete or unknown").length,
  ).toBeGreaterThan(0);
  // No rhythm tile: nothing renders as an img.
  expect(screen.queryAllByRole("img").length).toBe(0);
});

test("no row yet says so instead of drawing an empty year", () => {
  render(<ActivityGraph data={{ computed_at: null, days: [] }} />);
  expect(screen.getByText(/Activity evidence is unavailable/)).toBeTruthy();
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
    screen.getByRole("button", { name: /31 Dec 2025: capture unknown/ })
      .className,
  ).toContain("activity__cell--none");
  expect(
    screen.getByRole("button", { name: /1 Jan 2026: 2 battles recorded/ })
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
    screen.getByRole("button", { name: /Tue 8 Sep 2026: 6 battles recorded/ }),
  );
  rerender(
    <ActivityGraph data={fixture()} error={{ status: 503 }} onRetry={retry} />,
  );
  expect(screen.getByText(/Showing the last successful read/)).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /Tue 8 Sep 2026: 6 battles recorded/ }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry activity read" }));
  expect(retry).toHaveBeenCalledTimes(1);
  rerender(<ActivityGraph data={{ ...fixture(), days: [] }} />);
  expect(screen.getByText(/0 days with recorded battles/)).toBeTruthy();
  rerender(<ActivityGraph error={{ status: 503 }} onRetry={retry} />);
  expect(screen.getByText(/Capture is unknown/)).toBeTruthy();
  expect(screen.queryByRole("group")).toBeNull();
});
