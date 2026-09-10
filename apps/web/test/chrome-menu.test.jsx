/**
 * The top bar's narrow menu.
 *
 * Two properties, and the second is the one a redesign quietly loses:
 * the six tabs collapse behind one button, and the CONSOLE BUTTON NEVER
 * GOES IN THERE. It is the way into the product, so burying it behind a
 * menu costs a tap on the thing most people came for.
 *
 * Both halves render the same markup at every width and let one media
 * query decide which is showing — so this asserts the markup exists and
 * behaves, not that a breakpoint was computed in JavaScript.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { App } from "../src/App.jsx";

beforeEach(() => {
  cleanup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path) => {
    const body = String(path) === "/api/me" ? { authenticated: false } : {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
  window.history.pushState({}, "", "/data/dashboard");
});
afterEach(() => vi.restoreAllMocks());

test("the menu button opens a sheet with every tab in it", async () => {
  render(<App />);
  const button = await screen.findByRole("button", { name: "Menu" });
  expect(button.getAttribute("aria-expanded")).toBe("false");

  const sheet = document.getElementById("chrome-sheet");
  expect(sheet.dataset.open).toBe("false");
  // The links are in the markup either way — a crawler and a reader with
  // no JavaScript both still find them.
  expect(sheet.querySelectorAll("a")).toHaveLength(6);

  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(sheet.dataset.open).toBe("true");
});

test("the Console button is never inside the menu", async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const sheet = document.getElementById("chrome-sheet");
  expect(sheet.textContent).not.toMatch(/Console/);
  // And it is still on the bar, beside the button that opened the sheet.
  const bar = document.querySelector(".chrome__inner");
  expect(bar.querySelector(".chrome__console")).toBeTruthy();
});

test("the menu button sits after the Console button, on the right", async () => {
  render(<App />);
  const bar = document.querySelector(".chrome__inner");
  const kids = [...bar.children];
  expect(kids.indexOf(bar.querySelector(".chrome__menu"))).toBeGreaterThan(
    kids.indexOf(bar.querySelector(".chrome__console")),
  );
});

test("escape closes it, and so does following a link", async () => {
  render(<App />);
  const button = await screen.findByRole("button", { name: "Menu" });
  const sheet = document.getElementById("chrome-sheet");

  fireEvent.click(button);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(sheet.dataset.open).toBe("false");

  fireEvent.click(button);
  fireEvent.click(sheet.querySelector("a"));
  expect(sheet.dataset.open).toBe("false");
});
