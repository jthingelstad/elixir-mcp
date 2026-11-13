import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { seasonReport, weeklyReport } from "@elixir-mcp/clan-engine";
import {
  member,
  participation,
  seasonRecordFixture,
  NOW,
  EXAMPLE_POLICY,
} from "@elixir-mcp/clan-engine/fixtures";
import { renderWithProviders } from "./helpers.jsx";
import { Season, raceWeekPage } from "../src/views/Season.jsx";
import { manageApi } from "../src/api.js";
import { analyticsLocation } from "../src/analytics.js";
import { parseClanPath } from "../src/App.jsx";
import { tabOf } from "../src/lib/tabs.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#0QC8RCGY", name: "Example Clan", role: "member" };
const part = participation([
  member("#A", { name: "Ada" }),
  member("#B", { name: "Bo", war: [16, 16, 16, 16, 10, 0] }),
  member("#C", {
    name: "Cy",
    war: [0, 0, 0, 0, 0, 0],
    donations: [0, 0, 0, 0, 0, 0],
  }),
]);
const roster = {
  recent_events: [
    {
      type: "member_joined",
      at: "2026-08-20T00:00:00Z",
      detail: { player_tag: "#Z", name: "Zed" },
    },
    {
      type: "member_left",
      at: "2026-09-02T00:00:00Z",
      detail: { player_tag: "#L", name: "Lu", role_at_departure: "member" },
    },
  ],
};
const weekAnswer = (policy, data = {}) => ({
  ok: true,
  status: 200,
  data: {
    clan_tag: clan.clan_tag,
    clan_name: clan.name,
    as_of: NOW.toISOString(),
    freshness_seconds: 60,
    policy: { set: Boolean(policy), active: Boolean(policy) },
    ...weeklyReport(part, { roster, policy, now: NOW }),
    ...data,
  },
});
const seasonAnswer = () => {
  const f = seasonRecordFixture();
  return {
    ok: true,
    status: 200,
    data: {
      clan_tag: clan.clan_tag,
      clan_name: clan.name,
      as_of: f.part.meta.as_of,
      freshness_seconds: 300,
      ...seasonReport(f.part, f),
    },
  };
};
const reads = (week = weekAnswer(EXAMPLE_POLICY), season = seasonAnswer()) => {
  vi.spyOn(manageApi, "week").mockResolvedValue(week);
  vi.spyOn(manageApi, "season").mockResolvedValue(season);
};
const draw = (period = null, navigate = vi.fn()) =>
  renderWithProviders(
    <Season clan={clan} period={period} navigate={navigate} />,
  );
const heading = (name) => screen.findByRole("heading", { name });

describe("the week that is open", () => {
  test("opens on the running week and says what is highlighted", async () => {
    reads();
    draw();
    await heading(/so far/);
    expect(screen.getByText(/Highlighted: what this clan counts/)).toBeTruthy();
    expect(
      within(
        screen.getByRole("group", { name: "This week so far" }),
      ).getAllByText(/so far/).length,
    ).toBeGreaterThan(0);
  });

  test("with no policy it says why the busiest areas lead", async () => {
    reads(weekAnswer(null));
    draw();
    await screen.findByText(/have not set up how it runs/);
  });
});

describe("a closed week", () => {
  test("names everyone who took part and nobody else; a departure is departed, never kicked", async () => {
    const week = weekAnswer(EXAMPLE_POLICY, { so_far: null });
    reads(week);
    draw();
    const closed = await screen.findByRole("group", {
      name: /week/i,
    });
    expect(closed).toBeTruthy();
    expect(document.body.textContent).toMatch(/Ada/);
    expect(document.body.textContent).toMatch(/Bo/);
    expect(document.body.textContent).not.toMatch(/\bCy\b/);
    expect(document.body.textContent).toMatch(/departed/i);
    expect(document.body.textContent).not.toMatch(/\bkick/i);
  });

  test("a week before Elixir followed the clan says so", async () => {
    const report = weeklyReport(part, { roster, policy: null, now: NOW });
    const followed = new Date(
      Date.parse(report.week.from) + 3 * 86_400_000,
    ).toISOString();
    reads(
      weekAnswer(null, {
        so_far: null,
        areas: [],
        highlight: { basis: "activity", counted: [] },
        recorded_from: followed,
      }),
    );
    draw();
    await screen.findByText(/Elixir started following this clan on \w+ \d+/);
  });

  test("a week outside the read is said, with the way back", async () => {
    vi.spyOn(manageApi, "week").mockImplementation(async (_tag, week) =>
      week
        ? { ok: false, status: 404, data: { error: "no_week" } }
        : weekAnswer(EXAMPLE_POLICY),
    );
    vi.spyOn(manageApi, "season").mockResolvedValue(seasonAnswer());
    draw("2020-w10");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "outside this read",
    );
    expect(
      screen.getByRole("link", { name: "Current season" }).getAttribute("href"),
    ).toBe("/clan/0QC8RCGY/war");
  });
});

describe("a whole season", () => {
  test("shows recorded totals and race rows, and no stats beyond war", async () => {
    reads();
    draw("136");
    await heading(/All of Season 136/);
    const tiles = screen.getByRole("group", { name: "Season totals" });
    expect(tiles.textContent).toContain("84");
    expect(tiles.textContent).toContain("18,100");
    expect(tiles.textContent).toContain("Each player counted once");
    expect(screen.getByRole("table").textContent).not.toMatch(
      /inactive|win rate|donations|battles/i,
    );
  });

  test("a season outside the read has an honest return link", async () => {
    reads();
    draw("100");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "outside this read",
    );
    expect(
      screen.getByRole("link", { name: "Current season" }).getAttribute("href"),
    ).toBe("/clan/0QC8RCGY/war");
  });
});

describe("the period picker", () => {
  test("the running week, each week and each season's whole, each an address", async () => {
    const navigate = vi.fn();
    reads();
    draw(null, navigate);
    await heading(/so far/);
    const box = screen.getByLabelText("Period");
    const labels = within(box)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels.some((l) => /, so far$/.test(l))).toBe(true);
    expect(labels.some((l) => /^All of Season 136/.test(l))).toBe(true);
    fireEvent.change(box, { target: { value: "136" } });
    expect(navigate).toHaveBeenCalledWith("/clan/0QC8RCGY/war/136");
  });
});

describe("refusals", () => {
  test("refused and unavailable reads never show statistics", async () => {
    reads({ ok: false, status: 403, data: { error: "not_your_clan" } });
    draw();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "does not allow",
    );
    cleanup();
    reads({ ok: false, status: 502, data: { error: "elixir_unavailable" } });
    draw();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "did not answer",
    );
  });
});

test("its addresses sit on the War tab and collapse in analytics", () => {
  expect(tabOf("/clan/0QC8RCGY/war/136")).toBe("war");
  expect(tabOf("/clan/0QC8RCGY/war/2026-w36")).toBe("war");
  expect(parseClanPath("/clan/0QC8RCGY/war/136").section).toBe("war");
  expect(
    analyticsLocation("/clan/0QC8RCGY/war/136", "https://elixir.test").path,
  ).toBe("/clan/war");
  expect(
    analyticsLocation("/clan/0QC8RCGY/war/2026-w36", "https://elixir.test")
      .path,
  ).toBe("/clan/war");
});

describe("one week of a season, by its number", () => {
  const seasonRead = {
    seasons: [
      {
        season_id: 140,
        races: [
          {
            section_index: 0,
            from: "2026-11-02T09:40:00Z",
            to: "2026-11-09T09:40:00Z",
          },
          {
            section_index: 1,
            from: "2026-11-09T09:40:00Z",
            to: "2026-11-16T09:40:00Z",
          },
        ],
      },
    ],
  };
  const weekRead = {
    so_far: { iso_week: "2026-W46", from: "2026-11-09T00:00:00Z" },
    weeks: [{ iso_week: "2026-W45", from: "2026-11-02T00:00:00Z" }],
  };
  test("a season's nth week is the week page the race falls in", () => {
    expect(raceWeekPage(weekRead, seasonRead, "140", "1")).toBe("2026-w45");
    expect(raceWeekPage(weekRead, seasonRead, "140", 2)).toBe("2026-w46");
  });
  test("a week the reads cannot place has no page", () => {
    expect(raceWeekPage(weekRead, seasonRead, "140", "3")).toBe(null);
    expect(raceWeekPage(weekRead, seasonRead, "139", "1")).toBe(null);
    expect(raceWeekPage(weekRead, seasonRead, "140", "0")).toBe(null);
    expect(raceWeekPage({ weeks: [] }, seasonRead, "140", "1")).toBe(null);
  });
  test("the address is a War tab page, never an ISO week", () => {
    expect(parseClanPath("/clan/0QC8RCGY/war/136-2")).toEqual({
      tag: "#0QC8RCGY",
      section: "war",
      tab: "136-2",
    });
  });
  test("a week the read holds opens its week page in place of the address", async () => {
    const navigate = vi.fn();
    const week = weekAnswer(EXAMPLE_POLICY);
    const season = seasonAnswer();
    const s = season.data.seasons[0];
    const target = s.races
      .map((r) => ({
        r,
        page: raceWeekPage(
          week.data,
          season.data,
          s.season_id,
          r.section_index + 1,
        ),
      }))
      .find((x) => x.page);
    reads(week, season);
    draw(`${s.season_id}-${(target?.r.section_index ?? 0) + 1}`, navigate);
    if (target) {
      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith(
          `/clan/0QC8RCGY/war/${target.page}`,
          { replace: true },
        ),
      );
    } else {
      await heading(new RegExp(`All of Season ${s.season_id}`));
    }
  });
  test("a week outside the read stays on its season, honestly", async () => {
    reads();
    draw("100-2");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "outside this read",
    );
  });
});
