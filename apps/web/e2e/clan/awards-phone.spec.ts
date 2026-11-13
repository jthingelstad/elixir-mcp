import { test, expect } from "@playwright/test";
import { mockApi, signedIn } from "./fixtures.ts";

/* #386: on a phone the races were cards, so every member took three
   lines with the place alone on the first. They keep their columns now:
   place, member and figure on one row, nothing wider than the screen. */
const names = [
  "King Thing",
  "Eagle Fox Quail",
  "Kingfisher",
  "Sturdy",
  "buffalo",
  "Lord of Latency",
];
const tags = [
  "#098R2R0PUL",
  "#02QQPCYQQ",
  "#08CUCVCGQ",
  "#008JYPGJ",
  "#0CQ82QJYV",
  "#0JPCP0UYQC",
];
const members = names.map((name, i) => ({
  player_tag: tags[i],
  name,
  role: i === 0 ? "leader" : "member",
}));
const configs = [
  ["points", "season_points_podium", "Points Cup"],
  ["attendance", "perfect_attendance", "Perfect Attendance"],
  ["donations", "donations_podium", "Donation Cup"],
  ["pick", "leaders_pick", "Free Pass"],
].map(([id, kind, name]) => ({
  id: id as string,
  kind: kind as string,
  name: name as string,
  enabled: true,
  description: "",
  params: {},
}));
const rows = (kind: string) =>
  members.map((m, i) =>
    kind === "season_points_podium"
      ? {
          ...m,
          points: 12400 - i * 300,
          donations: 1820 - i * 10,
          place: i + 1,
          rank: i + 1,
          tied: i < 2,
          place_tied: false,
        }
      : kind === "donations_podium"
        ? {
            ...m,
            total: 1820 - i * 10,
            known_weeks: 3,
            weeks: 4,
            rank: i + 1,
            place: i + 1,
          }
        : {
            ...m,
            decks_short: i % 2 ? 0 : 3,
            decks_asked: 64,
            donations: 1820 - i * 10,
          },
  );
const view = () => ({
  clan_tag: "#0QC8RCGY",
  can_edit: true,
  can_grant: ["pick"],
  can_send: true,
  evaluated_at: "2026-10-03T12:00:00Z",
  as_of: "2026-10-03T12:00:00Z",
  freshness_seconds: 120,
  members,
  config: { schema: 1, awards: configs },
  config_version: 3,
  versions: [],
  kinds: {},
  grants: [
    {
      season_id: 137,
      award_id: "points",
      kind: "season_points_podium",
      name: "Points Cup",
      rank: 1,
      player_tag: tags[5],
      player_name: names[5],
      metric_value: 12400,
      metric_unit: "points",
      manual: false,
      granted_at: "2026-10-03T12:00:00Z",
    },
    {
      season_id: 137,
      award_id: "pick",
      kind: "leaders_pick",
      name: "Free Pass",
      rank: 1,
      player_tag: tags[1],
      player_name: names[1],
      metric_value: null,
      metric_unit: null,
      manual: true,
      note: "Moved to a new league, so every leader got a free pass",
      granted_by_name: "King Thing",
      granted_at: "2026-10-03T12:05:00Z",
    },
  ],
  seasons: [
    {
      season_id: 138,
      closed: false,
      complete: true,
      weeks: 2,
      awards: configs.map((c) => ({
        award_id: c.id,
        kind: c.kind,
        name: c.name,
        rule: "Synthetic fixture rule.",
        computed: c.kind !== "leaders_pick",
        state: c.kind === "leaders_pick" ? "manual" : "live",
        rows: c.kind === "leaders_pick" ? [] : rows(c.kind),
      })),
    },
    {
      season_id: 137,
      closed: true,
      closed_at: "2026-10-03T10:00:00Z",
      complete: true,
      weeks: 4,
      awards: configs.map((c) => ({
        award_id: c.id,
        kind: c.kind,
        name: c.name,
        rule: "Synthetic fixture rule.",
        computed: c.kind !== "leaders_pick",
        state: c.kind === "leaders_pick" ? "manual" : "closed",
        rows: c.kind === "leaders_pick" ? [] : rows(c.kind),
      })),
    },
  ],
});

for (const season of [138, 137])
  for (const width of [320, 375]) {
    test(`@narrow Awards season ${season} keeps each race row on one line at ${width}px`, async ({
      page,
    }) => {
      const responses = signedIn({
        "GET /api/clan/clans/0QC8RCGY/awards": [200, view()],
      });
      const roster = responses["GET /api/clan/roster"] as [
        number,
        Record<string, unknown>,
      ];
      responses["GET /api/clan/roster"] = [
        200,
        { ...roster[1], member_count: 12 },
      ];
      await mockApi(page, responses);
      await page.setViewportSize({ width, height: 812 });
      await page.goto(`/clan/0QC8RCGY/standings/${season}`);
      await expect(
        page.getByRole("heading", { name: "Awards", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".awards-race tbody tr").first()).toBeVisible();
      const report = await page.evaluate(() => {
        // Clan's six tabs scroll inside the kit's tab bar on a phone (slice
        // 8, #766), clipped there with a fade; the page itself must not.
        const wide = [...document.querySelectorAll("body *")].filter((el) => {
          if (el.closest(".kit-tabs")) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > innerWidth + 0.5;
        }).length;
        const split = [...document.querySelectorAll(".awards-race tbody tr")]
          .map((tr) =>
            [...tr.children].map((td) => td.getBoundingClientRect().top),
          )
          .filter((tops) => Math.max(...tops) - Math.min(...tops) > 1).length;
        return {
          scrollWidth: document.documentElement.scrollWidth,
          wide,
          split,
        };
      });
      expect(report).toEqual({ scrollWidth: width, wide: 0, split: 0 });
    });
  }
