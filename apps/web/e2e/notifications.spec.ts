import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi, signedIn } from "./fixtures.ts";

/** Web push (2026-11-16): Settings › Notifications on a phone, with the
 *  account's devices and a switch per kind; an iPhone in Safari is told to
 *  add Elixir to the Home Screen; the bell's one quiet prompt, put away
 *  with Not now. Nothing asks the browser's permission on load. Invented
 *  devices only.
 *
 *  PUSH_SHOTS=<dir> also saves a capture of each state. */
const shots = process.env.PUSH_SHOTS;

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

const PUSH = {
  offered: true,
  public_key:
    "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  devices: [
    {
      id: "7",
      label: "Safari on iPhone",
      created_at: "2026-11-15T12:00:00Z",
      last_success_at: "2026-11-16T01:00:00Z",
    },
    {
      id: "8",
      label: "Chrome on Mac",
      created_at: "2026-11-16T12:00:00Z",
      last_success_at: null,
    },
  ],
  kinds: {
    cheers: true,
    followers: true,
    clan_actions: false,
    answers: true,
    close_friends: true,
  },
};

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

async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

/** A browser not yet asked, counting its permission asks: none may come
 *  without a tap. */
async function countAsks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __asks: number };
    w.__asks = 0;
    if ("Notification" in window) {
      // Headless Chromium says "denied"; a person's browser starts at
      // "default", not yet asked.
      Object.defineProperty(Notification, "permission", {
        get: () => "default",
      });
      Notification.requestPermission = async () => {
        w.__asks++;
        return "default";
      };
    }
  });
}
const asks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __asks: number }).__asks);

test.describe("390px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("Settings › Notifications: this device, what comes, your devices", async ({
    page,
  }) => {
    await countAsks(page);
    await mockApi(page, signedIn({ "GET /api/me/push": [200, PUSH] }));
    await page.goto("/settings/notifications");
    await expect(
      page.getByRole("heading", { name: "Notification settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Turn on notifications" }),
    ).toBeVisible();
    await expect(
      page.getByRole("switch", { name: "Clan Actions waiting for you" }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(
      page.getByRole("switch", { name: "Close friends' play" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("button", { name: "Remove Chrome on Mac" }),
    ).toBeVisible();
    expect(await asks(page)).toBe(0);
    await noSideways(page);
    await accessible(page, "notifications");
    if (shots)
      await page.screenshot({
        path: `${shots}/settings-notifications-390.png`,
        fullPage: true,
      });
  });

  test("the bell's prompt: one quiet line, Not now puts it away", async ({
    page,
  }) => {
    await countAsks(page);
    await mockApi(page, signedIn({ "GET /api/me/push": [200, PUSH] }));
    await page.goto("/home");
    await page
      .locator(".kit-top")
      .getByRole("button", { name: /^Notifications/ })
      .click();
    const line = page.getByText("Get notified when people cheer your play.");
    await expect(line).toBeVisible();
    await expect(page.getByRole("link", { name: "Turn on" })).toHaveAttribute(
      "href",
      "/settings/notifications",
    );
    expect(await asks(page)).toBe(0);
    await noSideways(page);
    await accessible(page, "bell prompt");
    if (shots) await page.screenshot({ path: `${shots}/bell-prompt-390.png` });
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(line).toHaveCount(0);
  });
});

test.describe("iPhone in Safari", () => {
  test.use({ userAgent: IPHONE, hasTouch: true, isMobile: true });

  test("is told to add Elixir to the Home Screen, with no button that cannot work", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockApi(page, signedIn({ "GET /api/me/push": [200, PUSH] }));
    await page.goto("/settings/notifications");
    await expect(page.getByText(/Add to Home Screen/).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Turn on notifications" }),
    ).toHaveCount(0);
    await noSideways(page);
    await accessible(page, "ios install");
    if (shots)
      await page.screenshot({
        path: `${shots}/ios-not-installed-390.png`,
        fullPage: true,
      });
  });
});
