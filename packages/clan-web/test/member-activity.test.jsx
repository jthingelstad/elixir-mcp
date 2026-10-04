import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import {
  MemberActivity,
  recordedSessions,
} from "../src/views/MemberActivity.jsx";
import { manageApi } from "../src/api.js";
import { analyticsLocation, routeLabel } from "../src/analytics.js";
import { memberPath } from "../src/lib/base.js";
import { parseClanPath } from "../src/App.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan" };
const data = {
  name: "Test member",
  window: { from: "2026-09-21T00:00:00Z", to: "2026-10-04T05:00:00Z" },
  weeks: [
    {
      iso_week: "2026-W40",
      from: "2026-09-28T00:00:00Z",
      to: "2026-10-04T05:00:00Z",
      partial: true,
      battles: 0,
      ranked_battles: null,
      donations: 12,
    },
  ],
  war_weeks: [{ season_id: 136, section_index: 3, decks: 0, points: 0 }],
  battles: [],
  next_cursor: "next",
  coverage: { available: false, intervals: [] },
};
test("member evidence retains unknowns and continues past an empty filtered page", async () => {
  const read = vi
    .spyOn(manageApi, "memberActivity")
    .mockResolvedValue({ ok: true, status: 200, data });
  renderWithProviders(<MemberActivity clan={clan} playerTag="#9QY" />);
  await screen.findByRole("heading", { name: /Test member · Activity/ });
  expect(screen.getByText(/No recorded activity is not proof/)).toBeTruthy();
  expect(screen.getByText(/Coverage could not be read/)).toBeTruthy();
  expect(screen.getByText("S136 W4")).toBeTruthy();
  expect(
    screen.getByText(/No clan battles recorded on this page/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Older records" }));
  await screen.findByRole("heading", { name: "Recorded sessions · page 2" });
  expect(read).toHaveBeenLastCalledWith(
    clan.clan_tag,
    "#9QY",
    "next",
    data.window.to,
  );
});
test("member deep links parse and analytics never includes the player tag", () => {
  const path = memberPath(clan.clan_tag, "#UQ8LP2R9C");
  expect(parseClanPath(path)).toEqual({
    tag: clan.clan_tag,
    section: "members",
    tab: "uq8lp2r9c",
  });
  expect(analyticsLocation(path, "https://example.com").url).not.toMatch(
    /uq8lp2r9c/i,
  );
  expect(
    routeLabel(
      "GET",
      "/api/clan/clans/2PQRJ8LV/members/UQ8LP2R9C/activity?cursor=secret",
    ),
  ).toBe("GET /api/clan/clans/*/members/*/activity");
});
test("recorded session groups retain distinct battle modes without pooled results", () => {
  const rows = [
    { battle_time: "2026-10-01T12:40:00Z", mode_group: "ranked" },
    { battle_time: "2026-10-01T12:25:00Z", mode_group: "war" },
    { battle_time: "2026-10-01T11:00:00Z", mode_group: "casual" },
  ];
  expect(recordedSessions(rows).map((s) => s.length)).toEqual([2, 1]);
  expect(recordedSessions(rows)[0].map((b) => b.mode_group)).toEqual([
    "ranked",
    "war",
  ]);
});

test("an exact thirty-minute gap starts a new recorded group", () => {
  expect(
    recordedSessions([
      { battle_time: "2026-10-01T12:30:00Z" },
      { battle_time: "2026-10-01T12:00:00Z" },
    ]).map((g) => g.length),
  ).toEqual([1, 1]);
});
