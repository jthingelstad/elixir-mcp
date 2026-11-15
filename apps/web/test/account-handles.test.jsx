/**
 * Account handles (Jamie, 2026-11-15): /home/@handle is the account page,
 * your own account page is You's, search lists accounts by @handle, and
 * Settings' Profile sets, checks and removes yours. Invented players only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  configure,
  fireEvent,
} from "@testing-library/react";
import { App, barArea } from "../src/App.jsx";
import "./warm-routes.js";
import "../src/pages/SettingsPage.jsx";
import { accountIdOf, handleHref } from "../src/lib/account.js";
import { accountRows, handleQuery } from "../src/shell/search-logic.js";

configure({ asyncUtilTimeout: 5000 });

const ME = {
  authenticated: true,
  is_admin: false,
  role: "member",
  email: "someone@example.com",
  timezone: "America/Chicago",
  page_id: "abcdefghjkmn",
  handle: null,
  claims: [],
  recordings: [],
  entitlements: {},
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
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("an @handle address names the same account page", () => {
  expect(accountIdOf("/home/@Ruby_Knight")).toBe("@ruby_knight");
  expect(accountIdOf("/home/@ruby/")).toBe("@ruby");
  expect(accountIdOf("/home/@a")).toBeNull();
  expect(accountIdOf("/home/@bad%20name")).toBeNull();
  expect(accountIdOf("/home/account/abcdefghjkmn")).toBe("abcdefghjkmn");
  expect(handleHref("ruby")).toBe("/home/@ruby");
});

test("your own account page is You's; another account's is Find's", () => {
  const me = { page_id: "abcdefghjkmn", handle: "ruby", claims: [] };
  expect(barArea("/home/account/abcdefghjkmn", me)).toBe("you");
  expect(barArea("/home/@ruby", me)).toBe("you");
  expect(barArea("/home/@someone_else", me)).toBe("find");
  expect(barArea("/home/account/zzzzzzzzzzzz", me)).toBe("find");
});

test("search reads accounts for a handle-shaped query, never for a tag", () => {
  expect(handleQuery("@Ru")).toBe("ru");
  expect(handleQuery("ruby_knight")).toBe("ruby_knight");
  expect(handleQuery("#0VRGQ2YC")).toBeNull();
  expect(handleQuery("r")).toBeNull();
  expect(
    accountRows([
      { id: "abcdefghjkmn", handle: "ruby", player: { name: "Ruby" } },
      { id: "bcdefghjkmnp", handle: "rubble", player: null },
    ]),
  ).toEqual([
    { t: "@ruby", d: "Ruby", href: "/home/account/abcdefghjkmn" },
    { t: "@rubble", d: "Elixir account", href: "/home/account/bcdefghjkmnp" },
  ]);
});

test(
  "Profile offers a handle, checks it while you type, and saves it",
  { timeout: 20000 },
  async () => {
    const posted = [];
    global.fetch = vi.fn(async (path, init) => {
      const p = String(path);
      if (p === "/api/me") return reply(ME);
      if (p === "/api/me/handle-check") return reply({ suggestion: "birch" });
      if (p === "/api/me/handle-check?handle=taken_one")
        return reply({
          handle: "taken_one",
          available: false,
          error: "taken",
          message: "Someone already has that one. Pick another.",
        });
      if (p === "/api/me/handle-check?handle=birch")
        return reply({ handle: "birch", available: true, error: null });
      if (p === "/api/me/handle") {
        posted.push(JSON.parse(init.body));
        return reply({ ok: true, handle: "birch" });
      }
      return reply({});
    });
    window.history.pushState({}, "", "/settings/profile");
    render(<App />);
    const input = await screen.findByLabelText("Pick a handle (optional)");
    await screen.findByText("Try @birch, or pick your own.");

    fireEvent.change(input, { target: { value: "Taken_One" } });
    await screen.findByText("Someone already has that one. Pick another.");
    expect(screen.getByRole("button", { name: "Save handle" }).disabled).toBe(
      true,
    );

    fireEvent.change(input, { target: { value: "@birch" } });
    await screen.findByText("@birch is free.");
    fireEvent.click(screen.getByRole("button", { name: "Save handle" }));
    await waitFor(() => expect(posted).toEqual([{ handle: "birch" }]));
  },
);
