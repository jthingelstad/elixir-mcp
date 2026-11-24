import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SplitBar, Stepper, Switch } from "../src/index.ts";

afterEach(cleanup);

describe("Switch", () => {
  test("a bare switch is named by its label and says whether it is on", () => {
    const onChange = vi.fn();
    render(<Switch on={false} label="Count trophies" onChange={onChange} />);
    const s = screen.getByRole("switch", { name: "Count trophies" });
    expect(s.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(s);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test("a switch row is named by its words, with its hint beside them", () => {
    const onChange = vi.fn();
    render(
      <Switch on onChange={onChange} hint="Friendly battles and 2v2">
        We like to play together
      </Switch>,
    );
    const s = screen.getByRole("switch", { name: "We like to play together" });
    expect(s.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Friendly battles and 2v2")).toBeTruthy();
    fireEvent.click(s);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("Stepper", () => {
  test("− and + step inside the range, and stop at its ends", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Stepper
        label="War decks"
        value={12}
        min={0}
        max={16}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More war decks" }));
    expect(onChange).toHaveBeenLastCalledWith(13);
    fireEvent.click(screen.getByRole("button", { name: "Less war decks" }));
    expect(onChange).toHaveBeenLastCalledWith(11);
    rerender(
      <Stepper
        label="War decks"
        value={16}
        min={0}
        max={16}
        onChange={onChange}
      />,
    );
    expect(
      (
        screen.getByRole("button", {
          name: "More war decks",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  test("a step lands on the next multiple of the step", () => {
    const onChange = vi.fn();
    render(
      <Stepper
        label="Cards"
        value={45}
        step={10}
        max={500}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More cards" }));
    expect(onChange).toHaveBeenLastCalledWith(50);
    fireEvent.click(screen.getByRole("button", { name: "Less cards" }));
    expect(onChange).toHaveBeenLastCalledWith(40);
  });

  test("a typed number is clamped to the range and kept whole", () => {
    const onChange = vi.fn();
    render(
      <Stepper
        label="Days"
        value={10}
        min={1}
        max={90}
        step={1}
        unit="days"
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Days" });
    fireEvent.change(input, { target: { value: "200" } });
    expect(onChange).toHaveBeenLastCalledWith(90);
    fireEvent.change(input, { target: { value: "12.4" } });
    expect(onChange).toHaveBeenLastCalledWith(12);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.getByText("days")).toBeTruthy();
  });
});

describe("SplitBar", () => {
  test("names every share, and leaves a zero out of the bar", () => {
    render(
      <SplitBar
        label="What makes a best player"
        parts={[
          { key: "war", label: "War", share: 60 },
          { key: "ranked", label: "Ranked", share: 40 },
          { key: "trophies", label: "Trophies", share: 0 },
        ]}
      />,
    );
    const bar = screen.getByRole("img", {
      name: "What makes a best player: War 60%, Ranked 40%, Trophies 0%",
    });
    expect(bar.querySelectorAll("rect").length).toBe(2);
    expect(bar.querySelectorAll("li").length).toBe(3);
  });
});
