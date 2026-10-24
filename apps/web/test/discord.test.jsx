/**
 * Discord as a way in (#531): the sign-in page's "Continue with Discord",
 * the profile's Connect and Disconnect, and what each outcome the API
 * sends back as `?discord=` says.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  configure,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { SignIn } from "../src/views/SignIn.jsx";
import { App } from "../src/App.jsx";
import { discordOutcome, discordStartHref } from "../src/discord.js";

configure({ asyncUtilTimeout: 5000 });

let me;
let calls;

beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path, init) => {
    calls.push({ path: String(path), method: init?.method ?? "GET" });
    const body = String(path) === "/api/me" ? me : { ok: true, removed: true };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
});
afterEach(() => vi.restoreAllMocks());

test("the start link carries the form's choices only for a sign-in", () => {
  expect(
    discordStartHref({ intent: "signin", zone: "America/Chicago", news: true }),
  ).toBe("/api/auth/discord/start?intent=signin&tz=America%2FChicago&news=1");
  expect(discordStartHref({ intent: "signin", news: false })).toBe(
    "/api/auth/discord/start?intent=signin",
  );
  expect(discordStartHref({ intent: "link", zone: "UTC", news: true })).toBe(
    "/api/auth/discord/start?intent=link",
  );
  expect(discordOutcome("?discord=no_email", "signin").text).toMatch(
    /no verified email/,
  );
  expect(discordOutcome("?discord=linked", "link").ok).toBe(true);
  expect(discordOutcome("?discord=whatever", "link")).toBe(null);
  expect(discordOutcome("", "signin")).toBe(null);
});

test("sign-in offers Discord only when it is configured, and says how it went", () => {
  window.history.pushState({}, "", "/console/signin");
  const { unmount } = render(<SignIn onAuthed={vi.fn()} search="" />);
  expect(screen.queryByText("Continue with Discord")).toBe(null);
  unmount();
  render(<SignIn onAuthed={vi.fn()} search="?discord=other" discordLogin />);
  const link = screen.getByText("Continue with Discord");
  expect(link.getAttribute("href")).toMatch(
    /^\/api\/auth\/discord\/start\?intent=signin&tz=[^&]+&news=1$/,
  );
  // Unticking product news is what the round trip carries.
  fireEvent.click(screen.getByLabelText("Send me Elixir product news"));
  expect(link.getAttribute("href")).not.toMatch(/news=1/);
  expect(screen.getByRole("alert").textContent).toMatch(
    /connected to a different Discord account/,
  );
});

const ME = {
  authenticated: true,
  kind: "person",
  is_admin: false,
  is_owner: false,
  role: "leader",
  email: "jamie@example.com",
  timezone: "America/Chicago",
  claims: [],
  recordings: [],
  entitlements: {},
  features: { discord_login: true },
};

test(
  "the profile connects Discord, and disconnects a linked one",
  { timeout: 20000 },
  async () => {
    me = { ...ME, discord: null };
    window.history.pushState({}, "", "/console/account/profile?discord=taken");
    const { unmount } = render(<App />);
    const connect = await screen.findByText("Connect Discord");
    expect(connect.getAttribute("href")).toBe(
      "/api/auth/discord/start?intent=link",
    );
    expect(
      screen.getByText(/already connected to another Elixir account/),
    ).toBeTruthy();
    unmount();
    cleanup();

    me = {
      ...ME,
      discord: { username: "jamie", linked_at: "2026-10-24T12:00:00Z" },
    };
    window.history.pushState({}, "", "/console/account/profile");
    render(<App />);
    fireEvent.click(await screen.findByText("Disconnect"));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.path === "/api/me/discord/unlink" && c.method === "POST",
        ),
      ).toBe(true),
    );
    expect(
      screen.getByText("Email link, a six-digit code, or Discord"),
    ).toBeTruthy();
  },
);

test(
  "the profile leaves Discord out when it is not configured",
  { timeout: 20000 },
  async () => {
    me = { ...ME, features: { discord_login: false }, discord: null };
    window.history.pushState({}, "", "/console/account/profile");
    render(<App />);
    await screen.findByRole("heading", { name: "Profile" });
    expect(screen.queryByText("Connect Discord")).toBe(null);
  },
);
