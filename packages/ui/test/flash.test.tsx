import { test, expect, vi, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useFlash } from "../src/index.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Copy() {
  const [done, flash] = useFlash();
  return (
    <button type="button" onClick={flash}>
      {done ? "Copied" : "Copy"}
    </button>
  );
}

test("a flash shows for a moment, and a second one restarts the clock", () => {
  vi.useFakeTimers();
  render(<Copy />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("button").textContent).toBe("Copied");
  act(() => vi.advanceTimersByTime(1000));
  fireEvent.click(screen.getByRole("button"));
  act(() => vi.advanceTimersByTime(1000));
  expect(screen.getByRole("button").textContent).toBe("Copied");
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole("button").textContent).toBe("Copy");
});

test("unmounting clears the timer, so nothing fires after the view (or jsdom) is gone", () => {
  // The Clan copy-link flake (CI run 39538492981, 2026-10-20): a bare
  // setTimeout set state 1.5 s later, after the test file's jsdom was
  // torn down, and React threw "window is not defined".
  vi.useFakeTimers();
  const { unmount } = render(<Copy />);
  fireEvent.click(screen.getByRole("button"));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
