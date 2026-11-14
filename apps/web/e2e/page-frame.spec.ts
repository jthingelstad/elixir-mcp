import { test, expect, type Page } from "@playwright/test";
import { mockApi, signedIn } from "./fixtures.ts";
import { explore } from "./stats-fixture.ts";
import { homeApi } from "./home-fixture.ts";
import { mockApi as clanApi, signedIn as clanIn } from "./clan/fixtures.ts";

/** A box's content edges, without its padding. */
const edges = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const box = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      return [
        Math.round(box.left + parseFloat(css.paddingLeft)),
        Math.round(box.right - parseFloat(css.paddingRight)),
      ];
    });

const sameAsBar = async (page: Page, selector: string) =>
  expect(await edges(page, selector)).toEqual(
    await edges(page, ".kit-top__row"),
  );

for (const width of [1440, 1100, 820]) {
  test.describe(`one page frame at ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("Home, Stats and Clan keep the bar's edge", async ({ page }) => {
      await mockApi(page, homeApi());
      await page.goto("/home");
      await expect(page.locator(".kit-shell__main h1")).toBeVisible();
      await sameAsBar(page, ".kit-shell__main");
      await page.unrouteAll();

      await mockApi(page, signedIn({ "POST /api/me/tool": explore() }));
      await page.goto("/home/you/stats");
      await expect(page.locator(".stats-page")).toBeVisible();
      await sameAsBar(page, ".stats-page");
      await page.unrouteAll();

      await clanApi(page, clanIn());
      await page.goto("/clan/0QC8RCGY/members");
      await expect(page.locator(".clan-head")).toBeVisible();
      await sameAsBar(page, ".page__inner");
    });
  });
}

test.describe("at computer width", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("place and page headings use the same text face", async ({ page }) => {
    await clanApi(page, clanIn());
    await page.goto("/clan/0QC8RCGY/members");
    const font = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).fontFamily);
    await expect(page.locator(".clan-head h1")).toHaveText("Example Clan");
    expect(await font(".clan-head h1")).toContain("Inter");
    expect(await font(".clan-head h1")).not.toContain("Clash Royale");
    await expect(
      page.getByRole("heading", { level: 2, name: "Roster" }),
    ).toBeVisible();
    expect(await font(".page__inner .kit-head__title >> nth=1")).not.toContain(
      "Clash Royale",
    );
  });

  test("Settings' rail keeps its column inside the frame", async ({ page }) => {
    await mockApi(page, signedIn({ "POST /api/me/tool": explore() }));
    await page.goto("/settings/usage");
    await expect(page.locator(".rail")).toBeVisible();
    const [railLeft] = await edges(page, ".rail");
    const [barLeft, barRight] = await edges(page, ".kit-top__row");
    expect(railLeft).toBe(barLeft);
    expect((await edges(page, ".page__inner"))[1]).toBe(barRight);
  });

  test("a feedback row fills the panel at computer width", async ({ page }) => {
    await mockApi(
      page,
      signedIn({
        "POST /api/me/tool": explore(),
        "GET /api/me/feedback": [
          200,
          {
            feedback: [
              {
                feedback_id: 7,
                status: "new",
                area: "console",
                category: "idea",
                message: "A long enough line to show the row did not collapse.",
                created_at: "2026-09-20T12:00:00Z",
                refs: [],
              },
            ],
          },
        ],
      }),
    );
    await page.goto("/settings/feedback");
    const row = page.locator(".timeline-list__row > .kit-row").first();
    await expect(row).toBeVisible();
    expect((await row.boundingBox())?.width ?? 0).toBeGreaterThan(300);
  });

  test("a meter's fill is as wide as its value", async ({ page }) => {
    await mockApi(
      page,
      signedIn({
        "POST /api/me/tool": explore(),
        "GET /api/me/usage": [
          200,
          {
            today_calls: 40,
            budget_today_calls: 2000,
            days: [],
            top_tools: [],
            by_caller: [
              { kind: "agent", name: "Most", calls: 100 },
              { kind: "agent", name: "Half", calls: 50 },
            ],
          },
        ],
      }),
    );
    await page.goto("/settings/usage");
    const meter = page.locator(".st-meter .meter").nth(1);
    await expect(meter).toBeVisible();
    const width = (el: Element) => el.getBoundingClientRect().width;
    const whole = await meter.evaluate(width);
    const fill = await meter.locator(".meter__fill").evaluate(width);
    expect(whole).toBeGreaterThan(50);
    expect(Math.abs(fill / whole - 0.5)).toBeLessThan(0.02);
  });

  test("Stats' scope stays on one line, and its names are only names", async ({
    page,
  }) => {
    await mockApi(page, signedIn({ "POST /api/me/tool": explore() }));
    await page.goto("/home/you/stats");
    const bar = page.locator(".stats-scope");
    await expect(bar).toBeVisible();
    const select = page.getByLabel("Season", { exact: true });
    const chip = bar.getByRole("button", { name: "Trophy Road" });
    const [s, c] = await Promise.all([
      select.boundingBox(),
      chip.boundingBox(),
    ]);
    expect(
      Math.abs(
        (s?.y ?? 0) +
          (s?.height ?? 0) / 2 -
          ((c?.y ?? 99) + (c?.height ?? 0) / 2),
      ),
    ).toBeLessThan(4);
    expect(s?.height).toBe(36);
  });
});

test("@narrow mode chips scroll on one line, and the edge says there are more", async ({
  page,
}) => {
  await mockApi(page, signedIn({ "POST /api/me/tool": explore() }));
  await page.goto("/home/you/stats");
  const row = page.locator(".stats-scope__modes");
  await expect(row).toBeVisible();
  const ys = await row
    .locator(".kit-chip")
    .evaluateAll((all) => all.map((c) => c.getBoundingClientRect().top));
  expect(new Set(ys).size).toBe(1);
  await expect(row).toHaveAttribute("data-more-right", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test("@narrow Clan's roster is two lines a member", async ({ page }) => {
  await clanApi(page, clanIn());
  await page.goto("/clan/0QC8RCGY/members");
  const row = page.locator(".roster-table tbody tr").first();
  await expect(row).toBeVisible();
  await expect(row.locator(".roster-table__wide").first()).toBeHidden();
  await expect(row.locator(".roster-table__line")).toBeVisible();
  const box = await row.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 999).toBeLessThan(90);
  // The avatar leads the row (2026-11-13, the canvas's roster), and the
  // name follows it with no column between them.
  const avatar = row.locator(".kit-table__lead .kit-av").first();
  const av = await avatar.boundingBox();
  expect((av?.x ?? 999) - (box?.x ?? 0)).toBeLessThan(30);
  const name = row.locator(".kit-table__lead a").first();
  const left = (await name.boundingBox())?.x ?? 999;
  expect(left - ((av?.x ?? 0) + (av?.width ?? 0))).toBeLessThan(16);
});
