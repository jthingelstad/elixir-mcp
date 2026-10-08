import { expect, test } from "vitest";
import { noun } from "../src/noun.ts";

test("a count of one takes the singular, every other count the plural", () => {
  expect(`1 ${noun(1, "day")}`).toBe("1 day");
  expect(`0 ${noun(0, "day")}`).toBe("0 days");
  expect(`2 ${noun(2, "member")}`).toBe("2 members");
  expect(noun(1, "match", "matches")).toBe("match");
  expect(noun(3, "match", "matches")).toBe("matches");
});
