import { test, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Chrome } from "../src/index.ts";

afterEach(cleanup);

const TABS = [
  { label: "Home", href: "/" },
  { label: "Docs", href: "/docs" },
];

test("the bar carries the wordmark, the tabs, and the action outside any menu", () => {
  render(
    <Chrome
      wordmark="Elixir"
      tabs={TABS}
      action={
        <a className="chrome__console" href="/in">
          Console
        </a>
      }
    />,
  );
  expect(screen.getByText("Elixir").getAttribute("href")).toBe("/");
  const nav = screen.getByRole("navigation", { name: "Elixir" });
  expect(nav.querySelectorAll("a").length).toBe(2);
  expect(screen.getByText("Console").closest(".chrome__inner")).toBeTruthy();
  // No menu unless asked for.
  expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
});

test("with a menu: the button opens a sheet with every tab, Escape and a link close it", () => {
  render(<Chrome wordmark="Elixir" tabs={TABS} menu />);
  const button = screen.getByRole("button", { name: "Menu" });
  const sheet = document.getElementById("chrome-sheet")!;
  expect(sheet.getAttribute("data-open")).toBe("false");
  fireEvent.click(button);
  expect(sheet.getAttribute("data-open")).toBe("true");
  expect(sheet.querySelectorAll("a").length).toBe(TABS.length);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(sheet.getAttribute("data-open")).toBe("false");
  fireEvent.click(button);
  fireEvent.click(sheet.querySelector("a")!);
  expect(sheet.getAttribute("data-open")).toBe("false");
});

test("a wordmark with onHome navigates in-app instead of reloading", () => {
  const onHome = vi.fn();
  render(<Chrome wordmark="Elixir Clan" tabs={[]} onHome={onHome} />);
  const ev = fireEvent.click(screen.getByText("Elixir Clan"));
  expect(ev).toBe(false);
  expect(onHome).toHaveBeenCalled();
});
