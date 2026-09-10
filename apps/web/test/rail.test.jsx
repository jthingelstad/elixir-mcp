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
} from "@testing-library/react";
import { App, RAIL, DOC_LINKS, legalRoute, railPosition } from "../src/App.jsx";

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

/** Every destination the rail offers, as [railKey, sub, path]. */
const destinations = RAIL.flatMap((row) => [
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
    const at = railPosition(to);
    expect(at.key, `${to} marks ${at.key}, not ${key}`).toBe(key);
    // A section with sub-pages lands on its first one, so the parent's
    // own destination is allowed to resolve to that sub.
    if (sub) expect(at.sub, `${to} marks sub ${at.sub}`).toBe(sub);
  }
});

test("every rail destination has its own docs strip entry", () => {
  // The strip replaced an ad-hoc "learn more" that sat somewhere
  // different on each screen, so a page with no entry is a bug rather
  // than a fallback: nothing may fall through to a generic docs index.
  for (const [, , to] of destinations) {
    // Derive the key the way the app does, from the position the path
    // resolves to: a section that lands on its first sub-page is keyed
    // on that sub, not on the bare section.
    const at = railPosition(to);
    const entry =
      DOC_LINKS[at.sub ? `${at.key}:${at.sub}` : at.key] ?? DOC_LINKS[at.key];
    expect(entry, `${to} has no docs strip entry`).toBeTruthy();
    const [topic, links] = entry;
    expect(typeof topic).toBe("string");
    expect(links.length).toBeGreaterThan(0);
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
  const tops = RAIL.map((r) => r.label);
  expect(new Set(tops).size, "two sections share a label").toBe(tops.length);
  for (const row of RAIL) {
    const subs = (row.subs ?? []).map(([, label]) => label);
    expect(
      new Set(subs).size,
      `opening ${row.label} shows two sub-items with one label`,
    ).toBe(subs.length);
  }
});

test("wide: the rail is a list, with no disclosure to open", async () => {
  window.history.pushState({}, "", "/account/overview");
  render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("navigation", { name: "Console sections" })),
  );
  // Scoped to the rail: the top bar has its own expandable button now
  // (the narrow menu), which is a different control on a different
  // element and is present at every width.
  const rail = document.querySelector(".rail");
  expect(within(rail).queryByRole("button", { expanded: false })).toBeNull();
  expect(screen.getByRole("link", { name: /Tracking/ })).toBeTruthy();
});

test("narrow: the rail is a disclosure above the content, not a drawer", async () => {
  vi.stubGlobal("matchMedia", (q) => ({
    matches: q === "(max-width: 900px)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.history.pushState({}, "", "/account/overview");
  render(<App />);

  // Closed, it names the section and hides the list — and it is a
  // sibling of the content, never positioned over it.
  const rail = await waitFor(() => {
    const el = document.querySelector(".rail");
    expect(el).toBeTruthy();
    return el;
  });
  const toggle = within(rail).getByRole("button", { expanded: false });
  expect(toggle.textContent).toContain("Overview");
  expect(
    screen.queryByRole("navigation", { name: "Console sections" }),
  ).toBeNull();

  const main = document.querySelector("main");
  expect(
    rail.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  toggle.click();
  await waitFor(() =>
    expect(screen.getByRole("navigation", { name: "Console sections" })),
  );
});

test("the docs strip is on the page, and it is the page's own entry", async () => {
  window.history.pushState({}, "", "/account/usage");
  render(<App />);
  // Usage is about budgets; the strip must say so rather than "docs".
  expect(await screen.findByText(/Docs · Budgets/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Limits" })).toBeTruthy();
});
