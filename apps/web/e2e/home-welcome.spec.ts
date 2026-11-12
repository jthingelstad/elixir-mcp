import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { HOME, homeApi } from "./home-fixture.ts";

/**
 * Home's welcome steps (G4, 2026-11-12): "Welcome to Elixir, N of 4 done"
 * above the feed until every step is done, then nothing; the folded Setup
 * details are gone. Your week counts the cheers others gave this week.
 * Invented players only.
 */
const withWelcome = (
  welcome: unknown,
  player: Record<string, unknown> = {},
  week: Record<string, unknown> = {},
) =>
  homeApi({
    "GET /api/me/home": [
      200,
      {
        first: {
          ...HOME.first,
          player: { ...HOME.first.player, ...player },
          welcome,
        },
      },
    ],
    "GET /api/me/home/week": [200, { week: { ...HOME.week, ...week } }],
  });

for (const [label, width] of [
  ["desktop", 1180],
  ["phone", 390],
] as const) {
  test(`${label}: a new account's Home opens with what is left, its steps in order (G4)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(
      page,
      withWelcome({ following: 0, digest: null }, { verified: false }),
    );
    await page.goto("/home");
    const welcome = page.locator(".kit-welcome");
    await expect(
      welcome.getByRole("heading", { name: "Welcome to Elixir, 1 of 4 done" }),
    ).toBeVisible();
    await expect(welcome.getByRole("heading", { level: 3 })).toHaveText([
      "Add your player",
      "Verify it’s you",
      "Follow a few people",
      "Choose your digest",
    ]);
    await expect(welcome).toContainText("King Thing, your main player.");
    await expect(
      welcome.getByRole("link", { name: "Verify King Thing" }),
    ).toHaveAttribute("href", "/settings/players/verify");
    await expect(
      welcome.getByRole("link", { name: "Find people" }),
    ).toHaveAttribute("href", "/home/find");
    await expect(
      welcome.getByRole("link", { name: "Choose your digest" }),
    ).toHaveAttribute("href", "/settings/emails");
    await expect(page.getByText("Setup details")).toHaveCount(0);
    // Above the feed, which a phone reads first.
    const box = await welcome.boundingBox();
    const feed = await page.locator(".kit-feed").boundingBox();
    expect(box!.y).toBeLessThan(feed!.y);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);
  });
}

test("done steps say what was done, and the count follows them (G4)", async ({
  page,
}) => {
  await mockApi(
    page,
    withWelcome({
      following: 2,
      digest: null,
    }),
  );
  await page.goto("/home");
  const welcome = page.locator(".kit-welcome");
  await expect(
    welcome.getByRole("heading", { name: "Welcome to Elixir, 3 of 4 done" }),
  ).toBeVisible();
  await expect(welcome).toContainText("King Thing is verified.");
  await expect(welcome).toContainText("You follow 2 players.");
  await expect(welcome.getByRole("link", { name: "Find people" })).toHaveCount(
    0,
  );
});

test("every step done: no welcome and no Setup details, only the feed and its panels (G4)", async ({
  page,
}) => {
  await mockApi(
    page,
    withWelcome({
      following: 3,
      digest: {
        chosen_at: "2026-11-10T12:00:00Z",
        enabled: true,
        cadence: "weekly",
      },
    }),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-feed .kit-feed__item").first()).toBeVisible();
  await expect(page.locator(".kit-welcome")).toHaveCount(0);
  await expect(page.getByText("Setup details")).toHaveCount(0);
});

test("your week counts the cheers others gave since Monday (G4)", async ({
  page,
}) => {
  await mockApi(
    page,
    withWelcome({ following: 3, digest: null }, {}, { cheers: 4 }),
  );
  await page.goto("/home");
  const week = page.locator(".kit-week");
  await expect(week.getByText("Cheers", { exact: true })).toBeVisible();
  await expect(week).toContainText("from others on your items since Monday");
  await expect(week.locator(".kit-stats")).toContainText("4");
});
