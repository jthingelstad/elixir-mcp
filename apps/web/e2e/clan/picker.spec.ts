import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

/**
 * The Clan picker. Jamie, 2026-10-20: "the "Clans" picker in the left
 * rail should go away and it should be a "Clan Picker" that is at the
 * top of the rail similar to what Console has for switching accounts
 * and Ladder has for switching players." The fixture's person leads
 * Example Clan, with two Actions waiting, and is a member of Second
 * Clan; picking lands where the 2026-10-20 ruling says, Actions for the
 * leader and the roster for the member.
 */
const ACTIONS = {
  "GET /api/clan/clans/2PQRJ8LV/actions": [
    200,
    {
      clan_tag: "#2PQRJ8LV",
      as_of: "2026-09-13T09:00:00Z",
      open: [],
      recent: [],
      decline_reasons: ["not_now", "other"],
      discord: { set: false },
    },
  ] as [number, unknown],
};

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

const SIZES = [
  ["phone", { width: 390, height: 844 }],
  ["tablet", { width: 820, height: 1180 }],
  ["desktop", { width: 1280, height: 800 }],
] as const;

for (const [size, viewport] of SIZES)
  test(`switching clans from the rail's head on a ${size}`, async ({
    page,
  }) => {
    // Below 900px the rail folds into a row above the page.
    const narrow = viewport.width <= 900;
    await page.setViewportSize(viewport);
    await mockApi(page, signedIn(ACTIONS));
    await page.goto("/clan/GQ08RJPL");
    await expect(page.getByText("Ben")).toBeVisible();
    const rail = page.locator(".rail");
    const head = rail.locator("button.rail__switch-head");
    await expect(head).toContainText("Second Clan");
    await expect(head).toContainText("#GQ08RJPL");
    await expect(head).toContainText("Member");

    // No Clans item among the sections, and the roster switches nothing.
    if (narrow) await rail.locator(".rail__toggle").click();
    const sections = rail.getByRole("navigation", { name: "Sections" });
    await expect(sections.getByRole("link", { name: /^Roster/ })).toBeVisible();
    await expect(
      sections.getByRole("link", { name: "Clans", exact: true }),
    ).toHaveCount(0);
    await expect(
      sections.getByRole("link", { name: /^Players/ }),
    ).toHaveAttribute("href", "/clan/you");
    if (narrow) await rail.locator(".rail__toggle").click();
    const main = page.locator("main");
    await expect(main.locator('[aria-haspopup="menu"]')).toHaveCount(0);
    await expect(main.getByRole("menu")).toHaveCount(0);

    // Open: each clan and the chooser, as links.
    await head.click();
    const list = page.locator("#rail-clans");
    await expect(
      list.getByRole("link", { name: /Example Clan/ }),
    ).toHaveAttribute("href", "/clan/2PQRJ8LV");
    await expect(
      list.getByRole("link", { name: "All your clans…" }),
    ).toHaveAttribute("href", "/clan/clans");
    await accessible(page, `the open picker, ${size}`);

    // The leader with Actions waiting lands on Actions.
    await list.getByRole("link", { name: /Example Clan/ }).click();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
    await expect(
      page.getByRole("heading", { name: "Actions", exact: true }),
    ).toBeVisible();
    await expect(head).toContainText("Example Clan");
    await expect(head).toContainText("Leader");
    await expect(list).toHaveCount(0);

    // The member lands on the roster, at the clan's own address.
    await head.click();
    await list.getByRole("link", { name: /Second Clan/ }).click();
    await expect(page).toHaveURL(/\/clan\/GQ08RJPL$/);
    await expect(page.getByText("Ben")).toBeVisible();
    await expect(head).toContainText("Second Clan");

    // Each pick was a step in history.
    await page.goBack();
    await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
    await expect(head).toContainText("Example Clan");
  });

test("the picker closes on Escape and a click outside, and the chooser keeps its plain head", async ({
  page,
}) => {
  await mockApi(page, signedIn(ACTIONS));
  await page.goto("/clan/GQ08RJPL");
  await expect(page.getByText("Ben")).toBeVisible();
  const rail = page.locator(".rail");
  const head = rail.locator("button.rail__switch-head");
  const list = page.locator("#rail-clans");
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await list.getByRole("link", { name: /Example Clan/ }).focus();
  await page.keyboard.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(head).toBeFocused();
  // The keyboard opens it too.
  await page.keyboard.press("Enter");
  await expect(list).toBeVisible();
  await page.locator("main h1").click();
  await expect(list).toHaveCount(0);
  // The chooser is the whole list: there the head is the plain one.
  await head.click();
  await list.getByRole("link", { name: "All your clans…" }).click();
  await expect(page).toHaveURL(/\/clan\/clans$/);
  await expect(page.getByRole("heading", { name: "Your clans" })).toBeVisible();
  await expect(rail.locator(".rail__switch")).toHaveCount(0);
  await expect(rail).toContainText("#GQ08RJPL");
});

test("@narrow on a phone the picker sits beside the folded rail, above the page, and your players stay reachable", async ({
  page,
}) => {
  await mockApi(page, signedIn(ACTIONS));
  await page.goto("/clan/GQ08RJPL");
  await expect(page.getByText("Ben")).toBeVisible();
  const rail = page.locator(".rail");
  const head = rail.locator("button.rail__switch-head");
  const toggle = rail.locator(".rail__toggle");
  // Folded: the clan beside the row naming the section, both above the
  // page, and the sections out of the way.
  await expect(head).toContainText("Second Clan");
  await expect(toggle).toContainText("Roster");
  await expect(toggle).not.toContainText("Second Clan");
  await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(
    0,
  );
  const [h, t, m] = await Promise.all([
    head.boundingBox(),
    toggle.boundingBox(),
    page.locator("main").boundingBox(),
  ]);
  expect(Math.abs(h!.y - t!.y)).toBeLessThan(4);
  expect(h!.x + h!.width).toBeLessThanOrEqual(t!.x + 1);
  expect(Math.max(h!.y + h!.height, t!.y + t!.height)).toBeLessThanOrEqual(
    m!.y + 1,
  );
  // Open: the list spans the row and fits the phone.
  await head.click();
  const list = page.locator("#rail-clans");
  await expect(list.getByRole("link", { name: /Example Clan/ })).toBeVisible();
  const box = (await list.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  expect(box.width).toBeGreaterThan(t!.x + t!.width - h!.x - 2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await accessible(page, "the open picker on a phone");
  await list.getByRole("link", { name: /Example Clan/ }).click();
  await expect(page).toHaveURL(/\/clan\/2PQRJ8LV\/actions$/);
  await expect(head).toContainText("Example Clan");
  // The way to your players is the rail's own item.
  await toggle.click();
  await rail.getByRole("link", { name: /^Players/ }).click();
  await expect(page).toHaveURL(/\/clan\/you$/);
  await expect(
    page.getByRole("heading", { name: "You", level: 1 }),
  ).toBeVisible();
  await expect(head).toContainText("Example Clan");
});
