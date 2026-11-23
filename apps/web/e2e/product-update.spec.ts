import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { ME, mockApi } from "./fixtures.ts";
import { homeApi, TIMELINE } from "./home-fixture.ts";

// A product update in Home's Timeline (2026-11-23): a What's new entry
// marked for everyone, from Elixir, with its page one tap away and none of
// a story's actions.
const at = "2026-11-18T16:00:00.000Z";
const update = {
  id: "product_update:2026-11-18-news-from-elixir",
  kind: "product_update",
  section: "product",
  at,
  sort_at: at,
  observed_at: at,
  subject_tag: null,
  subjects: [],
  groups: [],
  text: "News from Elixir now shows up in your Timeline",
  product_update: {
    title: "News from Elixir now shows up in your Timeline",
    lede: "When Elixir gets something new you'd want to know about, you'll see it right here, with a link to read the rest.",
    path: "/updates/2026-11-18-news-from-elixir",
  },
};
const friend = {
  ...TIMELINE.timeline[0],
  id: "tl_00000000000000000001",
  at,
  sort_at: at,
  observed_at: at,
};
const shots = process.env.PRODUCT_UPDATE_SHOTS;
test.use({ reducedMotion: "reduce" });
for (const width of [320, 390, 1280]) {
  test(`a product update reads as Elixir's own news at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApi(
      page,
      homeApi({
        "GET /api/me": [200, ME],
        "GET /api/me/home/feed": [
          200,
          {
            ...TIMELINE,
            timeline: [update, friend],
            timeline_more: 0,
            total: 2,
            next: null,
          },
        ],
      }),
    );
    await page.goto("/timeline");
    const cards = page.locator(".kit-feed__item");
    await expect(cards).toHaveCount(2);
    const card = cards.filter({ hasText: update.text });
    await expect(card.locator(".kit-feed__name")).toHaveText("Elixir");
    await expect(card).toContainText(update.product_update.lede);
    await expect(card.getByRole("link", { name: "Read more" })).toHaveAttribute(
      "href",
      update.product_update.path,
    );
    await expect(card.getByRole("button")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
    if (shots) {
      mkdirSync(shots, { recursive: true });
      await page.screenshot({
        path: path.join(shots, `product-update-${width}.png`),
      });
    }
  });
}
