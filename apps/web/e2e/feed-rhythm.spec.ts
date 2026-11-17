import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { mockApi } from "./fixtures.ts";
import { mockApi as clanApi, signedIn as clanIn } from "./clan/fixtures.ts";
import {
  FEED_NOW,
  RHYTHM_CLAN_FEED,
  rhythmApi,
} from "./feed-rhythm-fixture.ts";

/**
 * The Timeline's rhythm (2026-11-17), on a realistic week: about sixty
 * items from fifteen invented people. FEED_RHYTHM_SHOTS=<dir> saves the
 * full-page screenshots the change was reviewed with, and prints each
 * page's height.
 */
const shots = process.env.FEED_RHYTHM_SHOTS;

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.clock.setFixedTime(new Date(FEED_NOW));
  await mockApi(page, rhythmApi());
  await page.goto("/timeline");
  await expect(page.locator(".kit-feed__item").first()).toBeVisible();
}

async function capture(page: Page, name: string, width: number) {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(300);
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  console.log(`feed-rhythm ${name} at ${width}: ${height}px`);
  await page.screenshot({
    path: path.join(shots, `${name}-${width}.png`),
    fullPage: true,
  });
  // The page in slices a reviewer can read at full size.
  const slice = width < 600 ? 1800 : 1200;
  for (let i = 0; i * slice < Math.min(height, slice * 4); i++)
    await page.screenshot({
      path: path.join(shots, `${name}-${width}-${i}.png`),
      fullPage: true,
      clip: {
        x: 0,
        y: i * slice,
        width,
        height: Math.min(slice, height - i * slice),
      },
    });
}

for (const width of [390, 1280]) {
  test(`the week at ${width}px`, async ({ page }) => {
    await open(page, width);
    await capture(page, "timeline", width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
    // The hostile name prints as text, never as markup.
    await expect(page.locator(".kit-feed img[src='x']")).toHaveCount(0);
  });
}

test("the week is axe clean", async ({ page }) => {
  await open(page, 1280);
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
  ).toEqual([]);
});

test("short sessions fold, open in place, and each keeps its own cheer", async ({
  page,
}) => {
  const sent: unknown[] = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.setFixedTime(new Date(FEED_NOW));
  await mockApi(
    page,
    rhythmApi({
      "PUT /api/me/cheers": (route) => {
        const body = route.request().postDataJSON();
        sent.push(body);
        return [
          200,
          { item_id: body.item_id, cheers: { royal: 1 }, my_cheer: "royal" },
        ];
      },
    }),
  );
  await page.goto("/timeline");
  const group = page.locator(".kit-feed__group").first();
  const toggle = group.locator(".kit-group__toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  // Closed, a group offers no cheer of its own.
  await expect(
    group.getByRole("button", { name: "Cheer", exact: true }),
  ).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const lines = group.locator(".kit-feed__item--line");
  expect(await lines.count()).toBeGreaterThan(1);
  await lines.first().getByRole("button", { name: "Choose a cheer" }).click();
  await lines.first().getByRole("button", { name: "Royal" }).click();
  await expect.poll(() => sent.length).toBe(1);
  // The cheer is the item's own, by its own id: a group is never cheered.
  expect(String((sent[0] as { item_id: string }).item_id)).toMatch(/^s\d+$/);
  // A close friend's sessions never fold, and wear the owner's star.
  await expect(
    page
      .locator(".kit-feed__item")
      .filter({ has: page.getByTitle("Close friend. Only you see this.") })
      .first(),
  ).toBeVisible();
  await expect(
    page.locator(".kit-feed__group").filter({ hasText: /Moss|Quill/ }),
  ).toHaveCount(0);
  // A card moment draws the card's art, a headline its kicker.
  await expect(page.locator(".kit-mart--card img").first()).toHaveAttribute(
    "src",
    /cards\//,
  );
  await expect(page.locator(".kit-feed__item--headline").first()).toBeVisible();
});

test("on a phone at 320, every new control is a 44px target and nothing scrolls sideways", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 720 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(FEED_NOW));
  await mockApi(page, rhythmApi());
  await page.goto("/timeline");
  await expect(page.locator(".kit-feed__group").first()).toBeVisible();
  await page.locator(".kit-group__toggle").first().click();
  const small = await page.evaluate(
    () =>
      [
        ...document.querySelectorAll(
          ".kit-group__toggle, a.kit-line__go, .kit-feed__item--line .kit-chip",
        ),
      ]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height < 44).length,
  );
  expect(small).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await context.close();
});

test("Clan's Feed draws the same week with the Timeline's components", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date(FEED_NOW));
  await clanApi(
    page,
    clanIn({ "GET /api/clan/clans/0QC8RCGY/feed": [200, RHYTHM_CLAN_FEED] }),
  );
  await page.goto("/clan/0QC8RCGY/feed");
  await expect(page.locator(".kit-feed__group").first()).toBeVisible();
  await expect(page.locator(".kit-feed__item--line").first()).toBeVisible();
  await expect(page.locator(".kit-mart--card").first()).toBeVisible();
  // No cheer on Clan's Feed: cheers live on the reader's own Timeline.
  await expect(
    page.getByRole("button", { name: "Cheer", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".kit-feed img[src='x']")).toHaveCount(0);
  await capture(page, "clan-feed", 390);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => v.id),
  ).toEqual([]);
});
