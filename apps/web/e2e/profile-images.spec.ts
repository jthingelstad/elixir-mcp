import { PNG } from "./test-art.ts";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./fixtures.ts";

/**
 * Profile images (2026-11-14): pick a card in Settings › Profile, save it,
 * and see it in the bar's button; a player page shows a verified player's
 * image on its head and initials for a follow with none. Card art is
 * served here (the mirror is not in git); a card whose art fails keeps its
 * initials. Invented players only.
 */

const BROKEN = 26000010;

async function serveArt(page: Page) {
  await page.route("**/assets/cards/**", (route) =>
    route.request().url().includes(`/${BROKEN}.png`)
      ? route.fulfill({ status: 404, body: "" })
      : route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
}

async function fitsAndPasses(page: Page, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
    `${name}: sideways`,
  ).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    results.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      ),
    `${name}: accessibility`,
  ).toEqual([]);
}

const CARDS = {
  cards: [
    { id: 26000000, name: "Knight" },
    { id: 28000001, name: "Arrows" },
    { id: BROKEN, name: "Skeleton Army" },
    { id: 26000021, name: "Hog Rider" },
  ],
};

const PLAYER = {
  player: {
    tag: "#0PRJ8Y2C",
    name: "Invented Lark",
    clan_tag: "#0PRJ8Y2P",
    clan_name: "Invented Grove",
    trophies: 9100,
    recorded: true,
    avatar_card_id: 26000021,
  },
  you: { own: false, following: true, relationship: "friend", clanmate: null },
  badges: { verified_player: true, discord: false },
  follows: {
    count: 2,
    players: [
      { tag: "#0PRJ8Y2Q", name: "Invented Wren" },
      { tag: "#0PRJ8Y2U", name: "Invented Finch", avatar_card_id: BROKEN },
    ],
  },
  followers: { count: 0, players: [], unnamed: 0 },
  window_days: 30,
  timeline: [],
  timeline_more: 0,
  moments: [],
  highlights: [],
};

for (const [label, width] of [
  ["desktop", 1180],
  ["phone", 390],
] as const) {
  test.describe(label, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await serveArt(page);
    });

    test("pick a card, save it, and the bar wears it; Remove brings the initials back", async ({
      page,
    }) => {
      let saved: number | null = null;
      const posted: unknown[] = [];
      await mockApi(
        page,
        signedIn({
          "GET /api/me": () => [200, { ...ME, avatar_card_id: saved }],
          "GET /api/public/cards": [200, CARDS],
          "POST /api/me/avatar": (route) => {
            const body = route.request().postDataJSON();
            posted.push(body);
            saved = body.card_id;
            return [200, { ok: true, avatar_card_id: saved }];
          },
        }),
      );
      await page.goto("/settings/profile");
      await expect(page.getByRole("group", { name: "Cards" })).toBeVisible();
      await expect(
        page.getByText(
          "Your profile image shows on the players you've verified",
        ),
      ).toBeVisible();
      await fitsAndPasses(page, "picker");

      await page.getByRole("searchbox", { name: "Search cards" }).fill("kni");
      const knight = page.getByRole("button", { name: "Knight" });
      await expect(knight).toHaveAttribute("aria-pressed", "false");
      const box = await knight.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      await knight.click();
      await expect(knight).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("status")).toHaveText("Saved.");
      expect(posted).toEqual([{ card_id: 26000000 }]);
      const bar = page.locator(".kit-top__account .chrome__avatar").first();
      await expect(bar.locator("img")).toHaveAttribute(
        "src",
        "/assets/cards/26000000.png",
      );

      await page.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByRole("status")).toHaveText(
        "Removed. Your initials are back.",
      );
      expect(posted).toEqual([{ card_id: 26000000 }, { card_id: null }]);
      await expect(bar.locator("img")).toHaveCount(0);
    });

    test("a player page: the verified player's image on its head, initials where there is none or the art fails", async ({
      page,
    }) => {
      await mockApi(page, signedIn({ "GET /api/player": [200, PLAYER] }));
      await page.goto("/home/player/0PRJ8Y2C");
      const head = page.locator(".kit-av--l").first();
      await expect(head.locator("img")).toHaveAttribute(
        "src",
        "/assets/cards/26000021.png",
      );
      await expect
        .poll(() =>
          head
            .locator("img")
            .evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBeGreaterThan(0);
      await page.getByRole("tab", { name: /Follows/ }).click();
      // Wren has no image; Finch's art fails, so Finch's initials come back.
      await expect(page.getByText("Invented Finch")).toBeVisible();
      await expect(page.locator(".kit-av--image")).toHaveCount(1);
      await fitsAndPasses(page, "player page");
    });
  });
}
