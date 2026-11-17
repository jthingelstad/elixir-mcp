import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, clanTab, mockApi, signedIn } from "./fixtures.ts";

const BASE = "/api/clan/clans/0QC8RCGY";

for (const width of [320, 390, 1280]) {
  test(`Clan Timeline keeps activity first and focuses clan news at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const clan = { ...ME.clans[0], role: "member", role_label: "Member" };
    const routes = signedIn({
      "GET /api/clan/me": [
        200,
        { ...ME, selected: clan, clans: [clan], open_actions: 0 },
      ],
      [`GET ${BASE}/actions`]: [
        200,
        { open: [], recent: [], discord: { configured: true } },
      ],
    });
    const [, feed] = routes[`GET ${BASE}/feed`] as [
      number,
      { items: { clan_news?: boolean }[] },
    ];
    routes[`GET ${BASE}/feed`] = (route) => [
      200,
      {
        ...feed,
        items:
          new URL(route.request().url()).searchParams.get("view") === "news"
            ? feed.items.filter((item) => item.clan_news)
            : feed.items,
      },
    ];
    await mockApi(page, routes);
    await page.goto("/clan/0QC8RCGY/feed");
    await expect(page).toHaveURL(/\/clan\/0QC8RCGY\/feed$/);
    await expect(page).toHaveTitle(/Elixir/);
    await expect(clanTab(page, "Timeline")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const story = page.getByText("Three crowns with seconds left");
    await expect(story).toBeVisible();
    await expect(
      page.getByRole("button", { name: "All activity" }),
    ).toHaveAttribute("aria-pressed", "true");
    const about = page.getByRole("button", { name: "About this clan" });
    await expect(about).toHaveAttribute("aria-expanded", "false");
    expect((await about.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (width < 760) {
      const race = await page
        .getByRole("region", { name: "This week's race" })
        .boundingBox();
      expect((await story.boundingBox())!.y).toBeLessThan(race!.y);
      expect((await story.boundingBox())!.y).toBeLessThan(700);
    }
    await about.focus();
    await page.keyboard.press("Enter");
    await expect(about).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/5,000 trophies to join/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Space");
    await expect(about).toHaveAttribute("aria-expanded", "false");
    await expect(about).toBeFocused();

    const newsRequest = page.waitForRequest(
      (request) => new URL(request.url()).searchParams.get("view") === "news",
    );
    await page.getByRole("button", { name: "Clan news" }).click();
    await newsRequest;
    await expect(page.getByText("Dee joined Example Clan")).toBeVisible();
    await expect(story).toHaveCount(0);
    await page.getByRole("button", { name: "All activity" }).click();
    await expect(story).toBeVisible();
    await expect(page.getByText("Dee joined Example Clan")).toHaveCount(1);
    for (const name of ["All activity", "Clan news"])
      expect(
        (await page.getByRole("button", { name }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      axe.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
    if (width < 760) {
      await page.evaluate(() =>
        document.documentElement.style.setProperty("font-size", "200%"),
      );
      await about.click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
    await expect(page.locator("vite-error-overlay, nextjs-portal")).toHaveCount(
      0,
    );
  });
}
