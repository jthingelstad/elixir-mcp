import { test, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Chrome, FAMILY_PRODUCTS } from "../src/index.ts";

afterEach(cleanup);

const TABS = [
  { label: "Home", href: "/" },
  { label: "Docs", href: "/docs" },
];

test("the bar carries the wordmark, the tabs, and the product buttons outside any menu", () => {
  render(<Chrome wordmark="Elixir" tabs={TABS} current="console" />);
  expect(screen.getByText("Elixir").getAttribute("href")).toBe("/");
  const nav = screen.getByRole("navigation", { name: "Elixir" });
  expect(nav.querySelectorAll("a").length).toBe(2);
  // The family's three products, in the bar, in order.
  const [console, clan, drop] = [
    ...document.querySelectorAll(".chrome__product"),
  ] as [HTMLAnchorElement, HTMLAnchorElement, HTMLAnchorElement];
  expect([console, clan, drop].map((a) => a.textContent)).toEqual([
    "Console",
    "Clan",
    "Drop",
  ]);
  expect(console.closest(".chrome__inner")).toBeTruthy();
  // The one we are inside is marked current; the others are not.
  expect(console.getAttribute("aria-current")).toBe("page");
  expect(clan.getAttribute("aria-current")).toBeNull();
  // Drop is the game: a new window, and the link says so.
  expect(drop.getAttribute("target")).toBe("_blank");
  expect(drop.getAttribute("rel")).toBe("noopener");
  expect(drop.getAttribute("aria-label")).toMatch(/new window/);
  expect(drop.querySelectorAll("svg").length).toBe(2);
  // No menu unless asked for.
  expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
});

test("an app overrides its own product to route in-app", () => {
  const onClick = vi.fn((e) => e.preventDefault());
  const products = FAMILY_PRODUCTS.map((p) =>
    p.key === "clan" ? { ...p, href: "/", onClick } : p,
  );
  render(
    <Chrome wordmark="Elixir" tabs={[]} products={products} current="clan" />,
  );
  const clan = screen.getByText("Clan").closest("a")!;
  expect(clan.getAttribute("href")).toBe("/");
  fireEvent.click(clan);
  expect(onClick).toHaveBeenCalled();
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
