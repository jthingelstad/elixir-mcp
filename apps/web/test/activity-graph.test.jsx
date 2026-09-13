/**
 * The battle-activity graphic: a day with battles is always drawn (even
 * outside coverage), a not-recorded day is its own kind of cell, a
 * recorded quiet day says zero, a tap lands the day in the caption, the
 * rhythm rotates into the viewer's clock, and a player without a row
 * yet is told so.
 */
import { test, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  ActivityGraph,
  level,
  weeks,
  localRhythm,
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
    // Log reads cover July onward; a stray May appearance; one marked
    // September day that still holds battles (partial).
    const covered = day >= "2026-07-08" && day !== "2026-09-06";
    days.push({
      day,
      battles,
      status: battles > 0 || covered ? "recorded" : "not_recorded",
      ...(day === "2026-09-12" ? { partial: true } : {}),
    });
  }
  const rhythm = new Array(168).fill(0);
  rhythm[38] = 1; // Tuesday 14:00Z
  return {
    computed_at: "2026-09-13T05:30:00Z",
    window_days: 365,
    half_life_days: 28,
    rhythm_battles: 262,
    log_reads_from: "2026-07-08",
    recorded_from: "2026-09-03T18:13:44Z",
    rhythm,
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

test("localRhythm rotates UTC buckets into the viewer's offset", () => {
  const r = new Array(168).fill(0);
  r[38] = 1; // Tue 14:00Z
  expect(localRhythm(r, -5)[24 + 9]).toBe(1); // Tue 09:00 in UTC-5
  expect(localRhythm(r, 0)[38]).toBe(1);
  // Across midnight: Mon 23:00Z is Tue 01:00 at UTC+2.
  const m = new Array(168).fill(0);
  m[23] = 1;
  expect(localRhythm(m, 2)[24 + 1]).toBe(1);
});

test("coverage follows the log reads, not recorded is its own cell, a quiet recorded day is zero, and a tap writes the caption", () => {
  render(<ActivityGraph data={fixture()} offsetHours={0} />);
  const notRecorded = screen.getByRole("button", {
    name: /^Sun 6 Sep 2026: not recorded$/,
  });
  expect(notRecorded.className).toContain("activity__cell--none");
  const busy = screen.getByRole("button", {
    name: /^Tue 8 Sep 2026: 6 battles$/,
  });
  expect(busy.className).toContain("activity__cell--l4");
  const quiet = screen.getByRole("button", {
    name: /^Thu 10 Sep 2026: 0 battles$/,
  });
  expect(quiet.className).toContain("activity__cell--l0");
  expect(quiet.className).not.toContain("activity__cell--none");
  // Hatched: every day before the July reads except the May appearance,
  // plus the marked quiet day. 2025-09-14 .. 2026-07-07 is 297 days.
  expect(screen.getAllByRole("button", { name: /not recorded/ }).length).toBe(
    297,
  );
  // A stray appearance is drawn; the quiet days around it are hatched.
  const stray = screen.getByRole("button", {
    name: /^Thu 14 May 2026: 3 battles$/,
  });
  expect(stray.className).toContain("activity__cell--l2");
  expect(
    screen.getByRole("button", { name: /^Fri 15 May 2026: not recorded$/ })
      .className,
  ).toContain("activity__cell--none");
  expect(
    screen.getByRole("button", {
      name: /^Sat 12 Sep 2026: 2 battles, log rolled past some$/,
    }),
  ).toBeTruthy();
  expect(screen.getByText(/log read since 2026-07-08/)).toBeTruthy();
  fireEvent.click(busy);
  expect(screen.getByText("Tue 8 Sep 2026: 6 battles").className).toBe(
    "activity__caption",
  );
  // The legend swatch and the list both name it.
  expect(screen.getAllByText("not recorded").length).toBeGreaterThan(0);
  // The rhythm: 168 cells, the Tuesday-14:00 one at the peak, every
  // recorded battle counted in the header.
  const peak = screen.getByRole("img", {
    name: /Tue 14:00: 100% of the peak/,
  });
  expect(peak.className).toContain("activity__cell--l4");
  expect(screen.getAllByRole("img").length).toBe(168);
  expect(screen.getByText(/\(UTC\)/)).toBeTruthy();
  expect(
    screen.getByText(/every recorded battle in the last 365 days \(262\)/),
  ).toBeTruthy();
});

test("no row yet says so instead of drawing an empty year", () => {
  render(<ActivityGraph data={{ computed_at: null, days: [] }} />);
  expect(screen.getByText(/Not computed yet/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
