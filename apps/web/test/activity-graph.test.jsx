/**
 * The battle-activity graphic: a not-recorded day is its own kind of
 * cell, a recorded quiet day says zero, a tap lands the day in the
 * caption, the rhythm rotates into the viewer's clock, and a player
 * without a row yet is told so.
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
    days.push({
      day,
      battles: day === "2026-09-08" ? 6 : day === "2026-09-12" ? 2 : 0,
      status:
        day < "2026-09-03" || day === "2026-09-06"
          ? "not_recorded"
          : "recorded",
    });
  }
  const rhythm = new Array(168).fill(0);
  rhythm[38] = 1; // Tuesday 14:00Z
  return {
    computed_at: "2026-09-13T05:30:00Z",
    window_days: 365,
    half_life_days: 28,
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

test("not recorded is its own cell, a quiet recorded day is zero, and a tap writes the caption", () => {
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
  // Before recording began: hatched, whatever the count.
  // 2025-09-14 .. 2026-09-02 plus the marked day: 355 hatched cells.
  expect(screen.getAllByRole("button", { name: /not recorded/ }).length).toBe(
    355,
  );
  fireEvent.click(busy);
  expect(screen.getByText("Tue 8 Sep 2026: 6 battles").className).toBe(
    "activity__caption",
  );
  // The legend swatch and the list both name it.
  expect(screen.getAllByText("not recorded").length).toBeGreaterThan(0);
  // The rhythm: 168 cells, the Tuesday-14:00 one at the peak.
  const peak = screen.getByRole("img", { name: /Tue 14:00: 100% of the peak/ });
  expect(peak.className).toContain("activity__cell--l4");
  expect(screen.getAllByRole("img").length).toBe(168);
  expect(screen.getByText(/\(UTC\)/)).toBeTruthy();
});

test("no row yet says so instead of drawing an empty year", () => {
  render(<ActivityGraph data={{ computed_at: null, days: [] }} />);
  expect(screen.getByText(/Not computed yet/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
