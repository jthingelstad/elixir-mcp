import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

/**
 * The clan head's Follow (design pass three, 2026-11-13): the player
 * page's control on the clan itself. Not followed, it asks first with what
 * it records and the clan slot it takes, then writes Elixir's own clan
 * follow (`POST /api/me/clans`, activity scope) and reads "Following".
 * Followed already, it reads "Following" and offers nothing. Full slots
 * keep it shut. Invented clan; local mocks only.
 */

const page0 = "/clan/2PQRJ8LV/feed";
const SLOTS = {
  activity: { used: 1, limit: 3 },
  comprehensive: { used: 0, limit: 0 },
};
const FOLLOWED = {
  clan_tag: "#2PQRJ8LV",
  scope: "activity",
  notify: false,
  name: "Example Clan",
  is_primary: false,
  auto_followed_at: null,
};

test("an unfollowed clan: Follow asks, writes the clan follow, then reads Following", async ({
  page,
}) => {
  let followed = false;
  const posts: unknown[] = [];
  await mockApi(
    page,
    signedIn({
      "GET /api/me/clans": () => [
        200,
        {
          clans: followed ? [FOLLOWED] : [],
          home_clan: null,
          slots: SLOTS,
        },
      ],
      "POST /api/me/clans": (route) => {
        posts.push(route.request().postDataJSON());
        followed = true;
        return [200, { ok: true, clan_tag: "#2PQRJ8LV", scope: "activity" }];
      },
    }),
  );
  await page.goto(page0);
  const head = page.locator(".clan-head");
  await head.getByRole("button", { name: "Follow", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Follow Example Clan?" });
  await expect(ask).toContainText(
    "Elixir records its roster, who joins and who goes, and its races.",
  );
  await expect(ask).toContainText("Uses 1 of your 3 clan slots · 1 used");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => v.id),
  ).toEqual([]);
  await ask.getByRole("button", { name: "Follow" }).click();
  await expect(head.getByText("Following", { exact: true })).toBeVisible();
  await expect(
    head.getByRole("button", { name: "Follow", exact: true }),
  ).toHaveCount(0);
  expect(posts).toEqual([
    { action: "add", clan_tag: "#2PQRJ8LV", scope: "activity" },
  ]);
});

test("a clan you follow already reads Following, with nothing to press", async ({
  page,
}) => {
  await mockApi(
    page,
    signedIn({
      "GET /api/me/clans": [
        200,
        { clans: [FOLLOWED], home_clan: null, slots: SLOTS },
      ],
    }),
  );
  await page.goto(page0);
  const head = page.locator(".clan-head");
  await expect(head.getByText("Following", { exact: true })).toBeVisible();
  await expect(
    head.getByRole("button", { name: "Follow", exact: true }),
  ).toHaveCount(0);
});

test("with every clan slot in use, Follow stays shut", async ({ page }) => {
  await mockApi(
    page,
    signedIn({
      "GET /api/me/clans": [
        200,
        {
          clans: [],
          home_clan: null,
          slots: { ...SLOTS, activity: { used: 3, limit: 3 } },
        },
      ],
    }),
  );
  await page.goto(page0);
  await expect(
    page
      .locator(".clan-head")
      .getByRole("button", { name: "Follow", exact: true }),
  ).toBeDisabled();
});
