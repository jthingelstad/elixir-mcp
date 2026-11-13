/**
 * The bell's sheet (#765): every link out of it closes it, the rest-of-
 * the-list link included. On a Clan page the shell stays mounted across
 * the navigation, so a link that left the sheet open would leave Run's
 * Waiting behind a modal. Invented names only.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { BellSheet } from "../src/shell/Bell.jsx";

const reply = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const CLAN = {
  ok: true,
  state: "member",
  clan_tag: "#0QC8RCGY",
  name: "Ada's Clan",
  role: "leader",
  verified: true,
  members: 40,
  min_members: 10,
  needs: [
    {
      number: 41,
      type: "departure",
      label: "Departure",
      subject_name: "Ada",
      left_at: "2026-11-12T10:00:00.000Z",
    },
  ],
  needs_total: 4,
};

beforeEach(() => {
  cleanup();
  vi.spyOn(console, "error").mockImplementation(() => {});
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me/home/needs") return reply({ needs: CLAN });
    if (p === "/api/me/home/clan") return reply({ clan: CLAN });
    return reply({});
  });
});
afterEach(() => vi.restoreAllMocks());

test("the rest-of-the-list link closes the sheet, as each Action's does", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  const onClose = vi.fn();
  const navigate = vi.fn();
  renderWithProviders(
    <BellSheet me={{}} onClose={onClose} navigate={navigate} />,
  );
  const more = await screen.findByRole("link", {
    name: /more waiting in Clan/,
    hidden: true,
  });
  fireEvent.click(more);
  expect(onClose).toHaveBeenCalledTimes(1);
});

// The bell's own read (2026-11-12): reactions as counts, never who;
// followers named by their verified player, else counted; answers to your
// feedback. Opening the sheet moves the seen marker once.
const BELL = {
  seen_at: null,
  players: 1,
  new: 3,
  reactions: {
    new: 1,
    items: [
      {
        item_id: "tl_0123456789abcdef0123",
        text: "Invented Owner won five in a row",
        at: "2026-11-12T10:00:00.000Z",
        battle_url: "https://elixir.example/battle/abc123",
        cheers: { on_fire: 2, royal: 1 },
        total: 3,
        new: true,
      },
    ],
  },
  followers: {
    count: 3,
    new: 1,
    unnamed: 2,
    players: [
      {
        tag: "#0VQRR8U0",
        name: "Invented Fan",
        followed_tag: "#0QRVVG22J",
        followed_name: "Invented Owner",
        new: true,
      },
    ],
  },
  answers: {
    new: 1,
    items: [
      {
        id: 42,
        about: "The war tab is slow",
        status: "planned",
        responded_at: "2026-11-11T10:00:00.000Z",
        new: true,
      },
    ],
  },
};

test("the bell's sections: counts not cheerers, named and counted followers, answers; the marker moves once", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
  };
  const calls = [];
  global.fetch = vi.fn(async (path, init) => {
    const p = String(path);
    calls.push([init?.method ?? "GET", p]);
    if (p === "/api/me/bell") return reply(BELL);
    if (p === "/api/me/bell/seen")
      return reply({ seen_at: "2026-11-12T12:00:00.000Z" });
    if (p === "/api/me/home/needs") return reply({ needs: CLAN });
    if (p === "/api/me/home/clan") return reply({ clan: CLAN });
    return reply({});
  });
  renderWithProviders(<BellSheet me={{}} onClose={() => {}} />);
  const reactions = await screen.findByRole("region", {
    name: "Reactions to your items",
    hidden: true,
  });
  expect(reactions.textContent).toContain("Invented Owner won five in a row");
  expect(reactions.textContent).toContain("Counts only: never who cheered.");
  expect(
    reactions.querySelector('[aria-label="On fire 2, Royal 1"]'),
  ).toBeTruthy();
  const link = reactions.querySelector("a");
  expect(link.getAttribute("href")).toBe("/battle/abc123");
  const followers = screen.getByRole("region", {
    name: "New followers",
    hidden: true,
  });
  expect(followers.textContent).toContain("Invented Fan");
  expect(followers.textContent).toContain("Follows Invented Owner");
  expect(followers.textContent).toMatch(/2 more accounts follow you/);
  const answers = screen.getByRole("region", {
    name: "Answers to your feedback",
    hidden: true,
  });
  expect(answers.querySelector("a").getAttribute("href")).toBe(
    "/settings/feedback/42",
  );
  screen.getByRole("region", { name: "Needs you", hidden: true });
  // What was new when it opened stays marked while it is open.
  await waitFor(() =>
    expect(calls).toContainEqual(["PUT", "/api/me/bell/seen"]),
  );
  expect(
    document.querySelectorAll(".kit-bell__new").length,
  ).toBeGreaterThanOrEqual(3);
  expect(calls.filter(([m]) => m === "PUT")).toHaveLength(1);
});

test("no verified player: the bell says how to get cheers and followers", async () => {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  global.fetch = vi.fn(async (path) => {
    const p = String(path);
    if (p === "/api/me/bell")
      return reply({
        ...BELL,
        players: 0,
        new: 0,
        reactions: { items: [], new: 0 },
        followers: { count: 0, new: 0, unnamed: 0, players: [] },
        answers: { items: [], new: 0 },
      });
    if (p === "/api/me/home/needs") return reply({ needs: null });
    return reply({});
  });
  renderWithProviders(<BellSheet me={{}} onClose={() => {}} />);
  const verify = await screen.findByRole("link", {
    name: "Verify a player",
    hidden: true,
  });
  expect(verify.getAttribute("href")).toBe("/settings/players/verify");
});
