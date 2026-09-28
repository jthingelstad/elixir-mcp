/**
 * Explore's record reads (review 2026-09-27 §7.5). A lookup's probe is
 * the record's own call, so it seeds the record page instead of being
 * made twice; and a war week is read BY NAME with war_history's exact
 * week, not searched for in the last 12 seasons, so an older week is
 * found and the page shows the race itself: every clan's standings, the
 * days, and who fought.
 */
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { api } from "../src/api.js";
import { Explore } from "../src/views/Explore.jsx";

const answer = (body) => ({ ok: true, status: 200, data: { body } });

const CLANS = [
  ["#J2RGCRVG", "POAP KINGS", 1, 3400],
  ["#GCYQR9VY", "Ship It!", 2, 3100],
  ["#AAAAAAA", "River One", 3, 2800],
  ["#BBBBBBB", "River Two", 4, 2500],
  ["#CCCCCCC", "River Three", 5, 1900],
];

const WEEK = {
  clan_tag: "#J2RGCRVG",
  name: "POAP KINGS",
  weeks: [
    {
      season_id: 120,
      section_index: 2,
      is_colosseum: false,
      in_progress: false,
      closed_at: "2025-06-02T09:40:00.000Z",
      our_rank: 1,
      our_fame: 3400,
    },
  ],
  standings: CLANS.map(([clan_tag, name, rank, fame]) => ({
    clan_tag,
    name,
    rank,
    fame,
    period_points: fame,
    trophy_change: 20 - rank * 5,
    finish_time: null,
    clan_war_trophies: 2000,
    repair_points: 0,
  })),
  days: [
    {
      war_day: 1,
      period_index: 3,
      standings: CLANS.map(([clan_tag, name, rank]) => ({
        clan_tag,
        name,
        rank,
        points_earned: 900 - rank,
        progress_end: 1200,
        defenses_remaining: 10,
      })),
    },
  ],
  member_weeks: [
    {
      player_tag: "#20JJJ2CCRU",
      name: "King Thing",
      season_id: 120,
      section_index: 2,
      points: 2800,
      decks_used: 16,
      boat_attacks: 1,
      repair_points: 0,
    },
  ],
  notes: ["points are per-member contributions."],
};

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

test("a war week is read by name and shows the race: five clans, the days, who fought", async () => {
  const explore = vi
    .spyOn(api, "explore")
    .mockImplementation(async () => answer(WEEK));
  renderWithProviders(
    <Explore me={{}} navigate={vi.fn()} path="/explore/week/J2RGCRVG~120~2" />,
  );
  await screen.findByRole("heading", { name: "Season 120, week 3" });

  // One exact-week call: season 120 is far past any 12-season window.
  expect(explore).toHaveBeenCalledTimes(1);
  expect(explore).toHaveBeenCalledWith("war_history", {
    clan_tag: "#J2RGCRVG",
    season_id: 120,
    section_index: 2,
  });

  const standings = screen
    .getByRole("heading", { name: "Standings" })
    .closest("section");
  const rows = standings.querySelectorAll("tbody tr");
  expect(rows).toHaveLength(5);
  // Every clan in the race, each a real link to its record.
  const links = [...standings.querySelectorAll("a")];
  expect(links.map((a) => a.textContent)).toEqual(CLANS.map((c) => c[1]));
  expect(links[1].getAttribute("href")).toBe("/explore/clan/GCYQR9VY");

  const days = screen
    .getByRole("heading", { name: "Day by day" })
    .closest("section");
  expect(days.querySelectorAll("tbody tr")).toHaveLength(5);

  const members = screen
    .getByRole("heading", { name: "Members" })
    .closest("section");
  const member = screen.getByRole("link", { name: "King Thing" });
  expect(members.contains(member)).toBe(true);
  expect(member.getAttribute("href")).toBe("/explore/player/20JJJ2CCRU");
});

test("a week the record does not hold says why, in the tool's own words", async () => {
  const note =
    "No week 90/1 is recorded for #J2RGCRVG: recording of this clan's war history begins at season 110 section 0 (history_starts_at), so this week is before the horizon - unrecorded, not a week the clan sat out.";
  vi.spyOn(api, "explore").mockImplementation(async () =>
    answer({ clan_tag: "#J2RGCRVG", weeks: [], notes: [note] }),
  );
  renderWithProviders(
    <Explore me={{}} navigate={vi.fn()} path="/explore/week/J2RGCRVG~90~1" />,
  );
  await screen.findByText("No records");
  expect(screen.getByText(new RegExp("before the horizon"))).toBeTruthy();
});

test("a tag lookup's probe seeds the record, so the lookup costs one call", async () => {
  const body = { name: "King Thing", player_tag: "#20JJJ2CCRU", meta: {} };
  vi.spyOn(api, "publicStats").mockResolvedValue({
    ok: true,
    status: 200,
    data: {},
  });
  const explore = vi
    .spyOn(api, "explore")
    .mockImplementation(async (tool) =>
      tool === "collections_browse"
        ? answer({ collections: [] })
        : tool === "players_summary"
          ? answer(body)
          : { ok: true, status: 200, data: { is_error: true, body: {} } },
    );
  const navigate = vi.fn();
  const { rerender } = renderWithProviders(
    <Explore me={{}} navigate={navigate} path="/explore" />,
  );
  fireEvent.change(screen.getByLabelText("Look up a record"), {
    target: { value: "20JJJ2CCRU" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Look up" }));
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith("/explore/player/20JJJ2CCRU"),
  );

  rerender(
    <Explore me={{}} navigate={navigate} path="/explore/player/20JJJ2CCRU" />,
  );
  await screen.findByRole("heading", { name: "King Thing" });
  const summaries = explore.mock.calls.filter(
    ([tool]) => tool === "players_summary",
  );
  expect(summaries).toHaveLength(1);
  // The toolbar still shows the record's call, with the record's args.
  expect(screen.getByText(/players_summary/)).toBeTruthy();
});
