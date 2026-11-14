/**
 * Bring your clanmates moves to Find (Jamie, 2026-11-12): under Find's
 * Your clan, and not on Stats' Season or Home. Invented players only.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "../src/App.jsx";
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";

configure({ asyncUtilTimeout: 5000 });

const ME = {
  authenticated: true,
  is_admin: false,
  role: "member",
  timezone: "America/Chicago",
  claims: [
    {
      player_tag: "#0GVJ9V",
      name: "Birch Lantern",
      is_primary: true,
      relationship: "primary",
      status: "verified",
    },
  ],
  recordings: [],
  signals: {},
};
const CLANS = {
  clans: [{ clan_tag: "#2CLAN", name: "Fixture Clan" }],
  home_clan: { clan_tag: "#2CLAN", name: "Fixture Clan" },
  slots: {},
};
const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  cleanup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me") return reply(ME);
    if (p.startsWith("/api/me/clans")) return reply(CLANS);
    return reply({});
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test(
  "Find's Your clan offers Invite clanmates, named for the clan",
  { timeout: 20000 },
  async () => {
    window.history.pushState({}, "", "/home/find");
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Your clan" }));
    await screen.findByText("Invite clanmates", { exact: true });
    expect(document.body.textContent).toContain("Fixture Clan");
  },
);

test("Stats' Season no longer offers it", { timeout: 20000 }, async () => {
  window.history.pushState({}, "", "/home/you/stats");
  render(<App />);
  await screen.findByRole("tablist", { name: "You" });
  // Give the clan read its chance to land before saying it is absent.
  await waitFor(() =>
    expect(global.fetch.mock.calls.some(([p]) => String(p) === "/api/me")).toBe(
      true,
    ),
  );
  expect(screen.queryByText("Invite clanmates", { exact: true })).toBeNull();
});
