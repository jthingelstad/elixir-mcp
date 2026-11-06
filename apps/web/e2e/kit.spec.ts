import { expect, test, type Page } from "@playwright/test";
import { FIELDS, GROUPS, TABS, policyFromGoals } from "@elixir-mcp/clan-engine";
import { mockApi as clanApi, signedIn as clanIn } from "./clan/fixtures.ts";
import { mockApi, signedIn } from "./fixtures.ts";
import { explore } from "./ladder-fixture.ts";

/**
 * The kit's one promise at phone width: nothing scrolls the page sideways,
 * and a table fits its box. A table page and a tabbed page stand in for the
 * rest.
 */
const POLICY_VIEW = {
  can_edit: true,
  set: true,
  members: 40,
  min_members: 10,
  big_enough: true,
  current: {
    set: true,
    version: 1,
    values: policyFromGoals(["war", "donations"], "standard"),
    saved_at: "2026-09-20T12:00:00Z",
    saved_by: "#20QQL8CCRU",
    saved_by_name: "Ada",
  },
  tabs: TABS,
  groups: GROUPS,
  fields: FIELDS,
  versions: [],
};

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
  await page.goto("/clan/2PQRJ8LV/roster");
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
  await clanApi(
    page,
    clanIn({ "GET /api/clan/clans/2PQRJ8LV/policy": [200, POLICY_VIEW] }),
  );
  await page.goto("/clan/2PQRJ8LV/manage/policy");
  const tabs = page.getByRole("tablist", { name: "Policy" }).getByRole("tab");
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
