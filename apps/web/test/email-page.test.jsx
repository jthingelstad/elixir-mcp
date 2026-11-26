/**
 * Account › Emails from Elixir (the emails board, 2026-10-02):
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
// The route chunks compile while this file loads, not inside a wait.
import "./warm-routes.js";
// Settings is a lazy chunk. Imported here, its module graph compiles while
// the file loads, where no wait is bounded, instead of inside the first
// test's wait for the page: on a loaded host the compile was most of a
// first paint and outran the 5 s wait (2026-11-12).
import "../src/pages/SettingsPage.jsx";

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

const at = (weekday, every = "week") => ({
  weekday,
  time: "9:00 am",
  zone: "Central",
  every,
});
const KINDS = [
  ["digest_daily", "Daily brief", "Timeline", at("Monday", "day")],
  ["tracking_report", "Weekly recap", "Timeline", at("Monday")],
  ["digest_season", "Season recap", "Timeline", at("Monday", "season")],
  ["collector_activity", "Collector activity", "Collectors", at("Sunday")],
  ["clan_actions_waiting", "Clan actions waiting", "Clan", null],
  ["feedback_answer", "Answers to your feedback", "Account", null],
  ["activity_today", "Cheers on your play", "Home", null],
].map(([kind, label, product, sends]) => ({
  kind,
  label,
  product,
  sends,
  enabled: kind !== "digest_daily",
  changed_at: null,
  applies: kind !== "collector_activity",
  last_send_id:
    kind === "collector_activity"
      ? "3f2a9c1b-0000-4000-8000-000000000001"
      : null,
}));
const RECENT = [
  {
    send_id: "3f2a9c1b-0000-4000-8000-000000000001",
    kind: "collector_activity",
    label: "Collector activity",
    subject: "Collector activity: 1,204 battles recorded",
    period: "2026-W39",
    sent_at: "2026-09-29T14:00:00Z",
    archived: true,
  },
];

let puts;
let kinds = KINDS;
let clanPart = true;
beforeEach(() => {
  kinds = KINDS;
  clanPart = true;
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
            : { kinds, clan_part: clanPart, recent: RECENT }
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
  window.history.pushState({}, "", "/settings/emails");
  render(<App />);
  await waitFor(() => screen.getByRole("heading", { name: "Emails" }));
  await waitFor(() => screen.getByText("Weekly recap"));
}

test(
  "each scheduled kind retains its local day, product, switch and sent record",
  { timeout: 20000 },
  async () => {
    await open();
    const week = screen.getByRole("region", { name: "Scheduled" });
    // The send time is the account's, from the API.
    expect(within(week).getByText(/Sundays, 9:00 am Central/)).toBeTruthy();
    // One scheduled mail: the clan report, Arena week and milestones ended
    // (2026-11-12) and have no switch.
    for (const gone of ["Clan report", "Your week in the Arena", "Milestones"])
      expect(
        screen.queryByRole("switch", { name: `${gone} email` }),
      ).toBeNull();
    // The three digests, each its own switch with its own words and day.
    expect(
      ["Daily brief", "Weekly recap", "Season recap"].map((n) =>
        screen
          .getByRole("switch", { name: `${n} email` })
          .getAttribute("aria-checked"),
      ),
    ).toEqual(["false", "true", "true"]);
    expect(within(week).getByText(/^Daily, 9:00 am Central/)).toBeTruthy();
    expect(within(week).getByText(/^Mondays, 9:00 am Central/)).toBeTruthy();
    expect(
      within(week).getByText(/^When a season starts, 9:00 am Central/),
    ).toBeTruthy();
    expect(screen.getByText(/A short brief on yesterday/)).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    // A collector's email with no collector: shown, and not switchable.
    expect(
      screen.getByRole("switch", { name: "Collector activity email" }).disabled,
    ).toBe(true);
    // Three digests, their clan news, and the collector's.
    expect(within(week).getAllByRole("listitem")).toHaveLength(5);
    expect(within(week).queryByText("nothing")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Top 100 email" })).toBeNull();
    expect(
      screen.queryByRole("switch", { name: "Card of the Week email" }),
    ).toBeNull();
    // The last one sent opens its record.
    const last = within(week).getByRole("link", { name: "The last one" });
    expect(last.getAttribute("href")).toBe(
      "/settings/emails/3f2a9c1b-0000-4000-8000-000000000001",
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
    expect(within(happens).queryByText("Milestones")).toBeNull();
    expect(within(happens).getByText("Clan actions waiting")).toBeTruthy();
    expect(within(happens).getByText("Answers to your feedback")).toBeTruthy();
    expect(
      screen.queryByText(/The two below|a card or a card form unlocked/),
    ).toBeNull();
    expect(
      within(happens).getByText(/When an action becomes yours/),
    ).toBeTruthy();
  },
);

test(
  "a switch writes its kind; Every email writes all of them at once",
  { timeout: 20000 },
  async () => {
    await open();
    fireEvent.click(
      screen.getByRole("switch", { name: "Clan actions waiting email" }),
    );
    await waitFor(() => expect(puts.length).toBe(1));
    expect(puts[0]).toEqual({ kind: "clan_actions_waiting", enabled: false });
    // The daily brief is off in the fixture, so Every email is off and
    // says how many are on.
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
      name: /1,204 battles recorded/,
    });
    expect(row.getAttribute("href")).toBe(
      "/settings/emails/3f2a9c1b-0000-4000-8000-000000000001",
    );
    // Tuesday 14:00 UTC is Tuesday morning in Chicago.
    expect(within(row).getByText("Tue Sep 29")).toBeTruthy();
    expect(within(row).getByText("Collectors")).toBeTruthy();
    expect(
      within(sent).getByRole("link", { name: "All sent" }).getAttribute("href"),
    ).toBe("/settings/emails/sent");
  },
);

test(
  "each digest is its own switch: any of them, all or none, one write each",
  { timeout: 20000 },
  async () => {
    await open();
    fireEvent.click(screen.getByRole("switch", { name: "Daily brief email" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    fireEvent.click(screen.getByRole("switch", { name: "Season recap email" }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts).toEqual([
      { kind: "digest_daily", enabled: true },
      { kind: "digest_season", enabled: false },
    ]);
  },
);

test(
  "the digests' clan news is one switch for all three, kept off for someone who said no",
  { timeout: 20000 },
  async () => {
    clanPart = false;
    await open();
    const sw = screen.getByRole("switch", {
      name: "Clan news in these emails",
    });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(
      screen.getByText(/Your clans' races, joins, departures and role changes/),
    ).toBeTruthy();
    fireEvent.click(sw);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ clan_part: true });
    expect(screen.getAllByRole("switch", { name: /Clan news/ })).toHaveLength(
      1,
    );
    // With all three off there is nothing to put clan news in.
    cleanup();
    kinds = KINDS.map((k) =>
      ["digest_daily", "tracking_report", "digest_season"].includes(k.kind)
        ? { ...k, enabled: false }
        : k,
    );
    await open();
    expect(
      screen.getByRole("switch", { name: "Clan news in these emails" })
        .disabled,
    ).toBe(true);
  },
);
