import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, mockApi, signedIn } from "./clan/fixtures.ts";

// A configured UI is exercised entirely against the existing route fixtures.
// Merely opening editors must not change the clan's settings or send messages.
for (const width of [390, 820, 1280]) {
  test(`settings drawers preserve keyboard focus and model shortcuts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (req.method() !== "GET" && !req.url().endsWith("/api/clan/select"))
        writes.push(req.url());
    });
    await mockApi(
      page,
      signedIn({
        "GET /api/clan/me": [200, { ...ME, selected: ME.clans[0] }],
        "GET /api/clan/clans/2PQRJ8LV/social": [200, { enabled: true }],
        "GET /api/clan/clans/2PQRJ8LV/discord": [200, { set: false }],
        "GET /api/clan/clans/2PQRJ8LV/model": [
          200,
          {
            set: false,
            uses: { today: 0, recent: [] },
            per_day: 20,
            keep_days: 90,
          },
        ],
        "GET /api/clan/clans/2PQRJ8LV/sharing": [200, { types: {} }],
      }),
    );
    await page.goto("/clan/2PQRJ8LV/manage/settings#settings-model");
    const model = page.getByRole("dialog", { name: "Clan model", exact: true });
    await expect(model).toBeVisible();
    await expect(model.getByLabel("Add the clan's key")).toHaveAttribute(
      "type",
      "password",
    );
    await page.keyboard.press("Escape");
    await expect(model).toHaveCount(0);
    const trigger = page.getByRole("button", {
      name: "Manage Member map",
      exact: true,
    });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Member map", exact: true });
    await expect(
      sheet.getByRole("button", { name: "Turn social features off" }),
    ).toBeEnabled();
    await expect(
      sheet.getByRole("button", { name: "Close", exact: true }),
    ).toBeFocused();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(trigger).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `/tmp/elixir-settings-cleanup-${width}.png`,
      fullPage: false,
    });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
