import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { sessionDayApi } from "./session-fixture.ts";

/**
 * A session's card and its own page (2026-11-16): the card's headline is
 * its facts, a one-battle sitting is a lighter card, the deck switch is
 * said, and the whole card opens the session's page, where every game
 * shows both decks, the facts that marked it, and (for your own verified
 * player) a way to post about it. Phone first, then wide; invented players.
 */
async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

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

for (const [label, width, tag] of [
  ["phone", 420, "@narrow "],
  ["wide", 1280, ""],
] as const) {
  test(`${tag}${label}: the feed's session cards`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, sessionDayApi());
    await page.goto("/home");
    const big = page.getByRole("link", {
      name: /^Open King Thing’s session: Won 8 of 12 on Trophy Road, 5 in a row/,
    });
    await expect(big).toBeVisible();
    // The timeline's sentence stays for MCP, RSS and Discord; the card
    // says the sitting from its facts.
    await expect(
      page.getByText("King Thing played 12 battles in one session", {
        exact: false,
      }),
    ).toHaveCount(0);
    await expect(big.locator(".kit-scard__chips")).toHaveText(
      /3 three-crown wins\s*Best win 3-0/,
    );
    await expect(big.locator("ul.kit-deckrow > li")).toHaveCount(8);
    await expect(big.locator(".kit-scard__caption")).toHaveText(
      "Hog Rider cycle · 8 of 12 battles · +1 more deck: Giant beatdown (4)",
    );
    // The event sitting names its event and every deck it switched to.
    await expect(
      page.getByRole("link", {
        name: /^Open Pip’s session: Won 5 of 6 in Classic 1v1/,
      }),
    ).toContainText(
      "+2 more decks: Lava Hound beatdown (2), Hog Rider cycle (1)",
    );
    // One battle is one line (2026-11-17): no figures, no strip, no deck.
    const one = page.getByRole("link", { name: /^Open Ada’s session:/ });
    await expect(one).toContainText("Lost a Trophy Road battle −28 trophies");
    await expect(one.locator(".kit-sfacts, .kit-spark")).toHaveCount(0);
    const bigBox = await big.boundingBox();
    const oneBox = await one.boundingBox();
    expect(oneBox!.height).toBeLessThan(bigBox!.height * 0.6);
    await noSideways(page);
    await accessible(page, `${label} feed`);

    // The card opens the session's page; Back returns to the feed.
    await big.click();
    await expect(page).toHaveURL(
      /\/home\/player\/20JJJ2CCRU\/session\/tl_s12\?at=/,
    );
    await expect(page).toHaveTitle("Session - Timeline - Elixir");
    await page.goBack();
    await expect(big).toBeVisible();
  });

  test(`${tag}${label}: a session's page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(page, sessionDayApi());
    await page.goto("/home/player/20JJJ2CCRU/session/tl_s12");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Won 8 of 12 on Trophy Road, 5 in a row",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "King Thing" }),
    ).toHaveAttribute("href", "/home/player/20JJJ2CCRU");
    // Both decks with their art, most played first.
    const decks = page.locator(".kit-session__deck");
    await expect(decks).toHaveCount(2);
    await expect(decks.first()).toContainText("Hog Rider cycle · 8 battles");
    await expect(decks.nth(1)).toContainText("Giant beatdown · 4 battles");
    // Every game, newest first, with the other side's deck.
    const rows = page.locator(".kit-session__games .kit-sgame");
    await expect(rows).toHaveCount(12);
    await expect(rows.first().locator(".kit-sgame__theirs li")).toHaveCount(8);
    // Facts that marked a game: a new best, three crowns, the run's end.
    const best = rows.filter({ hasText: "New best: 7,512 trophies" });
    await expect(best).toHaveCount(1);
    await expect(best).toContainText("5th win in a row");
    await expect(rows.filter({ hasText: "Three crowns" })).toHaveCount(3);
    // Hostile names are text, never markup.
    await expect(page.getByText("<b>Quill</b>")).toBeVisible();
    await expect(
      page.locator(".kit-sgame b", { hasText: /^Quill$/ }),
    ).toHaveCount(0);
    // An opponent opens their page; a game opens its battle, and your own
    // verified player's game offers Post one tap away.
    await expect(
      page.getByRole("link", { name: "Your games with Ada" }),
    ).toHaveAttribute(
      "href",
      "/home/player/00C298UC?tab=together&as=%2320JJJ2CCRU",
    );
    const marked = rows.filter({ hasText: "5th win in a row" });
    await expect(
      marked.getByRole("link", { name: /^Post about/ }),
    ).toHaveAttribute("href", /\?from=highlight#post$/);
    const first = rows.first();
    await expect(first.locator(".kit-sgame__name").first()).toHaveAttribute(
      "href",
      /^\/home\/player\//,
    );
    const go = await first
      .getByRole("link", { name: /^Battle/ })
      .getAttribute("href");
    await expect(
      first.getByRole("link", { name: /^Post about the battle/ }),
    ).toHaveAttribute("href", `${go}#post`);
    await expect(page.locator(".kit-session__honest")).toContainText(
      "Only battles Elixir recorded are here",
    );
    await noSideways(page);
    await accessible(page, `${label} session page`);

    // Someone else's one battle: no Post, and the counted gap said.
    await page.goto("/home/player/00C298UC/session/tl_s1");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Lost a Trophy Road battle",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Post about the battle/ }),
    ).toHaveCount(0);
    await noSideways(page);
    await accessible(page, `${label} one-battle page`);

    // A session the record does not have says so.
    await page.goto("/home/player/00C298UC/session/tl_gone");
    await expect(
      page.getByText("Elixir has no record of this session"),
    ).toBeVisible();
  });
}
