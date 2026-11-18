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
  shared_clan: { clan_tag: "#0QC8RCGY", name: "Example Clan" },
  clan_tag: "#0QC8RCGY",
  players: [
    {
      player_tag: "#02QQPCYQQ",
      name: "Ben",
      connection: "friend",
      clanmate: "#0QC8RCGY",
      shared_clan: { clan_tag: "#0QC8RCGY", name: "Example Clan" },
      close: false,
      following: true,
      free: true,
      reason: "followed_by_others",
    },
    {
      player_tag: "#M1",
      name: "Zed",
      connection: "clanmate",
      clanmate: "#0QC8RCGY",
      shared_clan: { clan_tag: "#0QC8RCGY", name: "Example Clan" },
      close: false,
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
  ["desktop", 1280],
  ["phone", 390],
  ["small phone", 320],
] as const) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("clanmates connect without bulk or per-row friend prompts", async ({
      page,
    }) => {
      const posted: unknown[] = [];
      await mockApi(
        page,
        asMember({
          "GET /api/me/follow-plan": [200, PLAN],
          "POST /api/me/follow-all": (route) => {
            posted.push(route.request().postDataJSON());
            return [200, { ok: true }];
          },
          "POST /api/claims": (route) => {
            posted.push(route.request().postDataJSON());
            return [201, { ok: true }];
          },
        }),
      );
      await page.goto(`${base}/members`);
      const roster = page.getByRole("region", { name: "3 members" });
      await expect(roster).toContainText("Clanmates connect automatically");
      await expect(
        roster.getByRole("button", { name: /Follow|Friend/ }),
      ).toHaveCount(0);
      const row = (name: string) =>
        roster.getByRole("row").filter({ hasText: name });
      await expect(row("Ada").getByRole("button")).toHaveCount(0);
      await expect(
        row("Ben").locator(".kit-connection-state__primary"),
      ).toHaveText("Friend");
      await expect(
        row("Zed").locator(".kit-connection-state__primary"),
      ).toHaveText("Clanmate");
      if (width < 700) {
        const name = await row("Ben")
          .getByRole("link", { name: "Ben", exact: true })
          .boundingBox();
        const trophies = await row("Ben")
          .locator(".roster-table__trophies")
          .boundingBox();
        const connection = await row("Ben")
          .locator(".kit-connection-state")
          .boundingBox();
        expect(name!.x + name!.width + 8).toBeLessThanOrEqual(trophies!.x);
        expect(connection!.y).toBeGreaterThanOrEqual(name!.y + name!.height);
      }
      await expect(
        row("Ben").getByRole("link", { name: "Ben", exact: true }),
      ).toHaveAttribute("href", "/home/player/02QQPCYQQ");
      await expect(
        roster.getByRole("link", { name: "Clan map" }),
      ).toHaveAttribute("href", `${base}/members/map`);
      await noSideways(page);
      await accessible(page, `connected clan members ${label}`);
      await page.screenshot({
        path: test.info().outputPath(`connected-members-${width}.png`),
      });
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
      // Automatic membership needs no follow action before opening the map.
      await expect(roster.getByRole("button", { name: /Follow/ })).toHaveCount(
        0,
      );
      await expect(roster).toContainText("Clanmates connect automatically");
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
