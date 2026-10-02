/**
 * Account › Emails from Elixir (the ConsoleEmails board, 2026-10-02):
 * the week laid out by the day each email arrives in the account's
 * zone, the two that come when something happens, the last few sent,
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
} from "@testing-library/react";
import { App } from "../src/App.jsx";

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
  ["top_100", "Top 100", "Cards", at("Thursday")],
  ["card_of_week", "Card of the Week", "Cards", at("Friday")],
  ["collector_activity", "Collector activity", "Collectors", at("Sunday")],
  ["milestone", "Milestones", "Ladder", null],
  ["clan_actions_waiting", "Clan actions waiting", "Clan", null],
].map(([kind, label, product, sends]) => ({
  kind,
  label,
  product,
  sends,
  enabled: kind !== "top_100",
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

test("the week: each email on the day it comes, with its product and its switch", async () => {
  await open();
  const week = screen.getByRole("region", { name: "Your week in email" });
  // The send time is the account's, from the API.
  expect(within(week).getByText("9:00 am Central · 14:00 UTC")).toBeTruthy();
  const clan = screen.getByRole("switch", { name: "Clan report email" });
  expect(clan.getAttribute("aria-checked")).toBe("true");
  expect(
    screen
      .getByRole("switch", { name: "Top 100 email" })
      .getAttribute("aria-checked"),
  ).toBe("false");
  // A collector's email with no collector: shown, and not switchable.
  expect(
    screen.getByRole("switch", { name: "Collector activity email" }).disabled,
  ).toBe(true);
  // Saturday has nothing, and says so.
  expect(within(week).getByText("nothing")).toBeTruthy();
  // The last one sent opens its record.
  const last = within(week).getByRole("link", { name: "The last one ›" });
  expect(last.getAttribute("href")).toBe(
    "/console/account/activity/e/3f2a9c1b-0000-4000-8000-000000000001",
  );
});

test("the two that come when something happens are apart from the week", async () => {
  await open();
  const happens = screen.getByRole("region", {
    name: "When something happens",
  });
  expect(within(happens).getByText("Milestones")).toBeTruthy();
  expect(within(happens).getByText("Clan actions waiting")).toBeTruthy();
  const week = screen.getByRole("region", { name: "Your week in email" });
  expect(within(week).queryByText("Milestones")).toBeNull();
});

test("a switch writes its kind; Every email writes all of them at once", async () => {
  await open();
  fireEvent.click(screen.getByRole("switch", { name: "Clan report email" }));
  await waitFor(() => expect(puts.length).toBe(1));
  expect(puts[0]).toEqual({ kind: "clan_report", enabled: false });
  // Top 100 is off in the fixture, so Every email is off and says how
  // many are on.
  const all = screen.getByRole("switch", { name: "Every email" });
  expect(all.getAttribute("aria-checked")).toBe("false");
  expect(screen.getByText("7 of 8 on")).toBeTruthy();
  fireEvent.click(all);
  await waitFor(() => expect(puts.length).toBe(2));
  expect(puts[1]).toEqual({ kind: "all", enabled: true });
});

test("sent to you: the last few, each with its product, opening its record", async () => {
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
    within(sent).getByRole("link", { name: "All sent ›" }).getAttribute("href"),
  ).toBe("/console/account/activity/emails");
});
