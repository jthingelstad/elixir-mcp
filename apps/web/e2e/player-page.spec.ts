import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, SIGNED_OUT } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

/**
 * The player page (slice 6, #764): a name opens it, Follow asks first and
 * says what it costs, and a Follow me link signed out is the way in, back to
 * the link. Invented players only.
 */
async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

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

const ADA = {
  player: {
    tag: "#00C298UC",
    name: "Ada",
    clan_tag: "#0JQ0JQ8",
    clan_name: "Grove",
    trophies: 9400,
    recorded: true,
  },
  you: { own: false, following: false, relationship: null, clanmate: null },
  badges: { verified_player: true, discord: false },
  follows: { count: 1, players: [{ tag: "#0J0RVYRR", name: "Grace" }] },
  followers: {
    count: 2,
    players: [{ tag: "#0JVRYLGG", name: "Edsger" }],
    unnamed: 1,
  },
  window_days: 30,
  timeline: [
    {
      id: "t1",
      kind: "pol_league_up",
      at: "2026-11-10T14:00:00.000Z",
      text: "Reached Path of Legends.",
    },
  ],
  timeline_more: 0,
  moments: [
    {
      id: "t1",
      kind: "pol_league_up",
      at: "2026-11-10T14:00:00.000Z",
      text: "Reached Path of Legends.",
    },
  ],
  highlights: [],
};

const COST = {
  player_tag: "#00C298UC",
  following: false,
  free: false,
  reason: null,
  used: 3,
  limit: 50,
};

for (const [label, width] of [
  ["desktop", 1180],
  ["phone", 390],
] as const) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("a name opens the player page, and Follow asks first with its cost", async ({
      page,
    }) => {
      const posted: unknown[] = [];
      await mockApi(
        page,
        homeApi({
          "GET /api/player": [200, ADA],
          "GET /api/me/follow-cost": [200, COST],
          "GET /api/me/follow-plan": [
            200,
            {
              clan_tag: "#0JQ0JQ8",
              players: [],
              yours: [],
              to_follow: 0,
              free: 0,
              slots: 0,
              following: 0,
              used: 3,
              limit: 50,
              fits: true,
            },
          ],
          "POST /api/claims": (route) => {
            posted.push(route.request().postDataJSON());
            return [
              200,
              {
                ok: true,
                player_tag: "#00C298UC",
                added: true,
                relationship: "friend",
              },
            ];
          },
        }),
      );
      await page.goto("/home");
      await page.getByRole("link", { name: "Ada", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/player\/00C298UC$/);
      await expect(
        page.getByRole("heading", { level: 1, name: "Ada" }),
      ).toBeVisible();
      await expect(page.getByText("Verified player")).toBeVisible();
      await expect(page.getByText("Reached Path of Legends.")).toBeVisible();
      await noSideways(page);
      await accessible(page, "player page");

      await page.getByRole("button", { name: "Follow", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Follow Ada?" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText("Uses 1 of your 50 player slots · 3 used"),
      ).toBeVisible();
      expect(posted).toEqual([]);
      await dialog.getByRole("button", { name: "Follow", exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(posted).toEqual([
        { player_tag: "#00C298UC", relationship: "friend" },
      ]);
    });

    test("a Follow me link signed out names nobody and joins back to it", async ({
      page,
    }) => {
      await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
      await page.goto("/home/follow/00C298UC,0J0RVYRR");
      await expect(
        page.getByRole("heading", { name: "Follow these players on Elixir" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Join Elixir" }),
      ).toHaveAttribute(
        "href",
        `/signin?signup&return_to=${encodeURIComponent("/home/follow/00C298UC,0J0RVYRR")}`,
      );
      await expect(page.getByRole("main")).not.toContainText("00C298UC");
      await noSideways(page);
      await accessible(page, "follow me, signed out");
    });
  });
}
