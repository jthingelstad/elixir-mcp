import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { FIELDS, GROUPS, TABS, defaults } from "@elixir-mcp/clan-engine";
import { ME, mockApi, signedIn } from "./fixtures.ts";

const base = "/clan/2PQRJ8LV";
const apiBase = "/api/clan/clans/2PQRJ8LV";
const ben = { player_tag: "#UQ8LP2R9C", name: "Ben", role: "member" };
const stamp = "2026-10-04T12:00:00Z";
const place = {
  country: "US",
  country_name: "United States",
  region: "TX",
  region_name: "Texas",
  city: 4671654,
  city_name: "Austin",
  precision: "city",
  lat: 30.27,
  lng: -97.74,
  tz: "America/Chicago",
};

const activity = {
  name: "Ben",
  as_of: stamp,
  window: { from: "2026-09-21T00:00:00Z", to: stamp },
  weeks: [],
  war_weeks: [],
  battles: [],
  next_cursor: null,
  coverage: { available: false, intervals: [] },
};
const points = {
  id: "points",
  kind: "season_points_podium",
  name: "Points Cup",
  enabled: true,
  params: { podium: 3 },
};
const pick = {
  id: "pick",
  kind: "leaders_pick",
  name: "Clan Pick",
  enabled: true,
  params: { granted_by: "elders" },
};

function roleRoutes(role: "member" | "elder", small = false) {
  const first = {
    ...ME.clans[0]!,
    role,
    role_label: role === "elder" ? "Elder" : "Member",
  };
  const me = {
    ...ME,
    clans: [first],
    selected: first,
    identities: ME.identities.map((identity) => ({
      ...identity,
      role,
      role_label: first.role_label,
    })),
    open_actions: 0,
    policy: { ...ME.policy, active: !small, members: small ? 3 : 12 },
  };
  const awards = {
    can_edit: false,
    can_grant: role === "elder" ? ["pick"] : [],
    can_send: false,
    config: { schema: 1, awards: [points, pick] },
    config_version: 1,
    kinds: {},
    versions: [],
    members: [ben],
    grants: [
      {
        season_id: 135,
        award_id: "points",
        kind: points.kind,
        name: points.name,
        rank: 1,
        player_tag: ben.player_tag,
        player_name: ben.name,
        metric_value: 16000,
        metric_unit: "points",
        manual: false,
        granted_at: stamp,
      },
    ],
    seasons: [
      {
        season_id: 135,
        closed: true,
        complete: true,
        weeks: 5,
        awards: [
          {
            award_id: "points",
            kind: points.kind,
            name: points.name,
            state: "closed",
            rows: [],
            rule: "Season points; donations break ties.",
          },
          {
            award_id: "pick",
            kind: pick.kind,
            name: pick.name,
            state: "manual",
            rows: [],
            rule: "Leaders and elders choose.",
          },
        ],
      },
    ],
  };
  return signedIn({
    "GET /api/clan/me": [200, me],
    "GET /api/me/timeline": [
      200,
      {
        timeline: [
          {
            id: "tl_00000000000000000000",
            revision: 1,
            at: stamp,
            subject_name: "Ada",
            subject_tag: first.acting_as,
            kind: "battle_session",
            text: "Ada played recorded games.",
            facts: {},
          },
        ],
        window: { from: "2026-09-27T12:00:00Z", to: stamp },
        read_to: null,
      },
    ],
    [`GET ${apiBase}/actions`]: [200, { open: [], recent: [] }],
    [`GET ${apiBase}/actions/99`]: [404, { error: "no_action" }],
    [`GET ${apiBase}/manage`]: [403, { error: "forbidden" }],
    [`GET ${apiBase}/policy`]: [
      200,
      {
        can_edit: false,
        set: true,
        big_enough: !small,
        members: small ? 3 : 12,
        min_members: 10,
        current: { values: defaults(), version: 1 },
        fields: FIELDS,
        groups: GROUPS,
        tabs: TABS,
        versions: [],
      },
    ],
    [`GET ${apiBase}/awards`]: small
      ? [409, { error: "too_few_members", members: 3, min_members: 10 }]
      : [200, awards],
    [`GET ${apiBase}/trophies`]: [200, { awards: [], yours: [], seasons: [] }],
    [`GET ${apiBase}/members/UQ8LP2R9C/activity`]: [200, activity],
    [`GET ${apiBase}/standing`]: [
      200,
      {
        policy_version: 1,
        weights: [],
        how: [
          {
            key: "war",
            title: "Clan Wars",
            lines: [
              "Recorded participation informs the clan policy; leaders decide changes.",
            ],
          },
        ],
        rows: [
          {
            ...ben,
            status: "participating",
            evidence: "Recorded donations",
            war: [],
          },
        ],
        you: null,
      },
    ],
    [`GET ${apiBase}/week`]: [
      200,
      {
        clan_name: "Example Clan",
        as_of: stamp,
        members: 12,
        policy: { set: true, active: !small },
        week: {
          iso_week: "2026-W39",
          from: "2026-09-21T10:00:00Z",
          to: "2026-09-28T10:00:00Z",
        },
        weeks: [],
        highlight: { basis: "policy", counted: ["donations"] },
        areas: [
          {
            key: "donations",
            label: "Donations",
            total: 100,
            highlighted: true,
            participants: [{ ...ben, value: 100 }],
          },
        ],
        membership: {
          joined: [],
          departed: [],
          promoted: [],
          demoted: [],
          complete: false,
        },
        so_far: null,
      },
    ],
    [`GET ${apiBase}/me`]: [
      200,
      {
        clan_name: "Example Clan",
        as_of: stamp,
        members: small ? 3 : 12,
        min_members: 10,
        policy: { set: true, active: !small },
        open_actions: 0,
        clan: null,
        hold: null,
        trophies: [],
        you: {
          player_tag: first.acting_as,
          name: "Ada",
          role,
          this_week: { battles: 0, ranked_battles: null, donations: null },
          this_war_week: null,
          weeks: [
            {
              from: "2026-08-24T10:00:00Z",
              to: "2026-08-31T10:00:00Z",
              complete: true,
              battles: 0,
              ranked_battles: 0,
              donations: null,
            },
          ],
          war_weeks: [],
          trophies: 7000,
          time_here: {
            events: [],
            tenure_known: false,
            recording_since: "2026-09-10T12:00:00Z",
            days: null,
          },
        },
      },
    ],
    [`GET ${apiBase}/map`]: [
      200,
      {
        members: 12,
        on_map: 1,
        entries: [
          {
            player_tag: first.acting_as,
            name: "Ada",
            role,
            role_label: first.role_label,
            you: true,
            place,
          },
        ],
        attribution: "Synthetic map fixture.",
      },
    ],
    "GET /api/clan/me/place": [
      200,
      {
        place,
      },
    ],
  });
}

for (const size of ["wide", "@narrow"])
  for (const role of ["member", "elder"] as const) {
    test(`${role} reads permitted clan views without leader controls ${size}`, async ({
      page,
    }) => {
      const writes: string[] = [],
        errors: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/clan/") && request.method() !== "GET")
          writes.push(request.url());
      });
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("https://tile.openstreetmap.org/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=",
            "base64",
          ),
        }),
      );
      await mockApi(page, roleRoutes(role));
      await page.goto(base);
      if (size === "@narrow")
        await page.getByRole("button", { name: /Clan.*Example Clan/ }).click();
      const rail = page.locator(".rail");
      for (const name of ["Board", "History", "Policy", "Settings"])
        await expect(rail.getByRole("link", { name, exact: true })).toHaveCount(
          0,
        );
      await expect(
        rail.getByRole("link", { name: "Scout", exact: true }),
      ).toHaveCount(role === "elder" ? 1 : 0);
      await page.goto(`${base}/manage/board`);
      await expect(page.getByRole("alert")).toContainText(
        "Manage is for the leader and co-leaders",
      );
      await page.goto(`${base}/manage/policy`);
      await expect(page.getByRole("tablist", { name: "Policy" })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Save this clan's policy" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("combobox", { name: /Clan War participation/ }),
      ).toBeDisabled();
      await page.goto(`${base}/standing`);
      await expect(
        page.getByRole("heading", { name: "How it works here" }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Ben", exact: true }).click();
      await expect(
        page.getByText(/No recorded activity is not proof/),
      ).toBeVisible();
      await expect(
        page.getByText(/No clan battles recorded on this page/),
      ).toBeVisible();
      await page.goto(`${base}/week`);
      await page.getByRole("link", { name: "Ben", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Ben · Activity" }),
      ).toBeVisible();
      await page.goto(`${base}/awards`);
      await expect(
        page.getByRole("button", { name: /Grant Clan Pick for season 135/ }),
      ).toHaveCount(role === "elder" ? 1 : 0);
      await expect(
        page.getByRole("button", {
          name: /edit the awards|update to clan/,
        }),
      ).toHaveCount(0);
      await page.getByRole("link", { name: "Ben", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Ben · Activity" }),
      ).toBeVisible();
      await page.goto(`${base}/trophies`);
      await expect(
        page.getByText("No awards yet", { exact: true }),
      ).toBeVisible();
      await page.goto(`${base}/actions`);
      await expect(
        page.getByText("Nothing waiting for you", { exact: true }),
      ).toBeVisible();
      await page.goto(`${base}/actions/99`);
      await expect(
        page.getByText("No action #99 here", { exact: true }),
      ).toBeVisible();
      await page.goto(`${base}/me`);
      await expect(
        page.getByRole("heading", { name: "You here", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Before roster recording", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/Zero recorded battles does not prove inactivity/),
      ).toBeVisible();
      await page.goto(`${base}/map`);
      await expect(
        page.getByRole("heading", { name: "Clan map", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/only signed-in members/)).toBeVisible();
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        axe.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      await page.screenshot({
        path: `/tmp/elixir-${role}-map-${size.replace("@", "")}.png`,
        fullPage: true,
      });
      await page.goto("/console/account/timeline");
      await expect(
        page.getByRole("heading", { name: "Timeline", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", {
          name: "Ada played recorded games.",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(/Reading this page never moves a connection/),
      ).toBeVisible();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`${role} under ten keeps member navigation and explains unavailable awards ${size}`, async ({
      page,
    }) => {
      await mockApi(page, roleRoutes(role, true));
      await page.goto(`${base}/awards`);
      await expect(page.getByText(/starts at 10 members/)).toBeVisible();
      if (size === "@narrow")
        await page
          .getByRole("complementary")
          .getByRole("button")
          .first()
          .click();
      for (const name of [
        "Actions",
        "Standing",
        "Award history",
        "Award races",
        "Board",
        "Policy",
      ])
        await expect(
          page
            .locator(".rail")
            .getByRole("link", { name: new RegExp(`^${name}`) }),
        ).toHaveCount(0);
      for (const name of ["Clan", "You here", "The week", "Map", "Recruit"])
        await expect(
          page.locator(".rail").getByRole("link", { name, exact: true }),
        ).toBeVisible();
    });
  }

for (const size of ["wide", "@narrow"])
  test(`failed and denied member reads show a result instead of endless loading ${size}`, async ({
    page,
  }) => {
    const routes = roleRoutes("member");
    for (const part of [
      "awards",
      "policy",
      "actions",
      "me",
      "week",
      "map",
      "trophies",
    ])
      routes[`GET ${apiBase}/${part}`] = [403, { error: "forbidden" }];
    await mockApi(page, routes);
    for (const path of [
      "awards",
      "manage/policy",
      "actions",
      "me",
      "week",
      "map",
      "trophies",
    ]) {
      await page.goto(`${base}/${path}`);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    routes[`GET ${apiBase}/policy`] = [503, { error: "unavailable" }];
    await page.goto(`${base}/manage/policy`);
    await expect(page.getByRole("alert")).toContainText(
      "Elixir did not answer the policy read",
    );
    routes[`GET ${apiBase}/members/UQ8LP2R9C/activity`] = [
      503,
      { error: "unavailable" },
    ];
    await page.goto(`${base}/members/uq8lp2r9c`);
    await expect(page.getByRole("alert")).toContainText(
      "Activity is unavailable",
    );
  });

for (const size of ["wide", "@narrow"])
  test(`empty capture and failed History remain distinct from no recorded events ${size}`, async ({
    page,
  }) => {
    const routes = roleRoutes("member");
    routes["GET /api/clan/roster"] = [
      200,
      {
        clan_tag: "#2PQRJ8LV",
        name: "Example Clan",
        member_count: 0,
        members: [],
        comings: [],
        role_counts: {},
        meta: { as_of: stamp },
      },
    ];
    await mockApi(page, routes);
    await page.goto(base);
    await expect(
      page.getByText("No members on the record", { exact: true }),
    ).toBeVisible();
    const first = { ...ME.clans[0]! };
    routes["GET /api/clan/me"] = [
      200,
      { ...ME, clans: [first], selected: first },
    ];
    routes[`GET ${apiBase}/manage`] = [
      200,
      { boundaries: [], policy_version: 1 },
    ];
    routes[`GET ${apiBase}/history`] = [503, { error: "unavailable" }];
    await page.goto(`${base}/manage/history`);
    await expect(page.getByRole("alert")).toContainText(
      "History could not be read",
    );
    await expect(
      page.getByText(
        "No join, leave or role change in the recent roster-event window.",
      ),
    ).toHaveCount(0);
  });
