import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  earnedDay,
  StampMark,
  StampMini,
  StampTile,
  stampTitle,
} from "../src/Stamp.tsx";

/** Stamps (#1015): earned and unearned differ in more than colour, a
 *  level is a numeral and never a metal, and the mark is text and a
 *  glyph, never a picture. */
afterEach(cleanup);

const LADDER = {
  id: "cheerleader",
  name: "Cheerleader",
  icon: "heart-pulse",
  shape: "round",
  ink: "coral",
  thresholds: [3, 15, 50],
};
const ONCE = {
  id: "looking_good",
  name: "Looking Good",
  icon: "image",
  shape: "square",
  ink: "blue",
  thresholds: [1],
};

test("a ladder's name carries its level as a numeral; a once-Stamp never does", () => {
  expect(stampTitle(LADDER, 0)).toBe("Cheerleader");
  expect(stampTitle(LADDER, 2)).toBe("Cheerleader II");
  expect(stampTitle(LADDER, 3)).toBe("Cheerleader III");
  expect(stampTitle(ONCE, 1)).toBe("Looking Good");
});

test("a frozen day reads as it is, with no zone moving it", () => {
  expect(earnedDay("2026-11-14")).toBe("14 November 2026");
  expect(earnedDay("2026-01-01", { short: true })).toBe("1 Jan 2026");
  expect(earnedDay("2026-11-14T23:30:00Z")).toBeNull();
  expect(earnedDay(null)).toBeNull();
  expect(earnedDay("2026-13-01")).toBeNull();
});

test("earned and unearned differ in shape and words, not colour alone", () => {
  const { container } = render(
    <>
      <StampMark stamp={LADDER} level={2} day="2026-11-10" />
      <StampMark stamp={LADDER} />
    </>,
  );
  const [earned, blank] = container.querySelectorAll(".kit-stamp");
  expect(earned.className).toContain("kit-stamp--earned");
  expect(earned.className).toContain("kit-stamp--coral");
  expect(earned.className).toMatch(/kit-stamp--tilt-[ab]/);
  expect(earned.textContent).toContain("Cheerleader II");
  expect(earned.textContent).toContain("10 Nov 2026");
  expect(blank.className).toContain("kit-stamp--blank");
  expect(blank.className).not.toContain("kit-stamp--coral");
  expect(blank.className).not.toMatch(/tilt/);
  expect(blank.textContent).toContain("Elixir");
  // For the eye only: the tile's button carries the meaning.
  expect(earned.getAttribute("aria-hidden")).toBe("true");
});

test("every level wears the same ink, never bronze, silver or gold", () => {
  const { container } = render(
    <>
      {[1, 2, 3].map((l) => (
        <StampMark key={l} stamp={LADDER} level={l} day="2026-11-10" />
      ))}
    </>,
  );
  const marks = [...container.querySelectorAll(".kit-stamp")];
  for (const m of marks) {
    expect(m.className).toContain("kit-stamp--coral");
    expect(m.className).not.toMatch(/gold|silver|bronze|verified/);
  }
});

test("a legacy grant says Before over its day", () => {
  const { container } = render(
    <StampMark stamp={ONCE} level={1} day="2026-10-01" before />,
  );
  expect(container.textContent).toContain("Before");
  expect(container.textContent).toContain("1 Oct 2026");
});

test("the mark is a glyph and text: no image, no bitmap", () => {
  const { container } = render(
    <StampMark stamp={ONCE} level={1} day="2026-10-01" large />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("svg")).not.toBeNull();
  expect(container.querySelector(".kit-stamp--l")).not.toBeNull();
  expect(container.querySelector(".kit-stamp--square")).not.toBeNull();
});

test("a tile is one button named in full, with its word under the mark", () => {
  const onClick = vi.fn();
  render(
    <StampTile
      stamp={ONCE}
      label="Not earned"
      name="Looking Good. Not earned yet."
      onClick={onClick}
    />,
  );
  const button = screen.getByRole("button", {
    name: "Looking Good. Not earned yet.",
  });
  expect(button.getAttribute("data-stamp")).toBe("looking_good");
  expect(button.textContent).toContain("Not earned");
  fireEvent.click(button);
  expect(onClick).toHaveBeenCalledOnce();
});

test("the compact mark is hidden from assistive technology", () => {
  const { container } = render(<StampMini stamp={ONCE} />);
  const mini = container.querySelector(".kit-stamp-mini")!;
  expect(mini.getAttribute("aria-hidden")).toBe("true");
  expect(mini.className).toContain("kit-stamp-mini--square");
});
