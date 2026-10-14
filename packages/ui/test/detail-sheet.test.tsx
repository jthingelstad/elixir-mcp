import { afterEach, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Setting } from "../src/DetailSheet.tsx";

afterEach(cleanup);

test("a setting opens its editor on demand and restores focus on Close and Escape", () => {
  const { container } = render(
    <Setting title="Delivery" description="Not connected">
      <label>
        Channel
        <input />
      </label>
    </Setting>,
  );
  expect(screen.queryByLabelText("Channel")).toBeNull();
  const trigger = screen.getByRole("button", { name: "Manage Delivery" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Delivery" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Channel"), {
    target: { value: "Unsaved" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect((screen.getByLabelText("Channel") as HTMLInputElement).value).toBe("");
  fireEvent(
    container.querySelector("dialog")!,
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
