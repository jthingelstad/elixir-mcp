import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { CARDS, CARDS_NO_SEASON, KNIGHT } from "./cards-fixture.ts";

/** The public card pages (canvas 2026-09-29: CardsIndex, CardPage),
 *  sign-in free. The list and each card's facts are baked by the site
 *  build; the season's numbers come from /api/public/cards in the
 *  browser, one mode at a time. */

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

const live: Parameters<typeof mockApi>[1] = {
  "GET /api/public/cards": [200, CARDS],
  "GET /api/public/cards/26000000": [200, KNIGHT],
};

const names = (page: Page) =>
  page.locator("[data-cards-grid] .card-tile__name").allTextContents();

test("the index ranks the cards one mode at a time, most played first", async ({
  page,
}) => {
  await mockApi(page, { ...live });
  await page.goto("/cards");
  await expect(
    page
      .getByRole("navigation", { name: "Site" })
      .getByRole("link", { name: "Cards" }),
  ).toHaveAttribute("aria-current", "page");
  const modes = page.getByRole("group", { name: "Mode" });
  await expect(modes.getByRole("button")).toHaveText([
    "Path of Legends",
    "Trophy Road",
    "War",
  ]);
  await expect(
    modes.getByRole("button", { name: "Path of Legends" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-cards-lede]")).toContainText(
    "across the 654,274 Path of Legends battles Elixir recorded this season",
  );
  await expect(page.locator("[data-cards-updated]")).toContainText(
    "updated 3 hours ago",
  );
  expect(await names(page)).toEqual([
    "Barbarian Barrel",
    "Skeletons",
    "Fireball",
    "Knight",
    "Golden Knight",
    "Mega Knight",
  ]);
  const first = page.locator("[data-cards-grid] a.card-tile").first();
  await expect(first).toHaveAttribute("href", "/cards/28000015/?mode=ranked");
  await expect(first.locator(".card-tile__rank")).toHaveText("1");
  await expect(first.locator(".card-tile__pct")).toHaveText("33.0%");
  await expect(first.locator(".card-tile__line")).toContainText(
    "wins 50.6% · 216,144 battles",
  );

  // Another mode is another game: its own order, its own thin readings,
  // and the address says which one.
  await modes.getByRole("button", { name: "Trophy Road" }).click();
  await expect(page).toHaveURL(/\/cards\/?\?mode=ladder$/);
  expect((await names(page)).slice(0, 4)).toEqual([
    "Knight",
    "Skeletons",
    "Mega Knight",
    "Barbarian Barrel",
  ]);
  const barrel = page
    .locator("[data-cards-grid] a.card-tile")
    .filter({ hasText: "Barbarian Barrel" });
  await expect(barrel.locator(".card-thin")).toHaveText("thin");
  await expect(
    page
      .locator("[data-cards-grid] a.card-tile")
      .filter({ hasText: "Fireball" })
      .locator(".card-tile__line"),
  ).toHaveText("No Trophy Road battles yet this season");
  await accessible(page, "cards index");
});

test("search, rarity, elixir and sort narrow the list", async ({ page }) => {
  await mockApi(page, { ...live });
  await page.goto("/cards?mode=ranked");
  await page.getByRole("searchbox", { name: "Find a card" }).fill("knight");
  expect(await names(page)).toEqual(["Knight", "Golden Knight", "Mega Knight"]);
  await page
    .getByRole("group", { name: "Rarity" })
    .getByRole("button", { name: "Champion" })
    .click();
  expect(await names(page)).toEqual(["Golden Knight"]);
  await page
    .getByRole("group", { name: "Rarity" })
    .getByRole("button", { name: "All" })
    .click();
  await page
    .getByRole("group", { name: "Elixir" })
    .getByRole("button", { name: "7+" })
    .click();
  expect(await names(page)).toEqual(["Mega Knight"]);
  await page.getByRole("searchbox", { name: "Find a card" }).fill("");
  await page
    .getByRole("group", { name: "Elixir" })
    .getByRole("button", { name: "7+" })
    .click();
  await page.getByLabel("Sort").selectOption("name");
  expect(await names(page)).toEqual([
    "Barbarian Barrel",
    "Fireball",
    "Golden Knight",
    "Knight",
    "Mega Knight",
    "Skeletons",
  ]);
});

test("with no season to read, the index keeps the catalog and its plain controls", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/public/cards": [200, CARDS_NO_SEASON] });
  await page.goto("/cards");
  await expect(
    page.getByRole("searchbox", { name: "Find a card" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Mode" })).toBeHidden();
  await expect(page.getByLabel("Sort").locator("option")).toHaveText([
    "Elixir cost",
    "Name",
  ]);
  expect(await names(page)).toHaveLength(6);
  await expect(page.locator(".card-tile__pct")).toHaveCount(0);
  await expect(page.locator("[data-cards-updated]")).toBeHidden();
});

test("a failed read leaves what the build baked standing", async ({ page }) => {
  await mockApi(page, {
    "GET /api/public/cards": [503, { error: "unavailable" }],
    "GET /api/public/cards/26000000": [503, { error: "unavailable" }],
  });
  await page.goto("/cards");
  expect(await names(page)).toHaveLength(6);
  await expect(page.locator("[data-cards-controls]")).toBeHidden();
  await expect(page.locator("[data-cards-updated]")).toBeHidden();
  await page.goto("/cards/26000000/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Knight");
  await expect(page.locator('[data-card-live="months"]')).toHaveText(
    "The record could not be read just now.",
  );
  await expect(page.locator('[data-card-live="share"]')).toHaveText("—");
  await expect(page.getByRole("group", { name: "Mode" })).toBeHidden();
  await expect(page.locator("[data-card-chips]")).toBeHidden();
});

test("a card's page reads its season one mode at a time", async ({ page }) => {
  await mockApi(page, { ...live });
  await page.goto("/cards/26000000/");
  await expect(page).toHaveTitle(/^Knight - /);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Knight");
  const modes = page.getByRole("group", { name: "Mode" });
  await expect(modes.getByRole("button")).toHaveText([
    "Path of Legends",
    "Trophy Road",
    "War",
  ]);
  // The card's busiest mode first, and its four figures in that mode.
  await expect(
    modes.getByRole("button", { name: "Path of Legends" }),
  ).toHaveAttribute("aria-pressed", "true");
  const value = (key: string) => page.locator(`[data-card-live="${key}"]`);
  await expect(value("share")).toHaveText("14.7%");
  await expect(value("share-note")).toHaveText(
    "of 654,274 Path of Legends battles",
  );
  await expect(value("wins")).toHaveText("49.5%");
  await expect(value("battles")).toHaveText("96,000");
  await expect(value("players")).toHaveText("7,900");
  await expect(page.locator("[data-card-rank]")).toHaveText(
    "4th most played in Path of Legends this season",
  );
  await expect(page.locator("[data-card-issue]")).toContainText(
    "Card of the Week, Sep 18",
  );
  await expect(page.locator("[data-card-updated]")).toContainText(
    "updated 3 hours ago",
  );
  const rows = page.locator('[data-card-live="modes"] tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".card-months__col")).toHaveCount(4);

  await modes.getByRole("button", { name: "Trophy Road" }).click();
  await expect(page).toHaveURL(/\?mode=ladder$/);
  await expect(value("share")).toHaveText("34.5%");
  await expect(value("agent-mode")).toHaveText("ladder");
  await expect(page.locator("[data-card-rank]")).toHaveText(
    "most played in Trophy Road this season",
  );
  await expect(
    page.locator('[data-card-live="modes"] tr[data-mode="ladder"]'),
  ).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link"),
  ).toHaveAttribute("href", "/cards/?mode=ladder");
  await accessible(page, "card page");
});

test("a card's page opens on the mode it was linked with", async ({ page }) => {
  await mockApi(page, { ...live });
  await page.goto("/cards/26000000/?mode=war");
  await expect(
    page.getByRole("group", { name: "Mode" }).getByRole("button", {
      name: "War",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-card-live="battles"]')).toHaveText("5,100");
});

test("@narrow the index and a card's page fit a phone", async ({ page }) => {
  await mockApi(page, { ...live });
  for (const path of ["/cards", "/cards/26000000/"]) {
    await page.goto(path);
    await expect(page.getByRole("group", { name: "Mode" })).toBeVisible();
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width, path).toBeLessThanOrEqual(420);
    await accessible(page, `${path}, narrow`);
  }
});
