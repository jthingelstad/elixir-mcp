import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { FIELDS, GROUPS, TABS, defaults } from "@elixir-mcp/clan-engine";
import { clanTab, ME, mockApi, signedIn } from "./fixtures.ts";
import { HOME_READS } from "../home-fixture.ts";

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
        picks_open: true,
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
    // Home draws its feed for a player on record (#765).
    ...HOME_READS,
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
        seen_to: null,
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
      await page.goto(`${base}/members`);
      await expect(clanTab(page, "Run")).toHaveCount(0);
      // One page since G6: Scout at its foot for an elder, never a member.
      await expect(page.getByRole("region", { name: "Scout" })).toHaveCount(
        role === "elder" ? 1 : 0,
      );
      // Review is in Run, which stays the leaders'.
      await page.goto(`${base}/run/review`);
      await expect(page.getByRole("alert")).toContainText(
        "Run is for the clan’s leader and co-leaders",
      );
      // Run is the leaders' (slice 8, #766): a member who types its
      // address is told so, with nothing to change, and sent to Policy.
      await page.goto(`${base}/run/about`);
      await expect(page.getByRole("alert")).toContainText(
        "Run is for the clan’s leader and co-leaders",
      );
      await expect(
        page.getByRole("button", { name: "Save this clan's policy" }),
      ).toHaveCount(0);
      await page.getByRole("link", { name: "Open Policy" }).click();
      await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/policy$/);
      // Standing is on Standings, open to every member as before.
      await page.goto(`${base}/standings`);
      await expect(page.getByText(/^How it works here/).first()).toBeVisible();
      // A name opens the player page; the member's page in this clan keeps
      // its address.
      await expect(
        page
          .getByRole("region", { name: "Standing" })
          .getByRole("link", { name: "Ben", exact: true }),
      ).toHaveAttribute("href", "/home/player/UQ8LP2R9C");
      await page.goto(`${base}/members/uq8lp2r9c`);
      await expect(
        page.getByText(
          /^A gap is unknown\. No battle here does not prove no play/,
        ),
      ).toBeHidden();
      await page.goto(`${base}/standings`);
      await expect(
        page.getByRole("button", { name: /Grant Clan Pick for season 135/ }),
      ).toHaveCount(role === "elder" ? 1 : 0);
      await expect(
        page.getByRole("button", {
          name: /edit the awards|update to clan/,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Ben", exact: true }).first(),
      ).toHaveAttribute("href", "/home/player/UQ8LP2R9C");
      await page.goto(`${base}/feed`);
      await expect(
        page.getByText("Nothing waiting for you", { exact: true }),
      ).toBeVisible();
      await page.goto(`${base}/actions/99`);
      await expect(
        page.getByText("No action #99 here", { exact: true }),
      ).toBeVisible();
      await page.goto(`${base}/members/me`);
      await expect(
        page.getByText("Before roster recording", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/Zero battles here does not prove no play/),
      ).toBeVisible();
      await page.goto(`${base}/members/map`);
      await expect(
        page.getByRole("heading", { name: "Clan map", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/only verified members/)).toBeVisible();
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
      await page.goto("/home");
      await expect(
        page.getByRole("heading", { level: 1, name: "Home", exact: true }),
      ).toBeVisible();
      await expect(
        page
          .locator(".kit-feed__text")
          .getByText("Ada played recorded games.", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(/changes nothing your connections have read/),
      ).toBeVisible();
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`${role} under ten keeps member navigation and explains unavailable awards ${size}`, async ({
      page,
    }) => {
      await mockApi(page, roleRoutes(role, true));
      await page.goto(`${base}/standings`);
      await expect(page.getByText(/starts at 10 members/)).toBeVisible();
      await expect(clanTab(page, "Run")).toHaveCount(0);
      for (const name of [/^Feed/, "Standings", "War", "Members", "Policy"])
        await expect(clanTab(page, name)).toBeVisible();
      await clanTab(page, "Members").click();
      await expect(
        page.getByRole("link", { name: "Clan map", exact: true }),
      ).toBeVisible();
      // Recruit is the elders' and up (Jamie, 2026-11-12); with no active
      // policy a member's foot has nothing else, so it is not drawn.
      await expect(
        page.getByRole("region", { name: "Spread the word" }),
      ).toHaveCount(role === "elder" ? 1 : 0);
    });
  }

for (const size of ["wide", "@narrow"])
  test(`failed and denied member reads show a result instead of endless loading ${size}`, async ({
    page,
  }) => {
    const routes = roleRoutes("member");
    for (const part of ["awards", "policy", "actions", "me", "week", "map"])
      routes[`GET ${apiBase}/${part}`] = [403, { error: "forbidden" }];
    await mockApi(page, routes);
    for (const path of [
      "standings",
      "feed",
      "members/me",
      "war",
      "members/map",
    ]) {
      await page.goto(`${base}/${path}`);
      await expect(page.getByRole("alert")).toBeVisible();
    }
    routes[`GET ${apiBase}/members/UQ8LP2R9C/activity`] = [
      503,
      { error: "unavailable" },
    ];
    await page.goto(`${base}/members/uq8lp2r9c`);
    // The shared client quietly retries a 503 once. In a full concurrent
    // run its timer can be delayed beyond the default five-second wait.
    await expect(page.getByRole("alert")).toContainText(
      "This page did not load",
      { timeout: 10_000 },
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
    await page.goto(`${base}/members`);
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
    await page.goto(`${base}/run/decided`);
    await expect(page.getByRole("alert")).toContainText(
      "This page did not load",
    );
    await expect(
      page.getByText(
        "No join, leave or role change in the recent roster-event window.",
      ),
    ).toHaveCount(0);
  });

for (const size of ["wide", "@narrow"])
  for (const role of ["member", "elder"] as const)
    test(`${role} direct Scout entry matches the permitted role before a live read ${size}`, async ({
      page,
    }) => {
      let reads = 0;
      const routes = roleRoutes(role);
      routes[`POST ${apiBase}/scout`] = () => {
        reads++;
        return [403, { error: "elders_only" }];
      };
      await mockApi(page, routes);
      await page.goto(`${base}/members/scout`);
      if (role === "member") {
        // Scout's old address opens the roster's foot, where Scout says
        // whose it is.
        await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/members\?show=scout$/);
        await expect(page.getByRole("alert")).toContainText(
          "Scout is for elders, co-leaders and the leader",
        );
        await expect(
          page.getByRole("main").getByRole("button", {
            name: "Scout",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(page.getByPlaceholder("#TAG from the game")).toHaveCount(
          0,
        );
      } else {
        await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/members\?show=scout$/);
        await expect(
          page.getByRole("main").getByRole("button", {
            name: "Scout",
            exact: true,
          }),
        ).toBeEnabled();
        await expect(
          page.getByRole("textbox", { name: "Player tag", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: `/tmp/elixir-elder-scout-${size.replace("@", "")}.png`,
          fullPage: true,
        });
      }
      expect(reads).toBe(0);
    });

for (const size of ["wide", "@narrow"])
  for (const role of ["member", "elder"] as const)
    test(`${role} direct Run entry is refused, with no leader controls ${size}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let writes = 0;
      const routes = roleRoutes(role);
      routes[`PUT ${apiBase}/social`] = () => {
        writes++;
        return [403, { error: "leaders_only" }];
      };
      routes[`PUT ${apiBase}/voice`] = () => {
        writes++;
        return [403, { error: "leaders_only" }];
      };
      await mockApi(page, routes);
      for (const slug of [
        "settings",
        "model-voice",
        "discord",
        "awards-setup",
      ]) {
        await page.goto(`${base}/run/${slug}`);
        await expect(page.getByRole("alert")).toContainText(
          "Run is for the clan’s leader and co-leaders",
        );
      }
      await expect(
        page.getByRole("button", { name: /Turn the member map/ }),
      ).toHaveCount(0);
      await expect(page.getByLabel("How our messages sound")).toHaveCount(0);
      await page.screenshot({
        path: `/tmp/elixir-${role}-settings-${size.replace("@", "")}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
      expect(writes).toBe(0);
    });

for (const size of ["wide", "@narrow"])
  for (const role of ["leader", "coLeader"] as const)
    test(`${role} Settings entry keeps its existing Social control ${size}`, async ({
      page,
    }) => {
      const first = {
        ...ME.clans[0]!,
        role,
        role_label: role === "leader" ? "Leader" : "Co-leader",
      };
      const me = { ...ME, clans: [first], selected: first };
      await mockApi(
        page,
        signedIn({
          "GET /api/clan/me": [200, me],
          [`GET ${apiBase}/social`]: [200, { enabled: true }],
          [`GET ${apiBase}/sharing`]: [200, { types: {} }],
          [`GET ${apiBase}/model`]: [
            200,
            { set: false, models: [], uses: { recent: [] }, per_day: 20 },
          ],
        }),
      );
      await page.goto(`${base}/run/settings`);
      await expect(
        page.getByRole("checkbox", { name: /^Member map/ }),
      ).toBeEnabled();
      await expect(
        page.getByText(
          "Only the leader and co-leaders can change this setting.",
          { exact: true },
        ),
      ).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
