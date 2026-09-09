/**
 * Every signed-in route, rendered against data it does not expect.
 *
 * Reported symptom: blank pages with a console error while logged in. That is
 * the signature of a render throw in an app that had NO error boundary --
 * React unmounts the whole tree, so one component's bad assumption took the
 * entire page down, navigation included, leaving no way forward but retyping
 * a URL.
 *
 * These mocks are deliberately WRONG-SHAPED. That is the point: this does not
 * assert that a view renders correctly (it cannot -- it has no real
 * fixtures), it asserts that a view which blows up is CONTAINED. The nav must
 * survive and the error must be readable, whatever the server said.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { App, SECTIONS } from "../src/App.jsx";

const ME = {
  authenticated: true,
  is_admin: true,
  is_owner: true,
  role: "owner",
  account_id: "00000000-0000-0000-0000-000000000001",
};

// Well-formed JSON that is nonetheless not what any view is expecting.
const UNEXPECTED = {};

function permissiveFetch() {
  return vi.fn(async (path) => {
    const body = path === "/api/me" ? ME : UNEXPECTED;
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
  // React logs caught boundary errors; that is expected here, not a failure.
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = permissiveFetch();
});
afterEach(() => vi.restoreAllMocks());

const routes = [];
for (const [section, def] of Object.entries(SECTIONS)) {
  if (def.pages.length === 0) routes.push(`/${section}`);
  for (const page of def.pages)
    if (!page.static) routes.push(`/${section}/${page.slug}`);
}

/**
 * Detail pages, which the section walk above cannot discover.
 *
 * AgentDetail shipped referencing a hook Dashboard.jsx did not import, and
 * every check in the repo passed: `verify` was green, the route sweep covered
 * /account/agents and stopped there. A page nothing renders is a page nothing
 * tests.
 */
routes.push(
  "/account/agents/00000000-0000-0000-0000-0000000000ag",
  "/account/feedback/1",
  "/admin/accounts/00000000-0000-0000-0000-000000000001",
  "/explore/player/2ABC",
);

for (const route of routes) {
  test(`signed in, ${route} survives data it did not expect`, async () => {
    window.history.pushState({}, "", route);
    render(<App />);
    // The navigation is the thing that must never disappear: without it a
    // failed page is a dead end rather than a bad page.
    // Two navs by design: tier 1 is the site row, tier 2 the section's pages.
    await waitFor(() =>
      expect(screen.getAllByRole("navigation").length).toBeGreaterThan(0),
    );
    const nav = screen.getAllByRole("navigation")[0];
    expect(nav.textContent.length, `nav vanished on ${route}`).toBeGreaterThan(
      0,
    );
    // Either the view coped, or the boundary caught it and said so. What must
    // not happen is an empty main with no explanation.
    const main = document.querySelector("main");
    expect(
      (main?.textContent ?? "").trim().length,
      `blank main with no error shown on ${route}`,
    ).toBeGreaterThan(0);
  });
}

/**
 * The bug this file was written to catch, pinned directly.
 *
 * Migration 0053 made account.email_hash nullable so agents and integrations
 * -- which belong to a person and have no address of their own -- could
 * exist. Every admin table still called .slice() on it, so creating one agent
 * blanked EVERY /admin page at once: the throw happens in the shared Admin
 * component, above the per-page switch.
 */
test("an agent account does not blank the admin pages", async () => {
  const AGENT = {
    account_id: "aaaaaaaa-0000-0000-0000-000000000002",
    email_hash: null, // <- the whole bug
    kind: "agent",
    principal_name: "poap-kings-agent",
    public_id: "jamie/poap-kings",
    status: "approved",
    role: "member",
    is_owner: false,
  };
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    const body = p.includes("/api/me")
      ? ME
      : p.includes("/admin/accounts")
        ? { accounts: [AGENT] }
        : p.includes("/admin/usage")
          ? { accounts: [{ ...AGENT, calls_today: 3, calls_7d: 9 }], tools: [] }
          : { requests: [], gateways: [], feedback: [], tokens: [] };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });

  window.history.pushState({}, "", "/admin/accounts");
  render(<App />);
  // Named, not dashed: a table that says who did what must say who.
  await waitFor(() =>
    expect(screen.getAllByText(/poap-kings-agent/).length).toBeGreaterThan(0),
  );
  expect(screen.queryByText(/This section failed to render/)).toBeNull();
});

/**
 * The agent detail page shows what you need in order to USE the agent.
 *
 * Reported by Jamie: the screen listed a slug but never the URL to connect a
 * client to, and there was no way to rename an agent once created. Both are
 * the difference between "an agent exists" and "an agent is usable", so they
 * are pinned here rather than left to a screenshot.
 */
test("the agent detail page offers its connect URL and a rename", async () => {
  const AGENT = {
    account_id: "00000000-0000-0000-0000-0000000000ag",
    kind: "agent",
    public_id: "272bd891a21d",
    role: "leader",
    status: "approved",
    clans: [{ clan_tag: "#J2RGCRVG", is_primary: true }],
    tokens: [{ token_id: 1, name: "poap-kings", revoked_at: null }],
  };
  global.fetch = vi.fn(async (path) => {
    const body =
      path === "/api/me" ? ME : { agents: [AGENT], integrations: [] };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });

  window.history.pushState({}, "", `/account/agents/${AGENT.account_id}`);
  render(<App />);

  // The agent's own door, not the personal /mcp. Asserting the whole path
  // because /a/<id>/mcp is the part a person cannot guess.
  const url = await screen.findByText(
    `${window.location.origin}/a/272bd891a21d/mcp`,
  );
  expect(url).toBeTruthy();
  expect(screen.getByText("rename")).toBeTruthy();
  // The documented emergency path. /docs/agents has promised "Account →
  // Agents → Revoke key" since agents shipped, while the route, the client
  // method and no button at all existed.
  expect(screen.getByText("Revoke key")).toBeTruthy();
});

test("an agent whose new key has never been used says so, rather than looking idle", async () => {
  // The failure this exists for: rotate a key, the runtime keeps presenting
  // the old one, every call 401s before it can be audited — so the page shows
  // an agent that was active minutes ago and no error anywhere.
  const AGENT = {
    account_id: "00000000-0000-0000-0000-0000000000ag",
    kind: "agent",
    public_id: "272bd891a21d",
    role: "leader",
    status: "approved",
    last_call_at: "2026-09-09T02:51:00.000Z",
    clans: [{ clan_tag: "#J2RGCRVG", is_primary: true }],
    tokens: [
      {
        token_id: 2,
        name: "poap-kings",
        created_at: "2026-09-09T02:55:00.000Z",
        last_used_at: null,
        revoked_at: null,
      },
      {
        token_id: 1,
        name: "poap-kings",
        created_at: "2026-09-08T01:00:00.000Z",
        last_used_at: "2026-09-09T02:51:00.000Z",
        revoked_at: "2026-09-09T02:55:00.000Z",
      },
    ],
  };
  global.fetch = vi.fn(async (path) => {
    const body =
      path === "/api/me" ? ME : { agents: [AGENT], integrations: [] };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });

  window.history.pushState({}, "", `/account/agents/${AGENT.account_id}`);
  render(<App />);
  expect(
    await screen.findByText(/current key has never been used/i),
  ).toBeTruthy();
});
