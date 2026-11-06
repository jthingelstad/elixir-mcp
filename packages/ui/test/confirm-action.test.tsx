import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { ConfirmAction } from "../src/ConfirmAction.tsx";

afterEach(cleanup);

const box = () => document.querySelector("dialog.kit-confirm") as HTMLElement;
const named = (name: string) =>
  within(box()).getByRole("button", { name, hidden: true });

function open(run: () => unknown) {
  const onDone = vi.fn();
  render(
    <ConfirmAction
      label="Revoke"
      title="Revoke this key?"
      body="It stops working at once."
      confirm="Yes, revoke"
      run={run as never}
      onDone={onDone}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  return onDone;
}

test("a click only asks: Cancel and Escape write nothing", () => {
  const run = vi.fn();
  open(run);
  expect(box().textContent).toContain("It stops working at once.");
  fireEvent.click(named("Cancel"));
  expect(box()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  fireEvent(box(), new Event("cancel", { cancelable: true }));
  expect(box()).toBeNull();
  expect(run).not.toHaveBeenCalled();
});

test("the named button writes once, closes and reports", async () => {
  const run = vi.fn(async () => ({ ok: true }));
  const onDone = open(run);
  fireEvent.click(named("Yes, revoke"));
  await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith({ ok: true }));
  expect(run).toHaveBeenCalledTimes(1);
  expect(box()).toBeNull();
});

test("a refused write stays open and says why", async () => {
  const onDone = open(async () => ({
    ok: false,
    error: { status: 403, data: { message: "Not yours." } },
  }));
  fireEvent.click(named("Yes, revoke"));
  await within(box()).findByRole("alert", { hidden: true });
  expect(box()).not.toBeNull();
  expect(onDone).not.toHaveBeenCalled();
});
