import { expect, test, type Page } from "@playwright/test";
import { ME, SIGNED_OUT, mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";

/**
 * The feed moved from /home to /timeline (2026-11-17), and every address
 * sent before then keeps working for good: mail, Discord posts, push
 * notices, RSS readers, bookmarks and the installed app's old start URL.
 * The web API answers /home with a 301 (native-ssr.spec.ts drives that
 * server); this file drives the client router's fallback, which the
 * static fixture server reaches without a redirect. If either is dropped,
 * a test here or there fails. Invented players only.
 */

const where = (page: Page) => {
  const url = new URL(page.url());
  return url.pathname + url.search + url.hash;
};

test.describe("signed in", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(page, homeApi());
  });

  for (const [from, to] of [
    ["/home", "/timeline"],
    ["/home/", "/timeline"],
    // An unknown query and a fragment ride along untouched.
    ["/home?utm_source=email&ref=1", "/timeline?utm_source=email&ref=1"],
    ["/home#latest", "/timeline#latest"],
    ["/home/?ref=2#latest", "/timeline?ref=2#latest"],
  ] as const) {
    test(`${from} opens the Timeline at ${to}`, async ({ page }) => {
      await page.goto(from);
      await expect(
        page.getByRole("heading", { level: 1, name: "Timeline" }),
      ).toBeVisible();
      await expect.poll(() => where(page)).toBe(to);
      await expect(page).toHaveTitle("Timeline - Elixir");
    });
  }

  test("/home?bell and /home?search still open the bell and search, on the Timeline", async ({
    page,
  }) => {
    await page.goto("/home?bell");
    await expect(
      page.getByRole("dialog", { name: "Notifications" }),
    ).toBeVisible();
    await expect.poll(() => where(page)).toBe("/timeline");
    await page.goto("/home?search");
    await expect(page.getByRole("dialog", { name: /Search/ })).toBeVisible();
    await expect.poll(() => where(page)).toBe("/timeline");
  });

  // Every page under /home/ keeps its own address: none of them moved.
  for (const path of [
    "/home/find",
    "/home/you",
    "/home/passport",
    "/home/player/0YV8YGYJ",
  ])
    test(`${path} stays where it is`, async ({ page }) => {
      await page.goto(`${path}?ref=3#top`);
      await expect(page.locator("main")).not.toContainText("failed to render");
      await expect.poll(() => where(page)).toBe(`${path}?ref=3#top`);
    });
});

test.describe("signed out", () => {
  test("an old feed link asks for sign-in, then lands on the Timeline with its query", async ({
    page,
  }) => {
    const state = { authed: false };
    await mockApi(
      page,
      homeApi({
        "GET /api/me": () =>
          [200, state.authed ? ME : SIGNED_OUT] as [number, unknown],
        "POST /api/auth": [200, { ok: true, poll_id: "p".repeat(40) }],
        "POST /api/auth/code": () => {
          state.authed = true;
          return [200, { authenticated: true }] as [number, unknown];
        },
      }),
    );
    await page.goto("/home?ref=mail#latest");
    await expect.poll(() => where(page)).toBe("/timeline?ref=mail#latest");
    await expect(
      page.getByRole("heading", { name: "Sign in first" }),
    ).toBeVisible();
    await page
      .locator(".panel")
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await page.getByLabel("Email", { exact: true }).fill("fixture@example.com");
    await page.getByRole("button", { name: "Send sign-in email" }).click();
    await page.getByLabel("6-digit code").fill("123456");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Timeline" }),
    ).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).pathname + new URL(page.url()).search)
      .toBe("/timeline?ref=mail");
  });
});
