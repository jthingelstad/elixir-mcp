import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "./helpers.jsx";
import { MemberActivity } from "../src/views/MemberActivity.jsx";
import { api, manageApi } from "../src/api.js";
import { PlayerInClan, useClanOf } from "../src/views/PlayerInClan.jsx";
import { analyticsLocation, routeLabel } from "../src/analytics.js";
import { memberPath, playerInClanPath } from "../src/lib/base.js";
import { parseClanPath } from "../src/App.jsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const clan = { clan_tag: "#0QC8RCGY", name: "Example Clan" };
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
  renderWithProviders(<MemberActivity clan={clan} playerTag="#0GR" />);
  await screen.findByRole("heading", { name: /Test member/ });
  // A gap is unknown, in the words of the page's folded note.
  expect(
    screen.getByText(/No battle here does not prove no play/),
  ).toBeTruthy();
  expect(screen.getByText("Season 136, week 4")).toBeTruthy();
  expect(screen.getByText(/No battle in this clan on this page/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Older battles" }));
  await screen.findByRole("button", { name: "Newer battles" });
  expect(read).toHaveBeenLastCalledWith(
    clan.clan_tag,
    "#0GR",
    "next",
    data.window.to,
  );
});
test("member deep links parse and analytics never includes the player tag", () => {
  const path = memberPath(clan.clan_tag, "#02QQPCYQQ");
  expect(parseClanPath(path)).toEqual({
    tag: clan.clan_tag,
    section: "members",
    tab: "02qqpcyqq",
  });
  expect(analyticsLocation(path, "https://example.com").url).not.toMatch(
    /02qqpcyqq/i,
  );
  expect(
    routeLabel(
      "GET",
      "/api/clan/clans/0QC8RCGY/members/02QQPCYQQ/activity?cursor=secret",
    ),
  ).toBe("GET /api/clan/clans/*/members/*/activity");
});

test("on the player page it drops the Members head and keeps the record", async () => {
  vi.spyOn(manageApi, "memberActivity").mockResolvedValue({
    ok: true,
    status: 200,
    data,
  });
  renderWithProviders(
    <PlayerInClan clan={clan} playerTag="#0GR" navigate={() => {}} />,
  );
  await screen.findByText("Season 136, week 4");
  // The player page's own head names them; no way back to a roster.
  expect(screen.queryByRole("heading", { name: /Test member/ })).toBeNull();
  expect(screen.queryByText(/Back to Members/)).toBeNull();
});

test("the Clan tab is drawn only for a clan the viewer has a player in", async () => {
  vi.spyOn(api, "me").mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      ok: true,
      clans: [{ clan_tag: "#0QC8RCGY", role: "member", name: "Example Clan" }],
    },
  });
  function Probe({ tag, on = true }) {
    const { clan, pending } = useClanOf(tag, on);
    return <p>{pending ? "pending" : (clan?.name ?? "none")}</p>;
  }
  renderWithProviders(
    <>
      <Probe tag="#0QC8RCGY" />
      <Probe tag="#8ZZQ2YLL" />
    </>,
  );
  await screen.findByText("Example Clan");
  expect(screen.getByText("none")).toBeTruthy();
});

test("a closed Clan never reads Clan's session", () => {
  const me = vi.spyOn(api, "me");
  function Probe() {
    const { clan, pending } = useClanOf("#0QC8RCGY", false);
    return <p>{pending ? "pending" : (clan?.name ?? "none")}</p>;
  }
  renderWithProviders(<Probe />);
  expect(screen.getByText("none")).toBeTruthy();
  expect(me).not.toHaveBeenCalled();
});

test("another member's page is their player page's Clan tab", () => {
  expect(playerInClanPath("#02QQPCYQQ")).toBe(
    "/home/player/02QQPCYQQ?tab=clan",
  );
});
