import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

/**
 * Home's layout in a busy week (G3, 2026-11-12). The walk found Home
 * 20,870 px tall: a week of 150 items drawn at once, with the side panels
 * stacked under it. Now the feed comes thirty at a time (G1), the panels
 * sit beside it on a wide screen, and on a phone the feed comes first and
 * the panels follow it. Invented players only.
 */
const AGO = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const WEEK = { from: AGO(10_080), to: AGO(0) };
const TOTAL = 150;
const PAGE = 30;

/** Item i of the busy week: every third a sitting with its sparkline. */
function item(i: number) {
  const tag = `#2Y${"0289PYLQGRJCUV"[i % 14]}${"PYLQ"[i % 4]}8V`;
  const name = `Invented ${i % 17}`;
  const base = {
    id: `tl_${String(i).padStart(20, "0")}`,
    at: AGO(10 + i * 60),
    observed_at: AGO(9 + i * 60),
    subject_tag: tag,
    subject_name: name,
    subjects: [{ tag, kind: "player", name }],
    groups: ["friends"],
  };
  return i % 3 === 0
    ? {
        ...base,
        kind: "battle_session",
        text: `${name} won 3 of 5 in Trophy Road.`,
        facts: { battles: 5, won: 3, lost: 2, by_mode: { ladder: 5 } },
        spark: [
          { r: "w", m: 3 },
          { r: "l", m: 1 },
          { r: "w", m: 2 },
          { r: "w", m: 1 },
          { r: "l", m: 2 },
        ],
      }
    : {
        ...base,
        kind: "pol_league",
        text: `${name} reached Path of Legends.`,
        facts: {},
      };
}

const busyWeek = () =>
  homeApi({
    "GET /api/me/home/feed": (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      const offset = cursor ? Number(cursor) : 0;
      const end = Math.min(offset + PAGE, TOTAL);
      return [
        200,
        {
          window: WEEK,
          seen_to: AGO(120),
          timeline: Array.from({ length: end - offset }, (_, k) =>
            item(offset + k),
          ),
          total: TOTAL,
          next: end < TOTAL ? String(end) : null,
          timeline_more: 0,
          ...(offset === 0
            ? {
                counts: {
                  everyone: TOTAL,
                  you: 0,
                  friends: TOTAL,
                  clan: 0,
                  new: 2,
                  new_since: AGO(120),
                },
              }
            : {}),
        },
      ];
    },
  });

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).boundingBox();
  expect(b, selector).not.toBeNull();
  return b!;
};
const pageHeight = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollHeight);

for (const [label, width, tallest] of [
  // Measured with this fixture on 2026-11-12: thirty items and the panels
  // are 3,471 px wide and 4,676 px on a phone; the week's 150 at once were
  // 15,137 and 16,342. The bound leaves room for a panel growing, never for
  // the feed drawing the week at once.
  ["desktop", 1180, 5_000],
  ["phone", 390, 6_500],
] as const) {
  test(`${label}: a busy week's Home is thirty items tall, its panels ${
    label === "desktop" ? "beside the feed" : "after it"
  } (G3)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockApi(page, busyWeek());
    await page.goto("/home");
    const items = page.locator(".kit-feed .kit-feed__item");
    await expect(items).toHaveCount(PAGE);
    await expect(page.getByText(`30 of ${TOTAL} shown`)).toBeVisible();
    await expect(page.getByText("23–14")).toBeVisible();

    const main = await box(page, ".kit-home__main");
    const side = await box(page, ".kit-home__side");
    if (label === "desktop") {
      // Beside: to the right of the feed, its top level with the feed's.
      expect(side.x).toBeGreaterThanOrEqual(main.x + main.width);
      expect(Math.abs(side.y - main.y)).toBeLessThan(4);
    } else {
      // A phone reads the feed first; the panels follow it.
      expect(side.y).toBeGreaterThanOrEqual(main.y + main.height);
    }
    const height = await pageHeight(page);
    expect(height).toBeLessThan(tallest);

    // More draws the next thirty of the same week, and only those.
    await page.getByRole("button", { name: "More" }).click();
    await expect(items).toHaveCount(2 * PAGE);
    await expect(page.getByText(`60 of ${TOTAL} shown`)).toBeVisible();
  });
}
