/**
 * Account › Emails from Elixir (the ConsoleEmails board, 2026-10-02):
 * a row per kind with its local schedule, the kinds that come when something happens, the last few sent,
 * and Every email, which sets every kind at once.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  within,
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
  is_admin: false,
  is_owner: false,
  role: "member",
  email: "jamie@example.com",
  timezone: "America/Chicago",
  claims: [],
  recordings: [],
  entitlements: {},
};

const at = (weekday) => ({ weekday, time: "9:00 am", zone: "Central" });
const KINDS = [
  ["clan_report", "Clan report", "Clan", at("Monday")],
  ["arena_week", "Your week in the Arena", "Ladder", at("Tuesday")],
  ["tracking_report", "Your friends this week", "Friends", at("Wednesday")],
  ["collector_activity", "Collector activity", "Collectors", at("Sunday")],
  ["milestone", "Milestones", "Ladder", null],
  ["clan_actions_waiting", "Clan actions waiting", "Clan", null],
  ["feedback_answer", "Answers to your feedback", "Account", null],
].map(([kind, label, product, sends]) => ({
  kind,
  label,
  product,
  sends,
  enabled: kind !== "tracking_report",
  changed_at: null,
  applies: kind !== "collector_activity",
  last_send_id:
    kind === "arena_week" ? "3f2a9c1b-0000-4000-8000-000000000001" : null,
}));
const RECENT = [
  {
    send_id: "3f2a9c1b-0000-4000-8000-000000000001",
    kind: "arena_week",
    label: "Your week in the Arena",
    subject: "Your week in the Arena: Trophy Road 4–6, war 3–3",
    period: "2026-W39",
    sent_at: "2026-09-29T14:00:00Z",
    archived: true,
  },
];

let puts;
beforeEach(() => {
  cleanup();
  puts = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    if (init?.method === "PUT") puts.push(JSON.parse(init.body));
    const body =
      p === "/api/me"
        ? ME
        : p === "/api/me/email"
          ? init?.method === "PUT"
            ? JSON.parse(init.body)
            : { kinds: KINDS, recent: RECENT }
          : {};
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
  window.history.pushState({}, "", "/console/account/profile/email");
  render(<App />);
  await waitFor(() =>
    screen.getByRole("heading", { name: "Emails from Elixir" }),
  );
  await waitFor(() => screen.getByText("Clan report"));
}

test(
  "each scheduled kind retains its local day, product, switch and sent record",
  { timeout: 20000 },
  async () => {
    await open();
    const week = screen.getByRole("region", { name: "Scheduled" });
    // The send time is the account's, from the API.
    expect(within(week).getByText("Monday · 9:00 am Central")).toBeTruthy();
    const clan = screen.getByRole("switch", { name: "Clan report email" });
    expect(clan.getAttribute("aria-checked")).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "Your friends this week email" })
        .getAttribute("aria-checked"),
    ).toBe("false");
    // A collector's email with no collector: shown, and not switchable.
    expect(
      screen.getByRole("switch", { name: "Collector activity email" }).disabled,
    ).toBe(true);
    expect(within(week).getAllByRole("listitem")).toHaveLength(4);
    expect(within(week).queryByText("nothing")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Top 100 email" })).toBeNull();
    expect(
      screen.queryByRole("switch", { name: "Card of the Week email" }),
    ).toBeNull();
    // The last one sent opens its record.
    const last = within(week).getByRole("link", { name: "The last one ›" });
    expect(last.getAttribute("href")).toBe(
      "/console/account/activity/e/3f2a9c1b-0000-4000-8000-000000000001",
    );
  },
);

test(
  "the kinds that come when something happens are apart from the week",
  { timeout: 20000 },
  async () => {
    await open();
    const happens = screen.getByRole("region", {
      name: "When something happens",
    });
    expect(within(happens).getByText("Milestones")).toBeTruthy();
    expect(within(happens).getByText("Clan actions waiting")).toBeTruthy();
    expect(within(happens).getByText("Answers to your feedback")).toBeTruthy();
    expect(
      screen.queryByText(/The two below|a card or a card form unlocked/),
    ).toBeNull();
    const week = screen.getByRole("region", { name: "Scheduled" });
    expect(within(week).queryByText("Milestones")).toBeNull();
  },
);

test(
  "a switch writes its kind; Every email writes all of them at once",
  { timeout: 20000 },
  async () => {
    await open();
    fireEvent.click(screen.getByRole("switch", { name: "Clan report email" }));
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({ kind: "clan_report", enabled: false });
    // Friends is off in the fixture, so Every email is off and says how
    // many are on.
    const all = screen.getByRole("switch", { name: "Every email" });
    expect(all.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("6 of 7 on")).toBeTruthy();
    fireEvent.click(all);
    await waitFor(() => expect(puts.length).toBe(2));
    expect(puts[1]).toEqual({ kind: "all", enabled: true });
  },
);

test(
  "sent to you: the last few, each with its product, opening its record",
  { timeout: 20000 },
  async () => {
    await open();
    const sent = screen.getByRole("region", { name: "Sent to you" });
    const row = within(sent).getByRole("link", {
      name: /Trophy Road 4–6, war 3–3/,
    });
    expect(row.getAttribute("href")).toBe(
      "/console/account/activity/e/3f2a9c1b-0000-4000-8000-000000000001",
    );
    // Tuesday 14:00 UTC is Tuesday morning in Chicago.
    expect(within(row).getByText("Tue Sep 29")).toBeTruthy();
    expect(within(row).getByText("Ladder")).toBeTruthy();
    expect(
      within(sent)
        .getByRole("link", { name: "All sent ›" })
        .getAttribute("href"),
    ).toBe("/console/account/activity/emails");
  },
);
