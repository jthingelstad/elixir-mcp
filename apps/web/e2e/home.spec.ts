import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { CARDS, CARDS_NO_SEASON } from "./cards-fixture.ts";

/** The front door (canvas 2026-09-29, the Site board). The page is
 *  built whole; the Cards tile's three and the most-played strip are
 *  drawn from /api/public/cards in the browser, Path of Legends only,
 *  and stay hidden when the season is not there to draw. */

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

test("the front door draws the most played cards in Path of Legends", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/public/cards": [200, CARDS] });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /on the record/ }),
  ).toBeVisible();

  // The Cards tile: the season's top three, in share order.
  const top3 = page.locator("[data-home-top3]");
  await expect(top3).toBeVisible();
  await expect(top3.locator(".home-top3__line > :first-child")).toHaveText([
    "Barbarian Barrel",
    "Skeletons",
    "Fireball",
  ]);
  await expect(top3.locator(".home-top3__pct").first()).toHaveText("33.0%");
  await expect(top3).toContainText("share of Path of Legends decks, October");

  // The strip: every card the mode recorded, most played first, each a
  // link to its page in that mode, with the mode's own battle count.
  const strip = page.getByRole("region", {
    name: "Most played in Path of Legends this season",
  });
  await expect(strip).toBeVisible();
  const cards = strip.locator(".home-strip__card");
  await expect(cards).toHaveCount(6);
  await expect(cards.first()).toHaveAttribute(
    "href",
    "/cards/28000015/?mode=ranked",
  );
  await expect(strip.locator(".home-strip__wins").first()).toHaveText(
    "wins 50.6%",
  );
  await expect(strip).toContainText(
    "share of decks across 654,274 recorded battles · updated 3 hours ago",
  );
  await expect(
    strip.getByRole("link", { name: "All cards ›" }),
  ).toHaveAttribute("href", "/cards/?mode=ranked");

  // Drop next door: the candy button, opening its own host.
  const play = page
    .getByRole("region", { name: "Drop" })
    .getByRole("link", { name: /Play Drop/ });
  await expect(play).toHaveAttribute("href", "https://drop.poapkings.com/");
  await expect(play).toHaveAttribute("target", "_blank");

  await accessible(page, "home");
});

test("without a season the cards' numbers stay off the page", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/public/cards": [200, CARDS_NO_SEASON] });
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Browse cards ›" }),
  ).toBeVisible();
  await expect(page.locator("[data-home-top3]")).toBeHidden();
  await expect(page.locator("[data-home-strip]")).toBeHidden();
});

test("a failed read leaves the front door whole @narrow", async ({ page }) => {
  await mockApi(page, { "GET /api/public/cards": [500, { error: "down" }] });
  await page.goto("/");
  await expect(page.locator("[data-home-strip]")).toBeHidden();
  await expect(page.locator("[data-home-top3]")).toBeHidden();
  // The tiles stack on a phone and every one still has its way in.
  for (const name of [
    "Open Ladder ›",
    "Bring your clan ›",
    "Follow a friend ›",
    "See every email ›",
    "Connect your agent ›",
    "Browse cards ›",
  ])
    await expect(
      page.locator(".home-tile").getByRole("link", { name }),
    ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "the page scrolls sideways on a phone").toBeLessThanOrEqual(
    0,
  );
  await accessible(page, "home, narrow");
});
