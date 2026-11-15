import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, SIGNED_OUT } from "./fixtures.ts";
import { ADA } from "./player-fixture.ts";
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
        dialog.getByText("Uses 1 of your 50 follows · 3 used"),
      ).toBeVisible();
      expect(posted).toEqual([]);
      await dialog.getByRole("button", { name: "Follow", exact: true }).click();
      await expect(dialog).toBeHidden();
      expect(posted).toEqual([
        { player_tag: "#00C298UC", relationship: "friend" },
      ]);
    });

    test("followers: verified, claimed and accounts with no player; a moment opens its battle", async ({
      page,
    }, info) => {
      const moment = {
        id: "t2",
        kind: "ranked_promotion",
        at: "2026-11-11T18:00:00.000Z",
        text: "Ada was promoted to Master I, on a 3-0 win over Lovelace.",
        battle_url: "https://elixir.poapkings.com/battle/0a1b2c3d4e5f",
      };
      const unproved = {
        id: "t3",
        kind: "badge_earned",
        at: "2026-11-09T18:00:00.000Z",
        text: "Ada earned a badge.",
      };
      await mockApi(
        page,
        homeApi({
          "GET /api/player": [
            200,
            {
              ...ADA,
              followers: {
                count: 4,
                players: [
                  { tag: "#0JVRYLGG", name: "Edsger", verified: true },
                  { tag: "#0GRJCUV", name: "Hopper", verified: false },
                ],
                no_player: 2,
                unnamed: 2,
              },
              moments: [moment, unproved],
              player_verifications: { "#0JVRYLGG": true, "#0GRJCUV": false },
            },
          ],
        }),
      );
      await page.goto("/home/player/00C298UC?tab=follows");
      const claimed = page.getByRole("link", { name: /Hopper/ });
      await expect(claimed).toBeVisible();
      await expect(claimed).toContainText("Not verified");
      await expect(claimed.locator(".kit-verified")).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: /Edsger/ }).locator(".kit-verified"),
      ).toHaveCount(1);
      await expect(page.getByText("2 Elixir accounts")).toBeVisible();
      await expect(page.getByText("No player added yet")).toBeVisible();
      await noSideways(page);
      await accessible(page, "followers");
      await page.screenshot({
        path: info.outputPath(`followers-${label}.png`),
        fullPage: true,
      });

      await page.getByRole("tab", { name: "Moments" }).click();
      const open = page.getByRole("link", { name: "Open the battle" });
      // The proved moment links its battle; the other has no link at all.
      await expect(open).toHaveCount(1);
      await expect(open).toHaveAttribute("href", "/battle/0a1b2c3d4e5f");
      await noSideways(page);
      await accessible(page, "moments");
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
