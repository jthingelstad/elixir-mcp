import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { describePolicy, policyFromGoals } from "@elixir-mcp/clan-engine";
import { HouseRules, ordered, ruleId } from "../src/components/HouseRules.jsx";
import { ruleFor } from "../src/views/Standing.jsx";

afterEach(cleanup);

const values = policyFromGoals(["war", "donations"], "standard");
const how = describePolicy(values);

describe("house rules", () => {
  test("each rule is a card at its own address, in reading order", () => {
    render(<HouseRules how={how} values={values} />);
    const keys = ordered(how).map((s) => s.key);
    expect(keys.slice(0, 4)).toEqual(["about", "minimums", "removal", "elder"]);
    for (const key of keys)
      expect(document.getElementById(ruleId(key))).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "When you go quiet" }),
    ).toBeTruthy();
  });

  test("the numbers are the saved values, the sentences unchanged", () => {
    render(<HouseRules how={how} values={values} />);
    const quiet = document.getElementById("rule-removal");
    const nums = [...quiet.querySelectorAll(".kit-rule__big")].map(
      (n) => n.textContent,
    );
    expect(nums[0]).toBe(String(values.at_risk_days));
    for (const line of how.find((s) => s.key === "removal").lines)
      expect(quiet.textContent).toContain(line);
    const minimums = document.getElementById("rule-minimums");
    expect(minimums.textContent).toContain(`${values.war_min_decks}`);
    expect(minimums.querySelector(".sr-only")?.textContent.trim()).toBe(
      values.minimums_rule === "all" ? "and" : "or",
    );
  });

  test("without the values a card is its sentences alone", () => {
    render(<HouseRules how={how} />);
    expect(document.querySelector(".kit-rule__nums")).toBeNull();
  });

  test("a group points at the rule that made it", () => {
    expect(ruleFor({ status: "rising" })).toBe("elder");
    expect(ruleFor({ status: "holding" })).toBe("elder");
    expect(ruleFor({ status: "quiet" })).toBe("minimums");
    expect(ruleFor({ status: "quiet", inactivity: "at_risk" })).toBe("removal");
    expect(ruleFor({ status: null })).toBeNull();
  });
});
