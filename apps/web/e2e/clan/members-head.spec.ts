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

const base = "/clan/0QC8RCGY";
const apiBase = "/api/clan/clans/0QC8RCGY";

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
  clan_tag: "#0QC8RCGY",
  players: [
    {
      player_tag: "#02QQPCYQQ",
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
  yours: ["#098R2R0PUL"],
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
                followed: ["#02QQPCYQQ", "#M1"],
                clan_tag: "#0QC8RCGY",
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
        "2 players · uses 1 of your 50 follows. Your own player is left out.",
      );
      await accessible(page, `follow everyone dialog ${label}`);
      await dialog.getByRole("button", { name: "Follow everyone" }).click();
      await expect(dialog).toHaveCount(0);
      expect(posted).toEqual([{ clan_tag: "#0QC8RCGY" }]);
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

    test("a row's Follow shows its cost first and follows that one player", async ({
      page,
    }) => {
      const posted: unknown[] = [];
      await mockApi(
        page,
        asMember({
          "GET /api/me/follow-plan": [
            200,
            {
              ...PLAN,
              players: [
                { ...PLAN.players[0], following: true },
                PLAN.players[1],
              ],
              to_follow: 1,
              following: 1,
            },
          ],
          "POST /api/claims": (route) => {
            posted.push(route.request().postDataJSON());
            return [
              201,
              { ok: true, player_tag: "#M1", relationship: "friend" },
            ];
          },
        }),
      );
      await page.goto(`${base}/members`);
      const roster = page.getByRole("region", { name: "3 members" });
      const row = (name: string) =>
        roster.getByRole("row").filter({ hasText: name });
      // Your own player has no Follow; one you follow says so.
      await expect(row("Ada").getByRole("button")).toHaveCount(0);
      await expect(row("Ben")).toContainText("Following");
      await expect(row("Ben").getByRole("button")).toHaveCount(0);
      await noSideways(page);
      await accessible(page, `row follow ${label}`);

      await row("Zed").getByRole("button", { name: "Follow" }).click();
      const dialog = page.getByRole("dialog", { name: "Follow Zed?" });
      await expect(dialog).toContainText("Uses 1 of your 50 follows · 3 used");
      await dialog.getByRole("button", { name: "Follow" }).click();
      await expect(dialog).toHaveCount(0);
      expect(posted).toEqual([{ player_tag: "#M1", relationship: "friend" }]);
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
              clan_tag: "#0QC8RCGY",
              members: 3,
              on_map: 1,
              entries: [
                {
                  player_tag: "#02QQPCYQQ",
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

/** Members' row of pages went on 2026-11-12 (G6); Recruit and Scout are
 *  leaders' and elders' tools (Jamie, 2026-11-12). */
test.describe("Members as one page", () => {
  test("a member gets Recruit's and Scout's role lines, never their reads", async ({
    page,
  }) => {
    const reads: string[] = [];
    page.on("request", (r) => {
      // The API's reads only; the old page addresses are navigations.
      if (/^\/api\/.*\/(recruit|scout)/.test(new URL(r.url()).pathname))
        reads.push(r.url());
    });
    await mockApi(page, asMember({ "GET /api/me/follow-plan": [200, PLAN] }));
    await page.goto(`${base}/members/recruit`);
    await expect(page).toHaveURL(new RegExp(`${base}/members\\?show=recruit$`));
    const foot = page.getByRole("region", { name: "Spread the word" });
    await expect(foot.getByTestId("recruit-role-line")).toContainText(
      "Recruit is for elders, co-leaders and the leader",
    );
    await expect(
      foot.getByRole("button", { name: /recruiting copy/ }),
    ).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Scout" })).toHaveCount(0);
    // Scout's old address: its role line, never the form.
    await page.goto(`${base}/members/scout`);
    await expect(page).toHaveURL(new RegExp(`${base}/members\\?show=scout$`));
    const scout = page.getByRole("region", { name: "Scout" });
    await expect(scout.getByRole("alert")).toContainText(
      "Scout is for elders, co-leaders and the leader",
    );
    await expect(scout.getByRole("textbox")).toHaveCount(0);
    expect(reads).toEqual([]);
    await accessible(page, "members foot, member");
  });

  test("an elder keeps Scout, at the foot of Members", async ({ page }) => {
    const selected = { ...ME.clans[0], role: "elder", role_label: "Elder" };
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [
          200,
          { ...ME, selected, clans: [selected, ME.clans[1]] },
        ],
        "GET /api/me/follow-plan": [200, PLAN],
      }),
    );
    await page.goto(`${base}/members/scout`);
    await expect(page).toHaveURL(new RegExp(`${base}/members\\?show=scout$`));
    const scout = page.getByRole("region", { name: "Scout" });
    await expect(scout.getByRole("textbox").first()).toBeVisible();
    await accessible(page, "members foot, elder");
  });

  test("Recruit and Scout stay open when the roster read fails", async ({
    page,
  }) => {
    const selected = { ...ME.clans[0], role: "elder", role_label: "Elder" };
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [
          200,
          { ...ME, selected, clans: [selected, ME.clans[1]] },
        ],
        "GET /api/clan/roster": [500, { error: "internal" }],
        "GET /api/me/follow-plan": [200, PLAN],
      }),
    );
    await page.goto(`${base}/members/recruit`);
    await expect(
      page.getByText("Elixir did not answer the roster read"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Spread the word" })
        .getByRole("button", { name: "Hide the recruiting copy" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Scout" }).getByRole("textbox").first(),
    ).toBeVisible();
  });

  test("Standing is on Standings, for every member", async ({ page }) => {
    await mockApi(page, asMember({ "GET /api/me/follow-plan": [200, PLAN] }));
    await page.goto(`${base}/standings`);
    await expect(page.getByRole("region", { name: "Standing" })).toBeVisible();
  });
});
