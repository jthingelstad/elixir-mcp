import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ME, SIGNED_OUT, mockApi, signedIn } from "./fixtures.ts";

for (const width of [390, 1280]) {
  for (const news of [false, true]) {
    test(`new signup news ${news} survives retry, reload and resend at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      let authed = false;
      let fail = true;
      const sends: unknown[] = [];
      await mockApi(
        page,
        signedIn({
          "GET /api/me": () => [
            200,
            authed
              ? { ...ME, role: "member", claims: [], recordings: [] }
              : SIGNED_OUT,
          ],
          "POST /api/auth": (route) => {
            sends.push(route.request().postDataJSON());
            return fail
              ? [503, { message: "Mail request interrupted." }]
              : [200, { ok: true }];
          },
          "POST /api/auth/code": () => {
            authed = true;
            return [200, { authenticated: true }];
          },
        }),
      );
      await page.goto(
        "/console/signin?signup&return_to=/console/account/tracking",
      );
      const choice = page.getByRole("checkbox", {
        name: "Send me Elixir product news",
      });
      await expect(choice).toBeChecked();
      await choice.focus();
      if (!news) await page.keyboard.press("Space");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const signupA11y = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        signupA11y.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
      await page
        .getByLabel("Email", { exact: true })
        .fill("fixture@example.com");
      await page.getByRole("button", { name: "Send sign-in email" }).click();
      await expect(page.getByRole("alert")).toContainText(
        "Mail request interrupted.",
      );
      await page.reload();
      expect(await choice.isChecked()).toBe(news);
      fail = false;
      await page
        .getByLabel("Email", { exact: true })
        .fill("fixture@example.com");
      await page.getByRole("button", { name: "Send sign-in email" }).click();
      await expect(page.getByLabel("6-digit code")).toBeVisible();
      await page.getByRole("button", { name: "Send another email" }).click();
      await expect.poll(() => sends.length).toBe(3);
      expect(sends).toEqual(
        Array(3).fill({
          email: "fixture@example.com",
          newsletter_opt_in: news,
        }),
      );
      await page.getByLabel("6-digit code").fill("123456");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/console\/account\/tracking$/);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      const a11y = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        a11y.violations.filter((v) =>
          ["serious", "critical"].includes(v.impact ?? ""),
        ),
      ).toEqual([]);
    });
  }
}
