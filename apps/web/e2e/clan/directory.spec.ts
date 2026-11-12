import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./fixtures.ts";

/* The clan directory (#768) at phone width: one column of tiles, nothing
   wider than the screen, filters that hide and never reorder, and no
   serious accessibility finding. Every clan here is invented. */
const policy = (over: Record<string, unknown> = {}) => ({
  war_intent: "participating",
  posture: "standard",
  together: false,
  counted: ["war", "donations"],
  removal_day: 14,
  saved_at: "2026-11-01T00:00:00.000Z",
  ...over,
});
const DIRECTORY = {
  schema_version: 1,
  truncated: false,
  read_at: "2026-11-12T12:00:00.000Z",
  clans: [
    {
      clan_tag: "#PYLQ2",
      name: "Alpha Example",
      type: "open",
      description:
        "A long in-game description that has to wrap on a phone without pushing the tile wider than the screen it is on.",
      members: 41,
      required_trophies: 5000,
      yours: false,
      policy: policy(),
    },
    {
      clan_tag: "#2PQRJ8LV",
      name: "Example Clan",
      type: "inviteOnly",
      description: null,
      members: 50,
      required_trophies: 3000,
      yours: true,
      policy: policy({
        war_intent: "not_participating",
        posture: "relaxed",
        together: true,
        counted: [],
        removal_day: null,
      }),
    },
    {
      clan_tag: "#8QCV",
      name: "Zulu Example",
      type: "open",
      description: "Every week counts.",
      members: null,
      required_trophies: null,
      yours: false,
      policy: policy({ posture: "strict", removal_day: 30 }),
    },
  ],
};
const tiles = (page: Page) => page.locator(".clan-dir__tile h2");

async function fitsTheScreen(page: Page) {
  const wide = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    view: window.innerWidth,
    tiles: [...document.querySelectorAll(".clan-dir__tile")].map(
      (t) => t.getBoundingClientRect().right,
    ),
  }));
  expect(wide.page).toBeLessThanOrEqual(wide.view);
  for (const right of wide.tiles) expect(right).toBeLessThanOrEqual(wide.view);
}

test.describe("clan directory @narrow", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a grid of tiles by name, filtered by the rules, at phone width", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({ "GET /api/clan/directory": [200, DIRECTORY] }),
    );
    await page.goto("/clan/directory");
    await expect(
      page.getByRole("heading", { level: 1, name: "Clan directory" }),
    ).toBeVisible();
    await expect(tiles(page)).toHaveText([
      "Alpha Example",
      "Example Clan",
      "Zulu Example",
    ]);
    await expect(page.getByText("3 listed clans, by name")).toBeVisible();
    // One column: every tile starts at the same left edge.
    const lefts = await page
      .locator(".clan-dir__tile")
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().left));
    expect(new Set(lefts).size).toBe(1);
    await fitsTheScreen(page);

    // Your own clan opens in Clan; another clan has no page, so no link.
    await expect(
      page.getByRole("link", { name: "Example Clan" }),
    ).toHaveAttribute("href", "/clan/2PQRJ8LV");
    await expect(page.getByRole("link", { name: "Zulu Example" })).toHaveCount(
      0,
    );

    // A filter hides tiles and keeps the order.
    await page
      .getByRole("group", { name: "Days with no battle before a removal" })
      .getByRole("button", { name: "14 days or more" })
      .click();
    await expect(tiles(page)).toHaveText(["Alpha Example", "Zulu Example"]);
    await expect(page.getByText(/^2 of 3 listed clans fit/)).toBeVisible();
    await page.getByLabel("Your trophies").fill("4000");
    await expect(page.getByText("No clan fits all of that")).toBeVisible();
    await page
      .getByRole("button", { name: "Clear the filters" })
      .first()
      .click();
    await expect(tiles(page)).toHaveCount(3);

    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? ""),
      ),
    ).toEqual([]);
  });

  test("someone with no clan reads it, and is not sent away", async ({
    page,
  }) => {
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [
          200,
          { ...ME, ok: false, reason: "no_clan", clans: [], selected: null },
        ],
        "GET /api/clan/directory": [200, DIRECTORY],
      }),
    );
    await page.goto("/clan/directory");
    await expect(tiles(page)).toHaveCount(3);
    await expect(page).toHaveURL(/\/clan\/directory$/);
    await fitsTheScreen(page);
  });
});
