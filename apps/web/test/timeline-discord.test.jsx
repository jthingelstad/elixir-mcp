/**
 * Account › Timeline › Cross-post to Discord (Jamie, 2026-10-10): off, it
 * asks for a webhook; on, it shows the webhook shortened and lets the
 * owner change it or turn it off; Discord saying the webhook is gone
 * turns it off and the page says why.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import { App } from "../src/App.jsx";

const ME = {
  authenticated: true,
  role: "member",
  email: "jamie@example.com",
  timezone: "America/Chicago",
  claims: [],
  recordings: [],
};
const TIMELINE = {
  read_to: null,
  timeline: [],
  timeline_more: 0,
  entries: [],
  quiet: [],
};
const OFF = {
  enabled: false,
  webhook: null,
  enabled_at: null,
  disabled_reason: null,
  disabled_at: null,
  delivery: null,
};
const ON = {
  enabled: true,
  webhook: "discord.com/api/webhooks/1234…/abcd…",
  enabled_at: "2026-10-10T14:00:00Z",
  disabled_reason: null,
  disabled_at: null,
  delivery: { state: "ok", at: "2026-10-10T15:00:00Z", http_status: null },
};

let puts;
let setting;
beforeEach(() => {
  cleanup();
  puts = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path, init = {}) => {
    const p = String(path);
    let body = {};
    if (p === "/api/me") body = ME;
    else if (p.startsWith("/api/me/timeline/discord")) {
      if (init.method === "PUT") {
        const sent = JSON.parse(init.body);
        puts.push(sent);
        setting =
          sent.enabled === false
            ? { ...setting, enabled: false, disabled_reason: "owner" }
            : { ...ON, hello_sent: true };
      }
      body = setting;
    } else if (p.startsWith("/api/me/timeline")) body = TIMELINE;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
});
afterEach(() => vi.restoreAllMocks());

async function open() {
  window.history.pushState({}, "", "/console/account/timeline");
  render(<App />);
  await waitFor(() =>
    screen.getByRole("region", { name: "Cross-post to Discord" }),
  );
}

test("off with no webhook: it asks for one, and saving turns it on", async () => {
  setting = OFF;
  await open();
  const input = screen.getByRole("textbox", { name: "Discord webhook URL" });
  fireEvent.change(input, {
    target: { value: " https://discord.com/api/webhooks/1234/abcd " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
  await waitFor(() => expect(puts.length).toBe(1));
  expect(puts[0]).toEqual({
    url: "https://discord.com/api/webhooks/1234/abcd",
    enabled: true,
  });
  await waitFor(() => screen.getByText(/A first line was sent to the channel/));
});

test("on: the webhook is shown shortened, and it can be turned off", async () => {
  setting = ON;
  await open();
  expect(screen.getAllByText(ON.webhook).length).toBeGreaterThan(0);
  expect(screen.queryByRole("textbox", { name: "Discord webhook URL" })).toBe(
    null,
  );
  fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
  await waitFor(() => expect(puts.length).toBe(1));
  expect(puts[0]).toEqual({ enabled: false });
  await waitFor(() => screen.getByText(/Turned off/));
});

test("on: Change webhook asks for the new one, and cancel puts it back", async () => {
  setting = ON;
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Change webhook" }));
  expect(
    screen.getByRole("textbox", { name: "Discord webhook URL" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save webhook" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "cancel" }));
  expect(screen.queryByRole("textbox", { name: "Discord webhook URL" })).toBe(
    null,
  );
});

test("off because Discord said the webhook is gone: the page says why", async () => {
  setting = {
    ...OFF,
    webhook: ON.webhook,
    enabled_at: ON.enabled_at,
    disabled_reason: "webhook_gone",
    disabled_at: "2026-10-10T16:00:00Z",
  };
  await open();
  expect(screen.getByRole("alert").textContent).toMatch(
    /webhook no longer exists/,
  );
  // A new webhook is asked for, not the dead one turned back on.
  expect(
    screen.getByRole("textbox", { name: "Discord webhook URL" }),
  ).toBeTruthy();
});

test("off by the owner with a saved webhook: Turn on uses it", async () => {
  setting = {
    ...OFF,
    webhook: ON.webhook,
    disabled_reason: "owner",
    disabled_at: "2026-10-10T16:00:00Z",
  };
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
  await waitFor(() => expect(puts.length).toBe(1));
  expect(puts[0]).toEqual({ enabled: true });
});
