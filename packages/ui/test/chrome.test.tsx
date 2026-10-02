import { test, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Chrome,
  FAMILY_PRODUCTS,
  initialsOf,
  type ChromeAccount,
} from "../src/index.ts";

afterEach(cleanup);

const ACCOUNT: ChromeAccount = {
  name: "King Thing",
  email: "jamie@example.com",
  detail: "owner · America/Chicago",
  players: [
    {
      key: "#20JJJ2CCRU",
      name: "King Thing",
      tag: "#20JJJ2CCRU",
      primary: true,
      href: "/console/explore/player/20JJJ2CCRU",
    },
    {
      key: "#VJQV8G8RL",
      name: "thingles",
      tag: "#VJQV8G8RL",
      href: "/console/explore/player/VJQV8G8RL",
    },
  ],
  playersFoot: { label: "Add or verify a player", href: "/console/verify" },
  links: [
    {
      key: "settings",
      icon: "user-round",
      label: "Account settings",
      href: "/console/account/profile",
    },
  ],
  signOut: { label: "Sign out", note: "Ends this session.", onClick: vi.fn() },
};

test("the bar: logo home, the places on the left, Docs and the game on the right", () => {
  render(<Chrome current="console" account={null} />);
  const home = screen.getByRole("link", { name: "Elixir home" });
  expect(home.getAttribute("href")).toBe("/");
  expect(home.querySelector("img.chrome__logo")).toBeTruthy();
  expect(home.textContent).toBe("Elixir");

  const nav = screen.getByRole("navigation", { name: "Products" });
  const places = [...nav.querySelectorAll("a")];
  expect(places.map((a) => a.textContent)).toEqual([
    "Console",
    "Ladder",
    "Clan",
  ]);
  // The one we are inside is marked current; the others are not.
  expect(places[0]!.getAttribute("aria-current")).toBe("page");
  expect(places[1]!.getAttribute("aria-current")).toBeNull();

  const end = document.querySelector(".chrome__end")!;
  const docs = end.querySelector("a.chrome__docs")!;
  expect(docs.textContent).toBe("Docs");
  // Drop is the game: candy on the right, its own host, a new window,
  // and the label says all three.
  const play = end.querySelector("a.chrome__play")!;
  expect(play.textContent).toBe("Play Drop");
  expect(play.getAttribute("href")).toBe("https://drop.poapkings.com/");
  expect(play.getAttribute("target")).toBe("_blank");
  expect(play.getAttribute("rel")).toBe("noopener");
  expect(play.getAttribute("aria-label")).toBe(
    "Play Drop, the elixir-cost game (opens drop.poapkings.com in a new window)",
  );
  // Drop is never a place on the left.
  expect(nav.textContent).not.toMatch(/Drop/);
});

test("Docs lights up green where the bar is drawn inside the docs", () => {
  render(<Chrome current="docs" account={null} />);
  const docs = document.querySelector(".chrome__end a.chrome__docs")!;
  expect(docs.getAttribute("aria-current")).toBe("page");
  expect(
    screen
      .getByRole("navigation", { name: "Products" })
      .querySelector("[aria-current]"),
  ).toBeNull();
});

test("the account slot is one slot: empty while unknown, Sign in signed out, the person signed in", () => {
  const { rerender } = render(<Chrome current="console" />);
  const slot = () => document.querySelector(".chrome__account")!;
  // Unknown: the slot is there, holding nothing. Never a guess.
  expect(slot()).toBeTruthy();
  expect(slot().children).toHaveLength(0);

  rerender(<Chrome current="console" account={null} />);
  const signIn = screen.getByRole("link", { name: "Sign in" });
  expect(signIn.closest(".chrome__account")).toBe(slot());
  expect(signIn.getAttribute("href")).toBe(
    "https://elixir.poapkings.com/console/signin",
  );

  rerender(<Chrome current="console" account={ACCOUNT} />);
  const me = screen.getByRole("button", { name: "Account: King Thing" });
  expect(me.closest(".chrome__account")).toBe(slot());
  expect(me.textContent).toContain("KT");
  expect(me.textContent).toContain("King Thing");
});

test("the account menu opens from the button, lists the players, and closes on Escape", () => {
  render(<Chrome current="console" account={ACCOUNT} />);
  const me = screen.getByRole("button", { name: "Account: King Thing" });
  expect(me.getAttribute("aria-expanded")).toBe("false");
  expect(document.getElementById("account-menu")).toBeNull();

  fireEvent.click(me);
  expect(me.getAttribute("aria-expanded")).toBe("true");
  const menu = document.getElementById("account-menu")!;
  expect(menu.textContent).toContain("jamie@example.com");
  expect(menu.textContent).toContain("owner · America/Chicago");
  const players = [...menu.querySelectorAll(".account-menu__player")];
  expect(players.map((p) => p.getAttribute("href"))).toEqual([
    "/console/explore/player/20JJJ2CCRU",
    "/console/explore/player/VJQV8G8RL",
  ]);
  // The star is the primary's alone.
  expect(players[0]!.querySelector("svg")).toBeTruthy();
  expect(players[1]!.querySelector("svg")).toBeNull();
  expect(
    screen.getByRole("link", { name: /Account settings/ }).getAttribute("href"),
  ).toBe("/console/account/profile");

  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(ACCOUNT.signOut.onClick).toHaveBeenCalled();

  fireEvent.keyDown(window, { key: "Escape" });
  expect(document.getElementById("account-menu")).toBeNull();
  expect(document.activeElement).toBe(me);
});

test("a click outside closes the account menu; following a link in it does too", () => {
  render(<Chrome current="console" account={ACCOUNT} />);
  const me = screen.getByRole("button", { name: "Account: King Thing" });
  fireEvent.click(me);
  fireEvent.pointerDown(document.body);
  expect(document.getElementById("account-menu")).toBeNull();
  fireEvent.click(me);
  fireEvent.click(screen.getByRole("link", { name: /Account settings/ }));
  expect(document.getElementById("account-menu")).toBeNull();
});

test("a product's sign-out can be a form post", () => {
  render(
    <Chrome
      current="clan"
      account={{
        name: "Ada",
        signOut: { label: "Sign out", action: "/api/clan/auth/logout" },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Account: Ada" }));
  const form = screen
    .getByRole("button", { name: "Sign out" })
    .closest("form")!;
  expect(form.getAttribute("method")).toBe("post");
  expect(form.getAttribute("action")).toBe("/api/clan/auth/logout");
});

test("an app overrides its own product to route in-app", () => {
  const onClick = vi.fn((e) => e.preventDefault());
  const products = FAMILY_PRODUCTS.map((p) =>
    p.key === "clan" ? { ...p, href: "/clan", onClick } : p,
  );
  render(<Chrome products={products} current="clan" />);
  const clan = screen
    .getByRole("navigation", { name: "Products" })
    .querySelector('a[aria-current="page"]')!;
  expect(clan.getAttribute("href")).toBe("/clan");
  fireEvent.click(clan);
  expect(onClick).toHaveBeenCalled();
});

test("narrow: one button names where you are and opens a sheet with every place, Docs and the game", () => {
  render(<Chrome current="console" account={null} />);
  const button = screen.getByRole("button", { name: "Product: Console" });
  const sheet = document.getElementById("chrome-sheet")!;
  expect(sheet.getAttribute("data-open")).toBe("false");
  // The links are in the markup either way: a crawler and a reader with
  // no JavaScript both still find them.
  expect([...sheet.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
    "Console",
    "Ladder",
    "Clan",
    "Docs",
    "Play Drop",
  ]);
  expect(sheet.querySelector('a[aria-current="page"]')!.textContent).toBe(
    "Console",
  );
  fireEvent.click(button);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(sheet.getAttribute("data-open")).toBe("true");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(sheet.getAttribute("data-open")).toBe("false");
  fireEvent.click(button);
  fireEvent.click(sheet.querySelector("a")!);
  expect(sheet.getAttribute("data-open")).toBe("false");
});

test("drawn inside nothing, the narrow button says Menu", () => {
  render(<Chrome account={null} />);
  expect(screen.getByRole("button", { name: "Menu" })).toBeTruthy();
});

test("a home with onHome navigates in-app instead of reloading", () => {
  const onHome = vi.fn();
  render(<Chrome onHome={onHome} />);
  const ev = fireEvent.click(screen.getByRole("link", { name: "Elixir home" }));
  expect(ev).toBe(false);
  expect(onHome).toHaveBeenCalled();
});

test("initials: the first letters of two words, or the first two of one", () => {
  expect(initialsOf("King Thing")).toBe("KT");
  expect(initialsOf("thingles")).toBe("TH");
  expect(initialsOf("  Big  Thing Three ")).toBe("BT");
  expect(initialsOf("jamie@example.com")).toBe("JA");
});

// apps/site's base.njk draws this bar too, and its test pins the built
// bar to this same shape: the blocks in this order, whoever is signed in.
test("the bar's blocks, in order, the same signed in, signed out and unknown", () => {
  const shape = () =>
    [...document.querySelector(".chrome__inner")!.children].map((el) =>
      el.getAttribute("class"),
    );
  const want = [
    "chrome__home",
    "chrome__rule",
    "chrome__nav",
    "chrome__menu",
    "chrome__end",
  ];
  const { rerender } = render(<Chrome />);
  expect(shape()).toEqual(want);
  rerender(<Chrome account={null} />);
  expect(shape()).toEqual(want);
  rerender(<Chrome account={ACCOUNT} />);
  expect(shape()).toEqual(want);
});
