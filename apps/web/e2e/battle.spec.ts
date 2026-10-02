import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi } from "./fixtures.ts";
import { BATTLE, DUEL } from "./battle-fixture.ts";

/** A battle's public page (2026-10-01): sign-in free, the recorded
 *  player left and the opponent right, both decks, how it ended. */

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

const battles: Parameters<typeof mockApi>[1] = {
  [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
  [`GET /api/public/battles/${DUEL.battle.short_id}`]: [200, DUEL],
  "GET /api/public/battles/ffffffffffff": [404, { error: "not_found" }],
};

test("signed out: both decks, the score, how it ended, and the way in", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT], ...battles });
  await page.goto(`/battle/${BATTLE.battle.short_id}`);
  const left = BATTLE.sides[0]!.players[0]!.name as string;
  const right = BATTLE.sides[1]!.players[0]!.name as string;
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    `${left} beat ${right} 2 to 1 on Trophy Road`,
  );
  await expect(page).toHaveTitle(`${left} and ${right} - Battle - Elixir`);
  // Left is the player, right the opponent, each with a deck to copy.
  const decks = page.getByRole("region", { name: /’s deck$/ });
  await expect(decks).toHaveCount(2);
  await expect(decks.first()).toHaveAccessibleName(`${left}’s deck`);
  const copy = page.getByRole("link", {
    name: `Copy ${left}’s deck into Clash Royale`,
  });
  await expect(copy).toHaveAttribute(
    "href",
    /^https:\/\/link\.clashroyale\.com\/en\/\?clashroyale:\/\/copyDeck\?deck=(\d+;){7}\d+&tt=159000000$/,
  );
  // Eight card tiles a side, each a link to its card page.
  await expect(
    decks.first().getByRole("link", { name: /level 16$/ }),
  ).toHaveCount(8);
  await expect(
    page.getByRole("region", { name: "How it ended" }),
  ).toContainText("The game went to time with 3 towers down.");
  await expect(
    page.getByRole("region", { name: "Side by side" }),
  ).toContainText("13,591 → 13,621");
  // No account: game names only, no player links, and the way in.
  await expect(page.locator(".battle__name").first()).toHaveText(left);
  await expect(page.locator("a.battle__name")).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Request access" }),
  ).toHaveAttribute("href", "/console/signin?request");
  await expect(page.getByText(BATTLE.battle.id)).toBeVisible();
  await expect(page.locator(".rail")).toHaveCount(0);
  await accessible(page, "battle");
});

test("signed in: your side says so, names open the record, another battle stays in the page", async ({
  page,
}) => {
  const tag = BATTLE.sides[0]!.players[0]!.player_tag as string;
  const me = { ...ME, claims: [{ ...ME.claims[0], player_tag: tag }] };
  const next = BATTLE.sitting.find((x) => x.url !== BATTLE.battle.url)!;
  const nextShort = next.url!.split("/").pop()!;
  await mockApi(page, {
    "GET /api/me": [200, me],
    ...battles,
    [`GET /api/public/battles/${nextShort}`]: [200, DUEL],
  });
  await page.goto(`/battle/${BATTLE.battle.short_id}`);
  await expect(page.locator(".battle__score .chip--ok")).toHaveText("you");
  await expect(page.locator("a.battle__name").first()).toHaveAttribute(
    "href",
    `/console/explore/player/${tag.slice(1)}`,
  );
  await expect(page.getByRole("link", { name: "Request access" })).toHaveCount(
    0,
  );
  // The session: this battle marked, the other one a link that loads
  // in-app.
  const session = page.getByRole("region", { name: /’s session$/ });
  await expect(session.locator("[aria-current=page]")).toContainText(
    "this battle",
  );
  await session.getByRole("link").first().click();
  await expect(page).toHaveURL(new RegExp(`/battle/${nextShort}$`));
  await expect(page.getByRole("tablist", { name: "Games" })).toBeVisible();
});

test("a duel: games won on top, then each game's decks and towers", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT], ...battles });
  await page.goto(`/battle/${DUEL.battle.short_id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "2 to 1 games on War",
  );
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await expect(tabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("region", { name: "How game 1 ended" }),
  ).toBeVisible();
  await tabs.nth(2).click();
  await expect(
    page.getByRole("region", { name: "How game 3 ended" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Side by side" })).toHaveCount(
    0,
  );
  await accessible(page, "duel");
});

test("a battle Elixir does not hold says so", async ({ page }) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT], ...battles });
  await page.goto("/battle/ffffffffffff");
  await expect(page.getByText("No battle at this link")).toBeVisible();
});

test("@narrow on a phone both decks still sit side by side", async ({
  page,
}) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT], ...battles });
  await page.goto(`/battle/${BATTLE.battle.short_id}`);
  const decks = page.getByRole("region", { name: /’s deck$/ });
  await expect(decks).toHaveCount(2);
  const [a, b] = [
    await decks.nth(0).boundingBox(),
    await decks.nth(1).boundingBox(),
  ];
  expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeLessThan(2);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(420);
  await accessible(page, "battle, narrow");
});
