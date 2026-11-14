import { test, expect } from "@playwright/test";
import { mockApi, SIGNED_OUT } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

// Entry -> create an account -> sign-in form stays readable and operable,
// with the real game/interface fonts or when every font request fails.
for (const width of [320, 390, 1280]) {
  for (const fonts of ["loaded", "blocked"]) {
    test(`game titles and readable controls at ${width}px with fonts ${fonts}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await mockApi(page, homeApi({ "GET /api/me": [200, SIGNED_OUT] }));
      if (fonts === "blocked")
        await page.route("**/assets/fonts/**", (route) => route.abort());
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      const type = await page.locator("h1").evaluate((el) => ({
        family: getComputedStyle(el).fontFamily,
        weight: getComputedStyle(el).fontWeight,
        body: getComputedStyle(document.body).fontFamily,
      }));
      expect(type.family).toContain("Clash Royale");
      expect(type.weight).toBe("400");
      expect(type.body.split(",")[0]).toBe("Rubik");
      if (fonts === "loaded") {
        const loaded = await page.evaluate(() =>
          Array.from(document.fonts)
            .filter((f) => f.status === "loaded")
            .map((f) => f.family.replaceAll('"', "")),
        );
        expect(loaded).toContain("Clash Royale");
        expect(loaded).toContain("Rubik");
      }
      await page
        .getByRole("link", { name: "Create an account", exact: true })
        .click();
      await expect(page).toHaveURL(/\/signin\?signup$/);
      await expect(page.locator('input[type="email"]')).toBeVisible();
      await expect(page.locator("h1")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      expect(
        await page
          .locator('input[type="email"]')
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(16);
      expect(errors).toEqual([]);
    });
  }
}
