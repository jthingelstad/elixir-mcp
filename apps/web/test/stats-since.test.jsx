/**
 * Stats' Battles tile on a phone (round two of polish, 2026-11-13): "since
 * Mon Sep 7, 5:00 am" parts only at its comma, so "since" never sits alone
 * and the time never splits from "am".
 */
import { afterEach, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SinceWhen } from "../src/stats/Season.jsx";

afterEach(cleanup);

test("two unbreakable halves, split at the last comma", () => {
  const { container } = render(<SinceWhen text="Mon Sep 7, 5:00 am" />);
  const halves = [...container.querySelectorAll(".stats-when")].map(
    (el) => el.textContent,
  );
  expect(halves).toEqual(["since Mon Sep 7,", "5:00 am"]);
  expect(container.textContent).toBe("since Mon Sep 7, 5:00 am");
});

test("a date with no comma stays one piece", () => {
  const { container } = render(<SinceWhen text="yesterday" />);
  expect(container.textContent).toBe("since yesterday");
  expect(container.querySelectorAll(".stats-when")).toHaveLength(1);
});
