import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

const members = [
  { player_tag: "#20QQL8CCRU", name: "Ada", role: "leader" },
  { player_tag: "#UQ8LP2R9C", name: "Ben", role: "coLeader" },
] as const;
type Grant = {
  season_id: number;
  award_id: string;
  kind: string;
  name: string;
  rank: number;
  player_tag: string;
  player_name: string;
  metric_value: number | null;
  metric_unit: string | null;
  manual: boolean;
  granted_at: string;
  note?: string;
  granted_by_name?: string;
};
const configs = [
  {
    id: "points",
    kind: "season_points_podium",
    name: "Points Cup",
    params: { podium: 3 },
  },
  {
    id: "attendance",
    kind: "perfect_attendance",
    name: "Attendance Cup",
    params: { decks_per_day: 4, allowed_misses: 0 },
  },
  {
    id: "donations",
    kind: "donations_podium",
    name: "Donation Cup",
    params: { podium: 3 },
  },
  {
    id: "rookie",
    kind: "rookie_podium",
    name: "Rookie Cup",
    params: { podium: 3 },
  },
  {
    id: "pick",
    kind: "leaders_pick",
    name: "Clan Pick",
    params: { granted_by: "leaders" },
  },
].map((c) => ({
  ...c,
  enabled: true,
  description: "Review the final podium and previous holder before choosing.",
}));
const makeView = () => {
  const grants: Grant[] = configs.slice(0, 4).map((c) => ({
    season_id: 135,
    award_id: c.id,
    kind: c.kind,
    name: c.name,
    rank: 1,
    player_tag: members[0].player_tag,
    player_name: "Ada",
    metric_value:
      c.id === "attendance" ? 80 : c.id === "donations" ? 1200 : 16000,
    metric_unit:
      c.id === "attendance"
        ? "war_decks"
        : c.id === "donations"
          ? "donations"
          : "points",
    manual: false,
    granted_at: "2026-09-08T10:00:00Z",
  }));
  const awards = configs.map((c) => ({
    award_id: c.id,
    kind: c.kind,
    name: c.name,
    description: c.description,
    rule: "Synthetic fixture rule.",
    computed: c.kind !== "leaders_pick",
    state: c.id === "pick" ? "manual" : "closed",
    rows: [] as Record<string, unknown>[],
  }));
  return {
    clan_tag: "#2PQRJ8LV",
    can_edit: true,
    can_grant: ["pick"],
    evaluated_at: "2026-10-03T12:00:00Z",
    as_of: "2026-10-03T12:00:00Z",
    freshness_seconds: 120,
    members,
    config: { schema: 1, awards: configs },
    config_version: 1,
    versions: [],
    kinds: {},
    grants,
    seasons: [
      {
        season_id: 136,
        closed: false,
        complete: true,
        weeks: 4,
        awards: awards.map((a) => ({
          ...a,
          state: a.computed ? "live" : "manual",
          rows: [],
        })),
      },
      {
        season_id: 135,
        closed: true,
        closed_at: "2026-09-08T10:00:00Z",
        complete: true,
        weeks: 5,
        awards,
      },
    ] as const,
  };
};

for (const size of ["wide", "@narrow"]) {
  test(`all awards receipts and explicit manual confirmation ${size}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const data = makeView();
    const picks: unknown[] = [];
    const responses = signedIn({
      "GET /api/clan/clans/2PQRJ8LV/awards/manage": () => [200, data],
      "POST /api/clan/clans/2PQRJ8LV/awards/grants": (route) => {
        const body = route.request().postDataJSON();
        picks.push(body);
        const grant: Grant = {
          season_id: 135,
          award_id: "pick",
          kind: "leaders_pick",
          name: "Clan Pick",
          rank: 1,
          player_tag: members[1].player_tag,
          player_name: "Ben",
          metric_value: null,
          metric_unit: null,
          manual: true,
          granted_at: "2026-10-03T12:05:00Z",
          note: body.note,
          granted_by_name: "Ada",
        };
        data.grants.push(grant);
        const manual = data.seasons[1].awards.find(
          (a) => a.award_id === "pick",
        );
        if (!manual) throw new Error("Fixture manual award is missing");
        manual.rows.push({ ...grant, name: "Ben" });
        return [200, grant];
      },
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
    await page.goto("/clan/2PQRJ8LV/manage/awards");
    await expect(
      page.getByRole("heading", { name: "Awards", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("80 war decks", { exact: true })).toBeVisible();
    await expect(page.getByText("1,200 cards", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/No recorded Clan Pick grant for season 134/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Grant Clan Pick for season 135" })
      .click();
    await page
      .getByLabel("Member", { exact: true })
      .selectOption(members[1].player_tag);
    await expect(
      page.getByRole("button", { name: "Grant Clan Pick", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("Why this member")
      .fill("Reviewed the final podium and award history.");
    await expect(
      page.getByText(/Confirm Clan Pick for season 135 for Ben/),
    ).toBeVisible();
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      axe.violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/elixir-awards-${size === "wide" ? "wide" : "narrow"}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Grant Clan Pick", exact: true })
      .click();
    await expect(
      page
        .getByText("Reviewed the final podium and award history.", {
          exact: false,
        })
        .last(),
    ).toBeVisible();
    expect(picks).toEqual([
      {
        award_id: "pick",
        player_tag: members[1].player_tag,
        player_name: "Ben",
        season_id: 135,
        note: "Reviewed the final podium and award history.",
      },
    ]);
    expect(errors).toEqual([]);
  });

  test(`segmented awards retain complete reviewed copy ${size}`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const action = {
      card_id: "awards1",
      number: 38,
      type: "awards_announcement",
      label: "Announce season awards",
      status: "proposed",
      can_act: true,
      audience: { kind: "leaders" },
      player_tag: null,
      player_name: null,
      raised_at: "2026-10-03T12:00:00Z",
      channel: "leader_message",
      message: {
        title: "S135 awards 1/2",
        body: "Points Cup: Ada, Ben; Attendance Cup: Ada",
      },
      evidence: {
        season_id: 135,
        part: 1,
        parts: 2,
        awards: [
          { name: "Points Cup", winners: ["Ada", "Ben"] },
          { name: "Attendance Cup", winners: ["Ada"] },
        ],
      },
      log: [],
    };
    const responses = signedIn({
      "GET /api/clan/clans/2PQRJ8LV/actions/38": [
        200,
        {
          clan_tag: "#2PQRJ8LV",
          action,
          decline_reasons: [],
          model: { set: true, refused: false },
        },
      ],
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
    await page.goto("/clan/2PQRJ8LV/actions/38");
    await expect(
      page.getByText(/Message 1 of 2; send every part/),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Copy the message", exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      action.message.body,
    );
    await expect(
      page.getByRole("button", { name: "Sent", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/elixir-awards-message-${size === "wide" ? "wide" : "narrow"}.png`,
      fullPage: true,
    });
  });
}
