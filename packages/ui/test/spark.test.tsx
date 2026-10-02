import { test, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Spark } from "../src/index.ts";

afterEach(cleanup);

/**
 * The kit's spark (design canvas, 2026-10-01): a count out of a whole per
 * period, said in words for a screen reader, never taller than the whole,
 * and a period the record could not read is a dash, not a zero.
 */
test("every bar is in the label, out of its whole, and an unread period is said", () => {
  render(
    <Spark
      label="War decks"
      points={[
        { label: "135/3", value: 16, of: 16 },
        { label: "135/4", value: 8, of: 16 },
        { label: "136/0", value: 2, of: 16 },
        { label: "136/1", value: null, of: 16 },
        { label: "136/2", value: 20, of: 16 },
      ]}
    />,
  );
  const img = screen.getByRole("img");
  expect(img.getAttribute("aria-label")).toBe(
    "War decks: 135/3 16 of 16, 135/4 8 of 16, 136/0 2 of 16, 136/1 not read, 136/2 20 of 16",
  );
  const rects = [...img.querySelectorAll("rect")];
  expect(rects.map((r) => r.getAttribute("class"))).toEqual([
    "spark__bar",
    "spark__bar spark__bar--mid",
    "spark__bar spark__bar--low",
    "spark__nil",
    "spark__bar",
  ]);
  // A full whole and more than the whole draw the same height.
  expect(rects[0]?.getAttribute("height")).toBe("22");
  expect(rects[4]?.getAttribute("height")).toBe("22");
  expect(rects[3]?.getAttribute("height")).toBe("2");
});

test("no periods draws nothing", () => {
  const { container } = render(<Spark label="War decks" points={[]} />);
  expect(container.innerHTML).toBe("");
});
