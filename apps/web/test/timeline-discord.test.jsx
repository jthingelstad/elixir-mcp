/**
 * Account › Timeline › Cross-post to Discord (Jamie, 2026-10-10): off, it
 * asks for a webhook; on, it shows the webhook shortened and lets the
 * owner change it or turn it off; Discord saying the webhook is gone
 * turns it off and the page says why.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  configure,
} from "@testing-library/react";
import { App } from "../src/App.jsx";

// This file renders the whole App, routes and all, from a cold module
// graph. Testing Library's 1 s default wait reads a slow first paint on a
// loaded machine as a missing element (first-answer failed so, #488).
// Bound the wait as the other whole-App journeys do
// (account-journeys.test.jsx), with a 20 s bound on each test that renders it.
configure({ asyncUtilTimeout: 5000 });

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
  const manage = await screen.findByRole("button", { name: "Manage sharing" });
  expect(
    screen.queryByRole("textbox", { name: "Discord webhook URL" }),
  ).toBeNull();
  expect(puts).toEqual([]);
  fireEvent.click(manage);
  await screen.findByRole("region", { name: "Cross-post to Discord" });
}

test(
  "off with no webhook: it asks for one, and saving turns it on",
  { timeout: 20000 },
  async () => {
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
    await waitFor(() =>
      screen.getByText(/A first line was sent to the channel/),
    );
  },
);

test(
  "on: the webhook is shown shortened, and it can be turned off",
  { timeout: 20000 },
  async () => {
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
  },
);

test(
  "on: Change webhook asks for the new one, and cancel puts it back",
  { timeout: 20000 },
  async () => {
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
  },
);

test(
  "off because Discord said the webhook is gone: the page says why",
  { timeout: 20000 },
  async () => {
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
  },
);

test(
  "off by the owner with a saved webhook: Turn on uses it",
  { timeout: 20000 },
  async () => {
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
  },
);

test(
  "on: the last deliveries are listed, and your clan's own channel is named, nothing filtered",
  { timeout: 20000 },
  async () => {
    setting = {
      ...ON,
      deliveries: [
        {
          at: "2026-10-10T15:00:00Z",
          outcome: "refused",
          ref: "tl_0123456789abcdef0123",
          http_status: 400,
          reason: "Invalid Form Body",
          excerpt: "a line Discord would not take",
        },
        {
          at: "2026-10-10T14:30:00Z",
          outcome: "posted",
          ref: "tl_0123456789abcdef0124",
          excerpt: "five battles",
        },
      ],
      not_delivered: 1,
      clan_channels: [{ clan_tag: "#J2RGCRVG", name: "POAP KINGS" }],
    };
    await open();
    fireEvent.click(screen.getByText(/^Delivery history/));
    const list = screen.getByRole("list", { name: "Last deliveries" });
    expect(list.textContent).toContain("Discord: HTTP 400, Invalid Form Body");
    expect(list.textContent).toContain("five battles");
    expect(list.textContent).not.toContain("tl_", "an item's id says nothing");
    expect(screen.getByText(/1 not delivered in 30 days/)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(
      /POAP KINGS posts the clan’s activity to a Discord channel of its own.*Nothing here is filtered/,
    );
  },
);

for (const close of ["Close", "Escape"])
  test(`closing sharing with ${close} discards an unsaved webhook`, async () => {
    setting = ON;
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Change webhook" }));
    fireEvent.change(screen.getByLabelText("Discord webhook URL"), {
      target: {
        value: "https://discord.com/api/webhooks/1234/fixture-unsaved",
      },
    });
    if (close === "Close")
      fireEvent.click(
        screen.getByRole("button", { name: "Close", exact: true }),
      );
    else
      fireEvent(
        screen.getByRole("dialog"),
        new Event("cancel", { cancelable: true }),
      );
    fireEvent.click(screen.getByRole("button", { name: "Manage sharing" }));
    expect(screen.getByRole("button", { name: "Change webhook" })).toBeTruthy();
    expect(screen.queryByLabelText("Discord webhook URL")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change webhook" }));
    expect(screen.getByLabelText("Discord webhook URL").value).toBe("");
    expect(puts).toEqual([]);
  });

test("a refused response arriving after close cannot restore the old editor or its error", async () => {
  setting = ON;
  const { api } = await import("../src/api.js");
  let finish;
  vi.spyOn(api, "saveTimelineDiscord").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Change webhook" }));
  fireEvent.change(screen.getByLabelText("Discord webhook URL"), {
    target: { value: "https://discord.com/api/webhooks/1234/fixture-unsaved" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save webhook" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Close", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Manage sharing" }));
  expect(screen.getByRole("button", { name: "Change webhook" }).disabled).toBe(
    true,
  );
  await act(async () => {
    finish({ ok: false, status: 400, data: { message: "Fixture refusal" } });
  });
  await waitFor(() => expect(api.saveTimelineDiscord).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Fixture refusal")).toBeNull();
  expect(screen.getByRole("button", { name: "Change webhook" }).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Change webhook" }));
  expect(screen.getByLabelText("Discord webhook URL").value).toBe("");
});
