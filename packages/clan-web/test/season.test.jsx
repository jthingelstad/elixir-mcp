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
import { Season } from "../src/views/Season.jsx";
import { manageApi } from "../src/api.js";
import { analyticsLocation } from "../src/analytics.js";
import { parseClanPath } from "../src/App.jsx";
import { tabOf } from "../src/lib/tabs.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const clan = { clan_tag: "#2PQRJ8LV", name: "Example Clan", role: "member" };
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
    ).toBe("/clan/2PQRJ8LV/season");
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
    ).toBe("/clan/2PQRJ8LV/season");
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
    expect(navigate).toHaveBeenCalledWith("/clan/2PQRJ8LV/season/136");
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

test("its addresses sit on the Season tab and collapse in analytics", () => {
  expect(tabOf("/clan/2PQRJ8LV/season/136")).toBe("season");
  expect(tabOf("/clan/2PQRJ8LV/season/2026-w36")).toBe("season");
  expect(parseClanPath("/clan/2PQRJ8LV/season/136").section).toBe("season");
  expect(
    analyticsLocation("/clan/2PQRJ8LV/season/136", "https://elixir.test").path,
  ).toBe("/clan/season");
  expect(
    analyticsLocation("/clan/2PQRJ8LV/season/2026-w36", "https://elixir.test")
      .path,
  ).toBe("/clan/season");
});
