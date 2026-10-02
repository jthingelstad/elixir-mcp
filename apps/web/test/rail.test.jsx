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
import {
  ACCOUNT_RAIL,
  ADMIN_RAIL,
  App,
  RAIL,
  RAIL_FOOT,
  DOC_LINKS,
  agentRail,
  legalRoute,
  railConsoles,
  railPosition,
} from "../src/App.jsx";

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

/** Every destination the rails offer, as [railKey, sub, path]: yours and
 *  its foot, an agent's console (2026-09-23), Admin's and Account
 *  settings (2026-09-29), which all obey the same rules. */
const AGENT_RAIL = agentRail("abcd1234");
const RAILS = [RAIL, AGENT_RAIL, ADMIN_RAIL, ACCOUNT_RAIL];
const destinations = [...RAILS.flat(), RAIL_FOOT].flatMap((row) => [
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
      (at.doc && DOC_LINKS[at.doc]) ??
      DOC_LINKS[at.sub ? `${at.key}:${at.sub}` : at.key] ??
      DOC_LINKS[at.key];
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
  for (const rail of RAILS) {
    const tops = rail.map((r) => r.label);
    expect(new Set(tops).size, "two sections share a label").toBe(tops.length);
  }
  expect(RAIL.map((r) => r.label)).not.toContain(RAIL_FOOT.label);
  for (const row of RAILS.flat()) {
    const subs = (row.subs ?? []).map(([, label]) => label);
    expect(
      new Set(subs).size,
      `opening ${row.label} shows two sub-items with one label`,
    ).toBe(subs.length);
  }
});

test("Timeline sits between Overview and Explore, in the ungrouped top", () => {
  // Jamie, 2026-09-23: the timeline is a place of its own, not
  // Activity's first view, and the unread dot moved with it.
  const top = RAIL.slice(
    0,
    RAIL.findIndex((r) => r.group),
  );
  expect(top.map((r) => r.key)).toEqual(["overview", "timeline", "explore"]);
  expect(railPosition("/console/account/timeline")).toEqual({
    key: "timeline",
  });
});

test("your console: nine items in three groups, feedback at the foot", () => {
  // The ConsoleRail board's proposed column (2026-09-29).
  expect(RAIL.map((r) => r.label)).toEqual([
    "Overview",
    "Timeline",
    "Explore",
    "Tracking",
    "Collections",
    "Verify",
    "Connections",
    "Usage",
    "Status",
  ]);
  expect(RAIL.filter((r) => r.group).map((r) => r.group)).toEqual([
    "Your record",
    "Access",
    "Service",
  ]);
  expect(RAIL_FOOT).toMatchObject({
    label: "Send feedback",
    to: "/console/account/feedback",
  });
});

test("where the rest went: every old address resolves, marked where it lives now", () => {
  const at = (p) => railPosition(p);
  // Activity's three logs.
  expect(at("/console/account/activity/requests")).toMatchObject({
    key: "usage",
    sub: "requests",
  });
  expect(at("/console/account/activity/emails")).toMatchObject({
    rail: "account",
    key: "emails",
    sub: "emails",
  });
  expect(at("/console/account/activity/e/x")).toMatchObject({
    rail: "account",
    key: "emails",
    doc: "activity:email",
  });
  expect(at("/console/account/activity/events")).toMatchObject({
    rail: "account",
    key: "signins",
    sub: "events",
  });
  // Profile and its pages are Account settings.
  expect(at("/console/account/profile")).toMatchObject({
    rail: "account",
    key: "profile",
  });
  expect(at("/console/account/profile/email")).toMatchObject({
    rail: "account",
    key: "emails",
  });
  expect(at("/console/account/profile/devices")).toMatchObject({
    rail: "account",
    key: "devices",
  });
  // Agents are Connections; Admin is its own console.
  expect(at("/console/account/agents")).toMatchObject({ key: "connections" });
  expect(at("/console/admin/emails")).toMatchObject({
    rail: "admin",
    key: "emails",
  });
  expect(at("/console/admin")).toMatchObject({
    rail: "admin",
    key: "requests",
  });
  for (const p of [
    "/console/account/activity/requests",
    "/console/account/activity/emails",
    "/console/account/activity/events",
    "/console/account/profile/email",
    "/console/account/profile/devices",
    "/console/account/agents",
    "/console/account/feedback",
  ])
    expect(legalRoute(p), p).toBe(p);
});

test("the switcher: you, your agents, and Admin for an admin", () => {
  const me = {
    ...ME,
    claims: [{ player_tag: "#P", name: "King Thing", is_primary: true }],
    agents: [{ public_id: "f43c60e8f5bd", name: "POAP KINGS", role: "leader" }],
  };
  expect(
    railConsoles(me).map((c) => [c.group, c.label, c.detail, c.to]),
  ).toEqual([
    ["You", "Your console", "King Thing · owner", "/console/account/overview"],
    [
      "Your agents",
      "POAP KINGS",
      "agent · f43c60e8f5bd",
      "/console/agent/f43c60e8f5bd/overview",
    ],
    [
      "Operate",
      "Admin console",
      "every account · owner",
      "/console/admin/requests",
    ],
  ]);
  expect(railConsoles({ ...me, is_admin: false }).map((c) => c.key)).toEqual([
    "me",
    "f43c60e8f5bd",
  ]);
});

test("wide: the rail is a list, with no disclosure to open", async () => {
  window.history.pushState({}, "", "/console/account/overview");
  render(<App />);
  await waitFor(() =>
    expect(screen.getByRole("navigation", { name: "Console sections" })),
  );
  // Scoped to the rail: the top bar has its own expandable button now
  // (the narrow menu), which is a different control on a different
  // element and is present at every width.
  // The only button in it is the console switcher, never a disclosure
  // over the list.
  const rail = document.querySelector(".rail");
  expect(rail.querySelector(".rail__toggle")).toBeNull();
  expect(
    within(rail)
      .getAllByRole("button")
      .every((b) => b.classList.contains("rail__switch-head")),
  ).toBe(true);
  expect(within(rail).getByRole("link", { name: /Tracking/ })).toBeTruthy();
});

test("narrow: the rail is a disclosure above the content, not a drawer", async () => {
  vi.stubGlobal("matchMedia", (q) => ({
    matches: q === "(max-width: 900px)",
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  window.history.pushState({}, "", "/console/account/overview");
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
  window.history.pushState({}, "", "/console/account/usage");
  render(<App />);
  // Usage is about budgets; the strip must say so rather than "docs".
  expect(await screen.findByText(/Docs · Budgets/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Limits" })).toBeTruthy();
});

test("an agent's console: its pages and nothing of a person's, one segment along", () => {
  expect(AGENT_RAIL.map((r) => r.key)).toEqual([
    "overview",
    "timeline",
    "tracking",
    "activity",
    "usage",
    "connections",
    "settings",
    "feedback",
  ]);
  expect(railPosition("/console/agent/abcd1234/timeline")).toEqual({
    scope: "abcd1234",
    key: "timeline",
  });
  expect(railPosition("/console/agent/abcd1234/activity/c/x")).toMatchObject({
    key: "activity",
    sub: "requests",
    doc: "activity:call",
  });
  // A page an agent does not have lands on its Overview; an id that is not
  // a public id's shape is not an app route at all.
  expect(legalRoute("/console/agent/abcd1234/verify")).toBe(
    "/console/agent/abcd1234/overview",
  );
  expect(legalRoute("/console/agent/abcd1234")).toBe(
    "/console/agent/abcd1234/overview",
  );
  expect(legalRoute("/console/agent/NOPE/timeline")).toBe(null);
});
