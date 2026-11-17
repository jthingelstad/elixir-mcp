import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { mockApi, signedIn } from "./fixtures.ts";
import { FEED_NOW, rhythmApi } from "./feed-rhythm-fixture.ts";
import {
  SHARED_ID,
  SHARED_MEMBER,
  SHARED_TAG,
  sessionDayApi,
} from "./session-fixture.ts";

/**
 * Review pictures for the glyph and cheer pass (2026-11-17), saved only
 * when GLYPH_SHOTS=<dir> names where: a feed card's cheer control, the
 * kinds row open, the tab bar, the Settings rail and a session's share
 * controls, at 390 and 1280. Nothing is asserted beyond the page opening.
 */
const shots = process.env.GLYPH_SHOTS;
const tagSuffix = process.env.GLYPH_SHOTS_SUFFIX ?? "after";

test.skip(!shots, "GLYPH_SHOTS names a folder");

async function snap(page: Page, name: string, el?: string) {
  mkdirSync(shots!, { recursive: true });
  await page.waitForTimeout(250);
  const file = path.join(shots!, `${name}-${tagSuffix}.png`);
  if (el) await page.locator(el).first().screenshot({ path: file });
  else await page.screenshot({ path: file });
}

for (const width of [390, 1280]) {
  test(`cheer control and kinds at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date(FEED_NOW));
    await mockApi(page, rhythmApi());
    await page.goto("/timeline");
    const card = page
      .locator(".kit-feed__item:not(.kit-feed__item--line)")
      .filter({ has: page.locator(".kit-cheers") })
      .nth(1);
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({
      path: path.join(shots!, `card-${width}-${tagSuffix}.png`),
    });
    const more = card.getByRole("button", { name: /^(Cheer|Choose a cheer)$/ });
    await more.last().click();
    await card.screenshot({
      path: path.join(shots!, `kinds-${width}-${tagSuffix}.png`),
    });
    const group = page.locator(".kit-feed__group").first();
    await group.locator(".kit-group__toggle").click();
    await group.screenshot({
      path: path.join(shots!, `lines-${width}-${tagSuffix}.png`),
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await snap(page, `tabs-${width}`, width < 600 ? ".kit-bottom" : ".kit-top");
  });

  test(`settings rail at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, signedIn({}));
    await page.goto("/settings/profile");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await snap(page, `settings-${width}`);
  });

  test(`session share at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(
      page,
      sessionDayApi({ "GET /api/player/session": [200, SHARED_MEMBER] }),
    );
    await page.goto(`/home/player/${SHARED_TAG.slice(1)}/session/${SHARED_ID}`);
    const share = page.getByRole("region", { name: "Share this session" });
    await expect(share).toBeVisible();
    await snap(page, `session-top-${width}`);
    await share.scrollIntoViewIfNeeded();
    await share.screenshot({
      path: path.join(shots!, `share-${width}-${tagSuffix}.png`),
    });
  });
}
