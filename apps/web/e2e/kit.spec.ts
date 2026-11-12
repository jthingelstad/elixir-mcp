import { expect, test, type Page } from "@playwright/test";

import { mockApi as clanApi, signedIn as clanIn } from "./clan/fixtures.ts";
import { mockApi, signedIn } from "./fixtures.ts";
import { explore } from "./ladder-fixture.ts";

/**
 * The kit's one promise at phone width: nothing scrolls the page sideways,
 * and a table fits its box. A table page and a tabbed page stand in for the
 * rest.
 */
async function expectNoSidewaysScroll(page: Page) {
  const { over, wide } = await page.evaluate(() => ({
    over: document.documentElement.scrollWidth - window.innerWidth,
    wide: [...document.querySelectorAll("table")].filter((t) => {
      const box = t.parentElement;
      return box && box.scrollWidth > box.clientWidth + 1;
    }).length,
  }));
  expect(over).toBe(0);
  expect(wide).toBe(0);
}

test("a table page stays inside a phone's width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await clanApi(page, clanIn());
  await page.goto("/clan/2PQRJ8LV/members");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Trophies" }),
  ).toHaveAttribute("scope", "col");
  await expectNoSidewaysScroll(page);
});

test("a tabbed page stays inside a phone's width, and its tabs take the keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await clanApi(page, clanIn());
  await page.goto("/clan/2PQRJ8LV/feed");
  const tabs = page.getByRole("tablist", { name: "Clan" }).getByRole("tab");
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toBeFocused();
  await expectNoSidewaysScroll(page);
});

test("a ladder table keeps its columns on a phone and fits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, signedIn({ "POST /api/explore": explore() }));
  await page.goto("/ladder/cards");
  await expect(page.locator(".ladder-cards").first()).toBeVisible();
  await expectNoSidewaysScroll(page);
});
