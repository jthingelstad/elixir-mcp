// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Sparkline } from "../src/home/Sparkline.jsx";

afterEach(cleanup);

const bars = (n) =>
  Array.from({ length: n }, (_, i) => ({ r: i % 2 ? "l" : "w", m: 1 }));

test("a sitting's bars are one image, one bar a battle, its margin a class", () => {
  const { container, getByRole } = render(
    <Sparkline spark={[{ r: "w", m: 3 }, { r: "l" }, { r: "d" }]} />,
  );
  expect(getByRole("img").getAttribute("aria-label")).toMatch(/won|win/i);
  const is = [...container.querySelectorAll(".kit-spark > i")];
  expect(is.map((i) => i.className)).toEqual([
    "kit-spark__win kit-spark__m3",
    "kit-spark__loss kit-spark__m1 kit-spark__unknown",
    "kit-spark__draw",
  ]);
});

test("a long sitting closes the gaps so its bars never overflow", () => {
  const cls = (n) =>
    render(<Sparkline spark={bars(n)} />).container.firstElementChild.className;
  expect(cls(12)).toBe("kit-spark");
  expect(cls(40)).toBe("kit-spark kit-spark--dense");
  expect(cls(100)).toBe("kit-spark kit-spark--packed");
});
