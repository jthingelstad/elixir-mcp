/**
 * The Timeline's mode filter (Jamie, 2026-11-17: "a player should be able
 * to filter the timeline by these same groups: Trophy Road, Ranked, War,
 * Casual"): a list beside the Show chips, All modes by default, read by
 * the server so each page is that mode's, and an empty mode said as such.
 * Invented names and tags only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { HomeFeed } from "../src/home/Feed.jsx";
import {
  FEED_MODES,
  askedMode,
  keepMode,
  keptMode,
  modeQuiet,
  withMode,
} from "../src/home/logic.js";

vi.mock("../src/analytics.js", () => ({ trackEvent: () => {} }));

const AGO = (min) => new Date(Date.now() - min * 60_000).toISOString();
const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const arrival = (id) => ({
  id: `tl_${id.padStart(20, "0")}`,
  kind: "arena_changed",
  at: AGO(30),
  observed_at: AGO(29),
  subject_tag: "#00JQ20",
  subject_name: `Invented ${id}`,
  subjects: [{ tag: "#00JQ20", kind: "player", name: `Invented ${id}` }],
  groups: ["you"],
  text: `Invented ${id} reached Arena 12.`,
  facts: { player_tag: "#00JQ20", name: `Invented ${id}`, to_name: "Arena" },
});

let calls;
let page;
beforeEach(() => {
  calls = [];
  page = null;
  global.fetch = vi.fn(async (path) => {
    const p = String(path).split("?")[0];
    calls.push(String(path));
    if (p === "/api/me/home/feed") return reply(page);
    return reply({});
  });
});
afterEach(() => cleanup());

const week = (timeline, extra = {}) => ({
  window: { from: AGO(10_080), to: AGO(0) },
  seen_to: AGO(120),
  timeline,
  total: timeline.length,
  next: null,
  timeline_more: 0,
  counts: {
    everyone: timeline.length,
    you: timeline.length,
    friends: 0,
    clan: 0,
    close: 0,
    new: 0,
    new_since: AGO(120),
  },
  ...extra,
});

test("the four modes, after All modes, in the week chips' words", () => {
  expect(FEED_MODES.map((m) => m.label)).toEqual([
    "All modes",
    "Trophy Road",
    "Ranked",
    "War",
    "Casual",
  ]);
  expect(FEED_MODES.map((m) => m.key)).toEqual([
    "all",
    "ladder",
    "ranked",
    "war",
    "casual",
  ]);
});

test("the address names a mode; anything else is All modes", () => {
  expect(askedMode("?mode=ranked")).toBe("ranked");
  expect(askedMode({ mode: "war" })).toBe("war");
  expect(askedMode("?mode=event")).toBeNull();
  expect(askedMode("?mode=all")).toBeNull();
  expect(askedMode("")).toBeNull();
  expect(askedMode(undefined)).toBeNull();
  expect(withMode("/timeline", "?show=close", "ranked")).toBe(
    "/timeline?show=close&mode=ranked",
  );
  expect(withMode("/timeline", "?mode=war&show=clan", null)).toBe(
    "/timeline?show=clan",
  );
  expect(withMode("/timeline", "", null)).toBe("/timeline");
});

test("the mode is kept per account in this browser, All modes forgets it", () => {
  window.localStorage.clear();
  expect(keptMode("acct-a")).toBeNull();
  keepMode("acct-a", "casual");
  expect(keptMode("acct-a")).toBe("casual");
  expect(keptMode("acct-b")).toBeNull();
  keepMode("acct-a", null);
  expect(keptMode("acct-a")).toBeNull();
  // Nobody signed in keeps nothing.
  keepMode(null, "war");
  expect(keptMode(null)).toBeNull();
});

test("an empty mode says so with the audience it was asked under", () => {
  expect(modeQuiet("ladder", null)).toBe(
    "Nothing on Trophy Road in the last seven days.",
  );
  expect(modeQuiet("ranked", "friends")).toBe(
    "Nothing from your friends in Ranked in the last seven days.",
  );
  expect(modeQuiet("war", "you")).toBe(
    "Nothing of yours in War in the last seven days.",
  );
});

test("the feed asks the server for its mode, and the list changes it", async () => {
  page = week([arrival("1")], { mode: "ladder", week_total: 4 });
  const setMode = vi.fn();
  renderWithProviders(<HomeFeed mode="ladder" setMode={setMode} />);
  expect((await screen.findAllByText(/Invented 1/)).length).toBeGreaterThan(0);
  expect(calls).toContain("/api/me/home/feed?mode=ladder");
  const list = screen.getByRole("combobox", { name: "Mode" });
  expect(list.value).toBe("ladder");
  // A different control from the Show chips, named apart.
  expect(screen.getByRole("group", { name: "Show" })).toBeTruthy();
  fireEvent.change(list, { target: { value: "war" } });
  expect(setMode).toHaveBeenLastCalledWith("war");
  fireEvent.change(list, { target: { value: "all" } });
  expect(setMode).toHaveBeenLastCalledWith(null);
});

test("All modes asks for no mode", async () => {
  page = week([arrival("2")]);
  renderWithProviders(<HomeFeed mode={null} setMode={() => {}} />);
  expect((await screen.findAllByText(/Invented 2/)).length).toBeGreaterThan(0);
  expect(calls).toContain("/api/me/home/feed");
  expect(screen.getByRole("combobox", { name: "Mode" }).value).toBe("all");
});

test("a mode with nothing in a busy week says so and offers All modes, not the quiet week", async () => {
  page = week([], { mode: "ranked", week_total: 12 });
  const setMode = vi.fn();
  renderWithProviders(<HomeFeed mode="ranked" setMode={setMode} />);
  expect(
    await screen.findByText("Nothing in Ranked in the last seven days."),
  ).toBeTruthy();
  expect(screen.queryByText("Find your people")).toBeNull();
  // The list stays, so the reader can choose another mode from here.
  expect(screen.getByRole("combobox", { name: "Mode" }).value).toBe("ranked");
  fireEvent.click(screen.getByRole("button", { name: "Show all modes" }));
  expect(setMode).toHaveBeenCalledWith(null);
});

test("a Show chip with nothing in the mode names both", async () => {
  page = week([arrival("3")], { mode: "war", week_total: 9 });
  renderWithProviders(<HomeFeed mode="war" setMode={() => {}} />);
  expect((await screen.findAllByText(/Invented 3/)).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /Friends/ }));
  expect(
    screen.getByText(
      "Nothing from your friends in War in the last seven days.",
    ),
  ).toBeTruthy();
});
