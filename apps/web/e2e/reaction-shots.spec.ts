import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { mockApi } from "./fixtures.ts";
import { FEED_NOW, RHYTHM_TIMELINE, rhythmApi } from "./feed-rhythm-fixture.ts";

/**
 * Review pictures for "Reactions are glyphs alone; a larger set"
 * (2026-11-17), saved only when REACTION_SHOTS=<dir> names where: the
 * closed control with counts, the six open, your reaction chosen, all
 * twenty, a busy item and a line's compact control, at 320, 390 and 1280.
 * Nothing is asserted beyond the page opening. Invented players only.
 */
const shots = process.env.REACTION_SHOTS;

test.skip(!shots, "REACTION_SHOTS names a folder");

/** The fixture's week with its first full card made busy: seven kinds,
 *  yours among the ones that fold. */
const BUSY = {
  ...RHYTHM_TIMELINE,
  timeline: RHYTHM_TIMELINE.timeline.map((it, i) =>
    i === 0
      ? {
          ...it,
          cheers: {
            on_fire: 6,
            royal: 4,
            wow: 3,
            ha: 2,
            clutch: 2,
            lucky: 1,
            ice_cold: 1,
          },
          my_cheer: "ice_cold",
        }
      : it,
  ),
};

async function shot(page: Page, name: string, el: ReturnType<Page["locator"]>) {
  mkdirSync(shots!, { recursive: true });
  await page.waitForTimeout(300);
  // The card plus room for the popover that floats below it.
  const box = (await el.boundingBox())!;
  const vw = page.viewportSize()!.width;
  await page.screenshot({
    path: path.join(shots!, `${name}.png`),
    clip: {
      x: 0,
      y: Math.max(0, box.y - 8),
      width: vw,
      height: Math.min(box.height + 260, 700),
    },
  });
}

for (const width of [320, 390, 1280]) {
  test(`reactions at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.setFixedTime(new Date(FEED_NOW));
    await mockApi(
      page,
      rhythmApi({
        "GET /api/me/timeline": [200, BUSY],
        "PUT /api/me/cheers": (route) => {
          const body = route.request().postDataJSON();
          return [
            200,
            {
              item_id: body.item_id,
              cheers: body.cheer
                ? { on_fire: 3, [body.cheer]: 2 }
                : { on_fire: 3 },
              my_cheer: body.cheer,
            },
          ];
        },
      }),
    );
    await page.goto("/timeline");
    const cards = page.locator(".kit-feed__item:not(.kit-feed__item--line)");
    const busy = cards.filter({ has: page.locator(".kit-cheers") }).first();
    await expect(busy).toBeVisible();
    await busy.scrollIntoViewIfNeeded();
    await shot(page, `busy-${width}`, busy);
    // A card with a few cheers, none yours yet, pinned by its place so it
    // stays the same card once the cheer lands.
    const at = await cards.evaluateAll((els) =>
      els.findIndex(
        (el) =>
          el.querySelector(".kit-cheer:not(.kit-cheer--mine)") &&
          el.querySelector(".kit-cheers__count, .kit-cheers__rest"),
      ),
    );
    const plain = cards.nth(at);
    await plain.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    await shot(page, `closed-${width}`, plain);
    await plain.getByRole("button", { name: "Choose a cheer" }).click();
    await shot(page, `six-${width}`, plain);
    await plain.getByRole("button", { name: "More reactions" }).click();
    await shot(page, `all-${width}`, plain);
    await plain.getByRole("button", { name: "Clutch" }).hover();
    await shot(page, `all-tip-${width}`, plain);
    await plain.getByRole("button", { name: "Clutch" }).click();
    await page.mouse.move(0, 0);
    await expect(
      plain.getByRole("button", { name: "Cheered: Clutch" }),
    ).toBeVisible();
    await shot(page, `chosen-${width}`, plain);
    await plain.getByRole("button", { name: "Choose a cheer" }).click();
    await shot(page, `six-recent-${width}`, plain);
    await page.keyboard.press("Escape");
    const group = page.locator(".kit-feed__group").first();
    await group.scrollIntoViewIfNeeded();
    await group.locator(".kit-group__toggle").click();
    const line = group.locator(".kit-feed__item--line").first();
    await shot(page, `compact-${width}`, line);
    await line.getByRole("button", { name: "Choose a cheer" }).click();
    await shot(page, `compact-open-${width}`, line);
  });
}
