import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { describePolicy, policyFromGoals } from "@elixir-mcp/clan-engine";
import {
  HouseRules,
  ordered,
  ruleId,
  seesFor,
} from "../../src/clan/components/HouseRules.jsx";
import { ruleFor } from "../../src/clan/views/Standing.jsx";

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

  test("on Policy each rule says who sees what about you; Standing shows the rules alone", () => {
    render(<HouseRules how={how} values={values} sees />);
    for (const s of ordered(how)) {
      const card = document.getElementById(ruleId(s.key));
      expect(card.querySelector(".kit-rule__sees")?.textContent).toBe(
        seesFor(s.key, values),
      );
    }
    cleanup();
    render(<HouseRules how={how} values={values} />);
    expect(document.querySelector(".kit-rule__sees")).toBeNull();
  });

  test("who sees where you stand follows the policy's own switch", () => {
    const open = { ...values, members_see_standing: true };
    const shut = { ...values, members_see_standing: false };
    expect(seesFor("minimums", open)).toMatch(/^Every member sees on Standing/);
    expect(seesFor("elder", open)).toMatch(/^Every member sees on Standing/);
    expect(seesFor("minimums", shut)).toMatch(
      /^Only you and the Leader and Co-Leaders/,
    );
    expect(seesFor("elder", shut)).toMatch(
      /^Only you and the Leader and Co-Leaders/,
    );
    // Leaders choose Elders: nobody's standing is listed, whatever the switch.
    const chosen = { ...open, elder_mode: "manual" };
    expect(seesFor("minimums", chosen)).toMatch(/^Only you/);
    expect(seesFor("elder", chosen)).toBe(
      "A promotion or demotion is shared with the clan once it's done.",
    );
    // Your clock is never every member's.
    for (const v of [open, shut])
      expect(seesFor("removal", v)).toMatch(
        /^Only you and the Leader and Co-Leaders see your days without a battle/,
      );
    expect(seesFor("removal", { ...open, away_max_days: 0 })).not.toMatch(
      /away/,
    );
    expect(seesFor("removal", null)).toBeNull();
  });

  test("a group points at the rule that made it", () => {
    expect(ruleFor({ status: "rising" })).toBe("elder");
    expect(ruleFor({ status: "holding" })).toBe("elder");
    expect(ruleFor({ status: "quiet" })).toBe("minimums");
    expect(ruleFor({ status: "quiet", inactivity: "at_risk" })).toBe("removal");
    expect(ruleFor({ status: null })).toBeNull();
  });
});
