import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { App, barArea, createAppRuntime } from "../src/App.jsx";
import { barAccount } from "../src/shell/Shell.jsx";

configure({ asyncUtilTimeout: 5000 });

const keys = (me) => barAccount(me, () => {}).links.map((l) => l.key);

test("the avatar menu: Play Drop always, Admin only for staff", () => {
  expect(keys({ claims: [] })).toContain("drop");
  expect(keys({ claims: [] })).not.toContain("admin");
  expect(keys({ claims: [], is_admin: true })).toContain("admin");
});

test("the menu's players are your own: a friend or a watch is not one", () => {
  const account = barAccount(
    {
      claims: [
        { player_tag: "#A", name: "Ada", is_primary: true },
        { player_tag: "#B", name: "Alt", relationship: "alt" },
        { player_tag: "#C", name: "Friend", relationship: "friend" },
        { player_tag: "#D", name: "Watch", relationship: "watching" },
      ],
    },
    () => {},
  );
  expect(account.name).toBe("Ada");
  expect(account.players.map((p) => [p.key, p.note])).toEqual([
    ["#A", "Your main player"],
    ["#B", "Also you"],
  ]);
  expect(account.links.map((l) => l.key)).not.toContain("add");
});

test("no player: the menu offers to add one", () => {
  expect(keys({ claims: [] })).toContain("add");
  expect(barAccount({ claims: [] }, () => {}).name).toBe("Your account");
});

// The whole App's bar, tabs and footer, on every page (redesign step 3b).
describe("the bar on a page", () => {
  let me;
  beforeEach(() => {
    cleanup();
    me = { authenticated: false };
    vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn(async (path) => {
      const body = String(path) === "/api/me" ? me : {};
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
    window.history.pushState({}, "", "/console/explore");
  });
  afterEach(() => vi.restoreAllMocks());

  const SIGNED_IN = {
    authenticated: true,
    email: "reader@example.test",
    role: "owner",
    timezone: "America/Chicago",
    claims: [
      { player_tag: "#2ABC", name: "Fixture One", is_primary: true },
      {
        player_tag: "#2DEF",
        name: "Fixture Two",
        is_primary: false,
        relationship: "alt",
      },
      // Tracked, not theirs: never under "Your players".
      {
        player_tag: "#2GHI",
        name: "Fixture Friend",
        is_primary: false,
        relationship: "friend",
      },
    ],
    signals: {},
  };

  test(
    "signed in: Home, Find and Clan, the search prompt, help, the bell, Drop, and tabs for the phone",
    { timeout: 20000 },
    async () => {
      me = SIGNED_IN;
      render(<App />);
      const nav = await screen.findByRole("navigation", { name: "Main" });
      expect(
        [...nav.querySelectorAll("a")].map((a) => [
          a.textContent,
          a.getAttribute("href"),
        ]),
      ).toEqual([
        ["Home", "/home"],
        ["Find", "/home/find"],
        ["Clan", "/clan"],
      ]);
      const bar = document.querySelector(".kit-top");
      // Search and Help open in place: no address to leave for.
      expect(bar.querySelector(".kit-top__search").tagName).toBe("BUTTON");
      expect(
        within(bar).getByRole("button", { name: "Help for this page" }),
      ).toBeTruthy();
      // The bell opens what needs you in place; nothing does, so no dot.
      const bell = within(bar).getByRole("button", { name: "Notifications" });
      expect(bell.getAttribute("aria-haspopup")).toBe("dialog");
      expect(bell.querySelector(".kit-bell__dot")).toBeNull();
      // Play Drop left the bar (2026-11-12): it is in the You menu and the
      // footer.
      expect(within(bar).queryByRole("link", { name: /Play Drop/ })).toBeNull();
      const foot = document.querySelector("footer");
      expect(within(foot).getByRole("link", { name: /Drop/ })).toBeTruthy();
      const tabs = screen.getByRole("navigation", { name: "Main, phone" });
      expect(
        [...tabs.querySelectorAll("a, button")].map((a) => a.textContent),
      ).toEqual(["Home", "Find", "Clan", "You", "Bell"]);
      // On Explore's charts, Find is the lit tab.
      expect(tabs.querySelector("[aria-current]").textContent).toBe("Find");
    },
  );

  test(
    "news since Home was last opened marks the Home tab, in words too",
    { timeout: 20000 },
    async () => {
      me = { ...SIGNED_IN, signals: { timeline_pending: 3 } };
      render(<App />);
      const nav = await screen.findByRole("navigation", { name: "Main" });
      const home = [...nav.querySelectorAll("a")].find(
        (a) => a.getAttribute("href") === "/home",
      );
      expect(home.querySelector(".kit-bell__dot")).toBeTruthy();
      expect(home.getAttribute("aria-label")).toBe("Home, new items");
      const find = [...nav.querySelectorAll("a")].find(
        (a) => a.getAttribute("href") === "/home/find",
      );
      expect(find.querySelector(".kit-bell__dot")).toBeNull();
    },
  );

  test(
    "signed out: Docs, Sign in and Create account, and no tabs",
    { timeout: 20000 },
    async () => {
      render(<App />);
      const nav = await screen.findByRole("navigation", { name: "Main" });
      // The canvas's signed-out bar (2026-11-12): Logo, Docs, Sign in,
      // Create account. Cards and Updates are in the footer, still public.
      expect([...nav.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
        "Docs",
      ]);
      const foot = document.querySelector("footer");
      for (const name of ["Cards", "Updates"])
        expect(within(foot).getByRole("link", { name })).toBeTruthy();
      const bar = document.querySelector(".kit-top");
      expect(
        within(bar).getByRole("link", { name: "Sign in" }).getAttribute("href"),
      ).toBe("/signin");
      expect(
        within(bar)
          .getByRole("link", { name: "Create account" })
          .getAttribute("href"),
      ).toBe("/signin?signup");
      expect(
        screen.queryByRole("navigation", { name: "Main, phone" }),
      ).toBeNull();
    },
  );

  test(
    "the footer carries the disclaimer word for word",
    { timeout: 20000 },
    async () => {
      render(<App />);
      await screen.findByRole("navigation", { name: "Main" });
      expect(document.querySelector(".kit-foot").textContent).toContain(
        "This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.",
      );
      expect(document.querySelector(".kit-foot").textContent).not.toMatch(
        /Console/,
      );
    },
  );

  test(
    "signed in, the account slot is the person, and the menu holds the way out",
    { timeout: 20000 },
    async () => {
      me = SIGNED_IN;
      render(<App />);
      const button = await screen.findByRole("button", {
        name: /^Account:\s*Fixture One$/,
      });
      fireEvent.click(button);
      const menu = document.getElementById("account-menu");
      expect(
        [...menu.querySelectorAll(".account-menu__player")].map(
          (a) => a.textContent,
        ),
      ).toEqual([
        expect.stringContaining("Fixture One"),
        expect.stringContaining("Fixture Two"),
      ]);
      expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
      // Escape closes it and returns to the button that opened it.
      fireEvent.keyDown(document, { key: "Escape" });
      expect(document.getElementById("account-menu")).toBeNull();
      expect(document.activeElement).toBe(button);
      // A click outside closes it too.
      fireEvent.click(button);
      fireEvent.mouseDown(document.body);
      expect(document.getElementById("account-menu")).toBeNull();
    },
  );

  test(
    "a signed-in reader who follows Sign in goes on to Home",
    { timeout: 20000 },
    async () => {
      me = { authenticated: true, email: "reader@example.test", signals: {} };
      window.history.pushState({}, "", "/signin");
      render(<App />);
      await waitFor(() => expect(window.location.pathname).toBe("/home"));
    },
  );

  test(
    "an old sign-in address, with its query, lands on the new one",
    { timeout: 20000 },
    async () => {
      window.history.pushState({}, "", "/console/signin?signup");
      render(<App />);
      await waitFor(() => expect(window.location.pathname).toBe("/signin"));
      expect(window.location.search).toContain("signup");
    },
  );

  test(
    "an address the app never had says so, in its own shell",
    { timeout: 20000 },
    async () => {
      window.history.pushState({}, "", "/console/not-a-place");
      render(<App />);
      expect(await screen.findByText("Nothing at this address")).toBeTruthy();
      expect(document.querySelector(".kit-top")).toBeTruthy();
      expect(document.querySelector(".kit-foot")).toBeTruthy();
    },
  );

  test(
    "a staff page: the wall signed out, staff-only signed in, and never its content",
    { timeout: 20000 },
    async () => {
      window.history.pushState({}, "", "/console/admin/requests");
      render(<App runtime={createAppRuntime()} />);
      expect(await screen.findByText("Sign in first")).toBeTruthy();
      cleanup();
      me = { authenticated: true, email: "reader@example.test", signals: {} };
      window.history.pushState({}, "", "/console/admin/requests");
      render(<App runtime={createAppRuntime()} />);
      expect(await screen.findByText(/for Elixir’s staff/)).toBeTruthy();
    },
  );

  test("the bar's place follows the route, and a battle's page lights none", () => {
    expect(barArea("/home")).toBe("home");
    expect(barArea("/home/find")).toBe("find");
    expect(barArea("/home/you/")).toBe("you");
    // Ladder is your stats, reached from You.
    expect(barArea("/home/you/stats/decks")).toBe("you");
    expect(barArea("/clan/you")).toBe("clan");
    expect(barArea("/console/explore/player/2ABC")).toBe("find");
    expect(barArea("/console/account/profile")).toBeUndefined();
    expect(barArea("/signin")).toBeUndefined();
    expect(barArea("/battle/a1b2c3d4e5f6")).toBeUndefined();
  });
});
