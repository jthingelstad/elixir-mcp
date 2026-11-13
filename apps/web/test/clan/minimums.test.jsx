import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Minimums } from "../../src/clan/components/YouHereCard.jsx";
import { renderWithProviders } from "./helpers.jsx";

afterEach(cleanup);

const minimums = (over) => ({
  set: { war: 8, donations: 20 },
  met: { war: false, donations: false },
  passes: false,
  unknown: false,
  rule: "any",
  window_weeks: 2,
  ...over,
});

describe("You in the clan: the verdict comes first", () => {
  it("says a member is meeting the minimum", () => {
    renderWithProviders(
      <Minimums minimums={minimums({ met: { war: true }, passes: true })} />,
    );
    expect(screen.getByText("You are meeting the minimum")).toBeTruthy();
    expect(
      screen.getByText(/Any one of these is enough, over 2 weeks/),
    ).toBeTruthy();
  });

  it("says when not, and names the nearest", () => {
    renderWithProviders(
      <Minimums
        minimums={minimums({
          rule: "all",
          nearest: { key: "war", need: 8, have: 6 },
        })}
      />,
    );
    expect(
      screen.getByText("You are not meeting the minimum yet"),
    ).toBeTruthy();
    expect(document.body.textContent).toMatch(/All of these, over 2 weeks/);
    expect(document.body.textContent).toMatch(/Your nearest is .*you are at 6/);
  });

  it("does not guess when the record cannot say", () => {
    renderWithProviders(
      <Minimums minimums={minimums({ unknown: true, met: { war: null } })} />,
    );
    expect(
      screen.getByText(
        "Elixir cannot say yet whether you are meeting the minimum",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Not known yet")[0]).toBeTruthy();
  });

  it("gives a leader no verdict, because no minimum applies to them", () => {
    renderWithProviders(
      <Minimums minimums={minimums({ passes: true })} ranks />,
    );
    expect(document.body.textContent).not.toMatch(/meeting the minimum/);
  });
});
