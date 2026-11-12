import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./fixtures.ts";

/**
 * Clan › Members' head, as the canvas draws it (2026-11-12): the member
 * count, how many you follow, Follow everyone (Home's follow-all, priced
 * before the tap, refused whole past the limit) and the way to the clan
 * map. A plain member reads it, not only leaders. Phone and desktop width,
 * with axe. Invented players; local mocks only.
 */

const base = "/clan/2PQRJ8LV";
const apiBase = "/api/clan/clans/2PQRJ8LV";

/** Signed in as a plain member of Example Clan, with it selected. */
function asMember(extra: Parameters<typeof signedIn>[0] = {}) {
  const selected = { ...ME.clans[0], role: "member", role_label: "Member" };
  return signedIn({
    "GET /api/clan/me": [
      200,
      { ...ME, selected, clans: [selected, ME.clans[1]] },
    ],
    ...extra,
  });
}

const PLAN = {
  clan_tag: "#2PQRJ8LV",
  players: [
    {
      player_tag: "#UQ8LP2R9C",
      name: "Ben",
      following: false,
      free: true,
      reason: "followed_by_others",
    },
    {
      player_tag: "#M1",
      name: "Zed",
      following: false,
      free: false,
      reason: null,
    },
  ],
  yours: ["#20QQL8CCRU"],
  to_follow: 2,
  free: 1,
  slots: 1,
  following: 0,
  used: 3,
  limit: 50,
  fits: true,
};

const AUSTIN = {
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

async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? ""),
  );
  expect(
    serious.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
    `${name}: accessibility`,
  ).toEqual([]);
}

async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

for (const [label, width] of [
  ["desktop", 1180],
  ["phone", 390],
] as const) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("Follow everyone shows its cost first, and follows in one act", async ({
      page,
    }) => {
      const posted: unknown[] = [];
      await mockApi(
        page,
        asMember({
          "GET /api/me/follow-plan": [200, PLAN],
          "POST /api/me/follow-all": (route) => {
            posted.push(route.request().postDataJSON());
            return [
              200,
              {
                ok: true,
                followed: ["#UQ8LP2R9C", "#M1"],
                clan_tag: "#2PQRJ8LV",
              },
            ];
          },
        }),
      );
      await page.goto(`${base}/members`);
      const roster = page.getByRole("region", { name: "3 members" });
      await expect(roster).toContainText("You follow 0");
      await expect(
        roster.getByRole("link", { name: "Clan map" }),
      ).toHaveAttribute("href", `${base}/members/map`);
      await noSideways(page);
      await accessible(page, `members head ${label}`);

      await roster.getByRole("button", { name: "Follow everyone" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Follow everyone in Example Clan?",
      });
      await expect(dialog).toContainText(
        "2 players to follow · 1 free · 1 uses a slot · 3 of 50 slots used now. Your own player is left out.",
      );
      await accessible(page, `follow everyone dialog ${label}`);
      await dialog.getByRole("button", { name: "Follow everyone" }).click();
      await expect(dialog).toHaveCount(0);
      expect(posted).toEqual([{ clan_tag: "#2PQRJ8LV" }]);
    });

    test("Follow everyone is refused past the limit, and says why", async ({
      page,
    }) => {
      const posted: unknown[] = [];
      await mockApi(
        page,
        asMember({
          "GET /api/me/follow-plan": [
            200,
            { ...PLAN, free: 0, slots: 2, used: 49, fits: false },
          ],
          "POST /api/me/follow-all": (route) => {
            posted.push(route.request().postDataJSON());
            return [429, { error: "quota_exceeded" }];
          },
        }),
      );
      await page.goto(`${base}/members`);
      const roster = page.getByRole("region", { name: "3 members" });
      await expect(
        roster.getByRole("button", { name: "Follow everyone" }),
      ).toBeDisabled();
      await expect(roster.getByRole("status")).toContainText(
        "Only 1 of your 50 player slots are left, so nobody would be followed.",
      );
      await noSideways(page);
      await accessible(page, `follow everyone refused ${label}`);
      expect(posted).toEqual([]);
    });

    test("the clan map opens from Members, with your place on it", async ({
      page,
    }) => {
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
      await mockApi(
        page,
        asMember({
          "GET /api/me/follow-plan": [
            200,
            { ...PLAN, to_follow: 0, free: 0, slots: 0, following: 2 },
          ],
          [`GET ${apiBase}/map`]: [
            200,
            {
              clan_tag: "#2PQRJ8LV",
              members: 3,
              on_map: 1,
              entries: [
                {
                  player_tag: "#UQ8LP2R9C",
                  name: "Ben",
                  role: "coLeader",
                  role_label: "Co-leader",
                  you: false,
                  place: AUSTIN,
                },
              ],
              yours: null,
              attribution: "Synthetic map fixture.",
            },
          ],
          "GET /api/clan/me/place": [200, { place: null }],
        }),
      );
      await page.goto(`${base}/members`);
      const roster = page.getByRole("region", { name: "3 members" });
      // Everyone followed already: the head says so and offers nothing.
      await expect(
        roster.getByRole("button", { name: "Following everyone" }),
      ).toBeDisabled();
      await expect(roster).toContainText("You follow 2");
      await roster.getByRole("link", { name: "Clan map" }).click();
      await expect(page).toHaveURL(new RegExp(`${base}/members/map$`));
      await expect(page.getByText("1 of 3 members on the map")).toBeVisible();
      await expect(page.getByText(/only verified members of/)).toBeVisible();
      const yours = page.getByRole("region", { name: "Your place" });
      await expect(yours.getByLabel("Country")).toBeVisible();
      await noSideways(page);
      await accessible(page, `clan map ${label}`);
    });
  });
}
