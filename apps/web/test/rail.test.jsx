/**
 * The rail, as the 2026-09-09 handoff specifies it.
 *
 * Step 2's own acceptance is "every rail item and sub-item routes
 * somewhere, at both widths", and three of the house rules it must obey
 * are the kind that only break later: a docs strip entry that falls
 * through to a generic link, two visible items sharing a label
 * (navigation broke twice this way during design), and a current item
 * that resolves to the wrong section so the gold rule marks one page
 * while the reader is on another.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  within,
  configure,
} from "@testing-library/react";
import { ADMIN_RAIL, App, legalRoute } from "../src/App.jsx";
import {
  AGENT_TABS,
  SETTINGS_RAIL,
  settingsHere,
} from "../src/lib/settings.js";
import { helpFor } from "../src/shell/help.js";
import { DOC_LINKS } from "../src/shell/doc-links.js";

// This file renders the whole App, routes and all, from a cold module
// graph. Testing Library's 1 s default wait reads a slow first paint on a
// loaded machine as a missing element (first-answer failed so, #488).
// Bound the wait as the other whole-App journeys do
// (account-journeys.test.jsx), with a 20 s bound on each test that renders it.
configure({ asyncUtilTimeout: 5000 });

const ME = {
  authenticated: true,
  is_admin: true,
  is_owner: true,
  role: "owner",
  timezone: "America/Chicago",
  claims: [],
  recordings: [],
};

function mockFetch() {
  return vi.fn(async (path) => {
    const body = String(path) === "/api/me" ? ME : {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}

beforeEach(() => {
  cleanup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = mockFetch();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Every destination the rails offer, as [railKey, sub, path]. */
const RAILS = [ADMIN_RAIL, SETTINGS_RAIL];
const destinations = RAILS.flat().flatMap((row) => [
  [row.key, undefined, row.to],
  ...(row.subs ?? []).map(([slug, , to]) => [row.key, slug, to]),
]);

test("every rail item and sub-item routes somewhere", () => {
  for (const [, , to] of destinations) {
    // legalRoute returning null means "this belongs to the static site",
    // and returning a different path means the route does not exist and
    // the app substituted its section default. Either one is a rail item
    // that does not go where it says.
    expect(legalRoute(to), `${to} is not an app route`).toBe(to);
  }
});

test("a rail destination marks the item that offered it", () => {
  for (const [key, sub, to] of destinations) {
    const at = settingsHere(to);
    // Settings' Admin row is a door: it opens Admin's own rail, which
    // marks the Admin page it lands on.
    if (key === "admin") {
      expect(at.rail, `${to} opens Admin's rail`).toBe("admin");
      continue;
    }
    expect(at.key, `${to} marks ${at.key}, not ${key}`).toBe(key);
    if (sub) expect(at.sub, `${to} marks sub ${at.sub}`).toBe(sub);
  }
});

test("every rail destination has its own help and read more", () => {
  // A page's help replaced the docs strip, so a page with no entry is a bug
  // rather than a fallback.
  for (const [, , to] of destinations) {
    const help = helpFor(to);
    expect(help.lines.length, `${to} has no help`).toBeGreaterThan(0);
    expect(help.title, to).not.toBe("this page");
    const [, links] = DOC_LINKS[help.docs] ?? [];
    expect(links?.length, `${to} has no read more`).toBeGreaterThan(0);
  }
});

test("no two items at the same level share a label", () => {
  // Sub-items render only while their own section is current, which is
  // how Service > Collectors and Admin > Collectors coexist. So the
  // check is per open section.
  //
  // NARROWED 2026-09-10 (Jamie: "Connections across accounts" in the nav
  // is "crazy long and odd"). The rule guards against AMBIGUITY, and a
  // sub is not ambiguous with a top-level item: it renders indented
  // under its section's row, which is on screen one line above it, and
  // the page it opens carries that section as its crumb. Admin >
  // Connections and Account > Connections are two readable places.
  // What stays banned is a collision at ONE level, where nothing on
  // screen tells them apart.
  for (const rail of RAILS) {
    const tops = rail.map((r) => r.label);
    expect(new Set(tops).size, "two sections share a label").toBe(tops.length);
  }
  for (const row of RAILS.flat()) {
    const subs = (row.subs ?? []).map(([, label]) => label);
    expect(
      new Set(subs).size,
      `opening ${row.label} shows two sub-items with one label`,
    ).toBe(subs.length);
  }
});

test("Settings' rail: eight places, Collectors for who runs one, Admin for staff", () => {
  expect(SETTINGS_RAIL.map((r) => r.label)).toEqual([
    "Profile",
    "What members see",
    "Players & tracking",
    "Emails",
    "Connections & agents",
    "Sign-ins & devices",
    "Usage and limits",
    "Feedback",
    "Collectors",
    "Admin",
  ]);
  expect(SETTINGS_RAIL.filter((r) => r.runsOne).map((r) => r.key)).toEqual([
    "collectors",
  ]);
  // Admin is drawn for staff only (the server gates every Admin read).
  expect(SETTINGS_RAIL.filter((r) => r.adminOnly).map((r) => r.key)).toEqual([
    "admin",
  ]);
});

test("a page says which rail it wears", () => {
  expect(settingsHere("/settings/usage").key).toBe("usage");
  expect(settingsHere("/settings/admin/emails").rail).toBe("admin");
});

test(
  "wide: the rail is a list, with no disclosure to open",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/settings/profile");
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Settings sections" })),
    );
    // No switcher, no foot, and no disclosure over the list.
    const rail = document.querySelector(".rail");
    expect(rail.querySelector(".rail__toggle")).toBeNull();
    expect(within(rail).queryAllByRole("button")).toEqual([]);
    expect(within(rail).getByRole("link", { name: /Players/ })).toBeTruthy();
  },
);

// The Console folded (2026-11-12): Admin is a Settings section drawn for
// staff only. The server gates every Admin read; the client must not
// offer the door to anyone else.
test(
  "Settings' rail offers Admin to staff, and to nobody else",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/settings/profile");
    render(<App />);
    const staff = await waitFor(() =>
      screen.getByRole("navigation", { name: "Settings sections" }),
    );
    expect(
      within(staff).getByRole("link", { name: /Admin/ }).getAttribute("href"),
    ).toBe("/settings/admin/accounts");
    cleanup();
    global.fetch = vi.fn(async (path) => {
      const body = String(path) === "/api/me" ? { ...ME, is_admin: false } : {};
      return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
      };
    });
    window.history.pushState({}, "", "/settings/profile");
    render(<App />);
    const member = await waitFor(() =>
      screen.getByRole("navigation", { name: "Settings sections" }),
    );
    expect(within(member).getByRole("link", { name: /Profile/ })).toBeTruthy();
    expect(within(member).queryByRole("link", { name: /Admin/ })).toBeNull();
  },
);

test(
  "Help opens in place, says this page, and a note carries the page along",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/settings/usage");
    render(<App />);
    const bar = await waitFor(() => {
      const el = document.querySelector(".kit-top__icon");
      expect(el).toBeTruthy();
      return el;
    });
    bar.click();
    // jsdom has <dialog> and not its modal, so it is read as an element.
    const drawer = await waitFor(() => {
      const d = document.querySelector("dialog.kit-help");
      expect(d).toBeTruthy();
      return d;
    });
    expect(drawer.textContent).toContain("Help for Usage and limits");
    expect(drawer.textContent).toContain("The page you are on rides along.");
    expect(window.location.pathname).toBe("/settings/usage");
    expect(
      within(drawer)
        .getByRole("link", {
          name: "Your feedback and its answers",
          hidden: true,
        })
        .getAttribute("href"),
    ).toBe("/settings/feedback");
    expect(
      within(drawer)
        .getByRole("link", { name: "Limits", hidden: true })
        .getAttribute("href"),
    ).toBe("/docs/limits");
  },
);

test(
  "narrow: the rail is a disclosure above the content, not a drawer",
  { timeout: 20000 },
  async () => {
    vi.stubGlobal("matchMedia", (q) => ({
      matches: q === "(max-width: 900px)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    window.history.pushState({}, "", "/settings/profile");
    render(<App />);

    // Closed, it names the section and hides the list — and it is a
    // sibling of the content, never positioned over it.
    const rail = await waitFor(() => {
      const el = document.querySelector(".rail");
      expect(el).toBeTruthy();
      return el;
    });
    const toggle = within(rail).getByRole("button", { expanded: false });
    expect(toggle.textContent).toContain("Profile");
    expect(
      screen.queryByRole("navigation", { name: "Settings sections" }),
    ).toBeNull();

    const main = document.querySelector("main");
    expect(
      rail.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    toggle.click();
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Settings sections" })),
    );
  },
);

test("an agent: five tabs, its pages resolve, and a wrong page is no page", () => {
  expect(AGENT_TABS.map((t) => t.slug)).toEqual([
    "overview",
    "reads",
    "usage",
    "connections",
    "settings",
  ]);
  expect(settingsHere("/settings/agents/abcd1234/reads")).toMatchObject({
    key: "connections",
    page: "agent",
    agent: "abcd1234",
    tab: "reads",
  });
  expect(
    settingsHere("/settings/agents/abcd1234/usage/requests/x"),
  ).toMatchObject({ page: "call", id: "x", agent: "abcd1234" });
  expect(settingsHere("/settings/agents/abcd1234/usage/events").page).toBe(
    "agent-events",
  );
  expect(settingsHere("/settings/agents/abcd1234/feedback/7")).toMatchObject({
    page: "feedback-item",
    id: "7",
  });
  expect(settingsHere("/settings/agents/abcd1234/timeline").page).toBe(
    "timeline",
  );
  expect(legalRoute("/settings/agents/abcd1234")).toBe(
    "/settings/agents/abcd1234/overview",
  );
  expect(legalRoute("/settings/agents/abcd1234/verify")).toBe(null);
});
