import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountMenu, initialsOf, type ChromeAccount } from "../src/index.ts";

afterEach(cleanup);

const ACCOUNT: ChromeAccount = {
  name: "Fixture One",
  email: "reader@example.test",
  players: [
    {
      key: "#2ABC",
      name: "Fixture One",
      tag: "#2ABC",
      primary: true,
      href: "/ladder/season?player=2ABC",
    },
    {
      key: "#2DEF",
      name: "Fixture Two",
      note: "Also you",
      href: "/ladder/season?player=2DEF",
    },
  ],
  playersFoot: { label: "Add or verify a player", href: "/verify" },
  links: [
    {
      key: "settings",
      icon: "user-round",
      label: "Settings",
      href: "/settings",
    },
  ],
  signOut: { label: "Sign out", note: "Ends this session.", onClick: vi.fn() },
};

test("the menu names the person, lists the players, and following a link closes it", () => {
  const onClose = vi.fn();
  render(<AccountMenu account={ACCOUNT} onClose={onClose} />);
  const menu = document.getElementById("account-menu")!;
  expect(menu.textContent).toContain("reader@example.test");
  const players = [...menu.querySelectorAll(".account-menu__player")];
  expect(players.map((a) => a.getAttribute("href"))).toEqual([
    "/ladder/season?player=2ABC",
    "/ladder/season?player=2DEF",
  ]);
  expect(players[1]!.textContent).toContain("Also you");
  fireEvent.click(screen.getByRole("link", { name: /Settings/ }));
  expect(onClose).toHaveBeenCalled();
});

test("a product's sign-out can be a form post", () => {
  render(
    <AccountMenu
      account={{
        ...ACCOUNT,
        signOut: { label: "Sign out", action: "/api/auth/logout" },
      }}
      onClose={() => {}}
    />,
  );
  const button = screen.getByRole("button", { name: /Sign out/ });
  const form = button.closest("form")!;
  expect(form.getAttribute("method")).toMatch(/post/i);
  expect(form.getAttribute("action")).toBe("/api/auth/logout");
});

test("initials: the first letters of two words, or the first two of one", () => {
  expect(initialsOf("Fixture One")).toBe("FO");
  expect(initialsOf("Fixture")).toBe("FI");
});
