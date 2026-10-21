import { test, expect, vi, afterEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

/** Every React source a test can mount. */
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const roots = ["apps/web/src", "packages/clan-web/src", "packages/ui/src"];
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory()
      ? walk(p)
      : /\.[jt]sx?$/.test(name)
        ? [p]
        : [];
  });
}

test("no view sets state from a bare timer; a passing flag is useFlash", () => {
  const bare = /setTimeout\(\s*\(\)\s*=>\s*set[A-Z]\w*\(/;
  const offenders = roots
    .flatMap((root) => walk(path.join(repo, root)))
    .map((file) => path.relative(repo, file))
    // The hook itself is the one timer that may, and it clears on unmount.
    .filter((file) => file !== "packages/ui/src/flash.ts")
    .filter((file) => bare.test(readFileSync(path.join(repo, file), "utf8")));
  expect(offenders).toEqual([]);
});
