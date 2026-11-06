import { expect, test, type Page } from "@playwright/test";
import { mockApi, SIGNED_OUT } from "./fixtures.ts";
import { HOME, FRIENDS, homeApi } from "./home-fixture.ts";

/**
 * Home at its new address (redesign step 3a): Today, Timeline, Friends, at
 * desktop and phone widths, with nothing scrolling the page sideways.
 */
async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

const DISCLAIMER =
  "This material is unofficial and is not endorsed by Supercell. For more information see Supercell’s Fan Content Policy: www.supercell.com/fan-content-policy.";

for (const [label, width] of [
  ["desktop", 1180],
  ["phone", 390],
] as const) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("Today: needs you in Clan's order, your week, your clan, latest", async ({
      page,
    }) => {
      await mockApi(page, homeApi());
      await page.goto("/home");
      await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
      const needs = page.locator(".kit-needs");
      await expect(needs.locator(".kit-row__title").first()).toContainText(
        "Departure: kicked, left, or ignore? Ada",
      );
      await expect(needs).toContainText("and 3 more in Clan › Today");
      await expect(page.getByText("23–14")).toBeVisible();
      await expect(page.getByText("Giant beatdown")).toBeVisible();
      await expect(
        page.getByText("Season 137, week 4: 2nd, 84,200 fame"),
      ).toBeVisible();
      await expect(page.getByText("Crossed 9,400 trophies.")).toBeVisible();
      await expect(page.locator(".disclaimer__text")).toHaveText(DISCLAIMER);
      await expect(
        page.getByRole("navigation", { name: "Main, phone" }),
      ).toBeVisible({ visible: width === 390 });
      await noSideways(page);
    });

    test("Today: a failed panel says so and the rest render", async ({
      page,
    }) => {
      await mockApi(
        page,
        homeApi({
          "GET /api/me/home": [200, { ...HOME, clan: { ok: false } }],
        }),
      );
      await page.goto("/home");
      await expect(
        page.getByText("Your clans could not be read just now."),
      ).toBeVisible();
      await expect(page.getByText("23–14")).toBeVisible();
      await expect(page.locator(".kit-needs")).toHaveCount(0);
      await noSideways(page);
    });

    test("Timeline: days, chips, new line, games in place, the cap line", async ({
      page,
    }) => {
      await mockApi(page, homeApi());
      await page.goto("/home/timeline");
      await expect(page.getByText("New since your last visit")).toBeVisible();
      await expect(
        page.getByText(/the 2 newest are shown, and 46 more/),
      ).toBeVisible();
      await page.getByRole("button", { name: "View games" }).click();
      await expect(page.getByText(/Open recorded game/)).toBeVisible();
      await page.getByRole("button", { name: "New" }).click();
      await expect(page.getByText("Reached Path of Legends.")).toHaveCount(0);
      await noSideways(page);
    });

    test("Friends: both lists, the quiet lines, and Follow", async ({
      page,
    }) => {
      await mockApi(
        page,
        homeApi({
          "POST /api/claims": [
            200,
            {
              ok: true,
              player_tag: "#QQQQQQQ",
              added: true,
              first_read: true,
              not_found: false,
              relationship: "friend",
            },
          ],
        }),
      );
      await page.goto("/home/friends");
      await expect(page.getByText("1 of 2 played")).toBeVisible();
      await expect(
        page.getByText("No battle recorded this week: Edsger."),
      ).toBeVisible();
      await expect(
        page.getByText("Quiet for 30 days or more: Barbara."),
      ).toBeVisible();
      await expect(
        page.getByText("They aren’t told.", { exact: false }),
      ).toBeVisible();
      await noSideways(page);
      await page.getByLabel("Follow a friend").fill("#QQQQQQQ");
      await page.getByRole("button", { name: "Follow", exact: true }).click();
      await expect(page.getByText("Recording", { exact: true })).toBeVisible();
    });
  });
}

test("Friends: with no player of your own it asks for yours first", async ({
  page,
}) => {
  await mockApi(
    page,
    homeApi({ "GET /api/me/home/friends": [200, { no_player: true }] }),
  );
  await page.goto("/home/friends");
  await expect(page.getByText("Add your own player first")).toBeVisible();
  await expect(page.getByLabel("Follow a friend")).toHaveCount(0);
});

test("Friends: a read that failed says so", async ({ page }) => {
  await mockApi(
    page,
    homeApi({ "GET /api/me/home/friends": [500, { error: "boom" }] }),
  );
  await page.goto("/home/friends");
  await expect(
    page.getByText("Friends could not be read just now."),
  ).toBeVisible();
  expect(FRIENDS.friends.length).toBe(1);
});

test("a new account gets the steps, not Today", async ({ page }) => {
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": [200, { first: { ok: true, player: null } }],
    }),
  );
  await page.goto("/home");
  await expect(
    page.getByRole("heading", { name: "Welcome to Elixir" }),
  ).toBeVisible();
  await expect(page.getByLabel("Your player tag")).toBeVisible();
});

test("signed out, /home is the wall and remembers where it was", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
  await page.goto("/home/friends");
  await expect(
    page.getByRole("heading", { name: "Sign in first" }),
  ).toBeVisible();
  await expect(page.locator(".disclaimer__text")).toHaveText(DISCLAIMER);
  expect(
    await page.evaluate(() => sessionStorage.getItem("elixir.after_sign_in")),
  ).toBe("/home/friends");
});

test("the old Overview address lands on Home, with no offer to try it", async ({
  page,
}) => {
  await mockApi(page, homeApi());
  await page.goto("/console/account/overview");
  await expect(page).toHaveURL(/\/home$/);
  await expect(
    page.getByRole("link", { name: /Try the new Home/ }),
  ).toHaveCount(0);
});
