import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { homeApi } from "./home-fixture.ts";
import {
  BELL_ME,
  EMPTY_BELL,
  LONG_BELL,
  MIXED_BELL,
  NO_NEEDS,
} from "./bell-fixture.ts";

/**
 * The bell as an inbox (#1009): a popover under the bar's bell on a wide
 * screen, a sheet from the foot on a phone; Needs you, then New and
 * Earlier, every row one target of 44px or more; Escape and a tap outside
 * close it and give focus back to the bell; the arrows walk the rows; back
 * from a row it opens as you left it. Every state at 320, 390 and 1280,
 * with axe and nothing scrolling sideways. Invented players only.
 *
 * BELL_SHOTS=<dir> also saves a capture of each state.
 */
const shots = process.env.BELL_SHOTS;

async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

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

/** Past the sheet's entrance: its box is only final once the slide ends. */
async function settled(page: Page) {
  await page
    .locator("dialog.kit-bell__sheet")
    .evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished)).then(() => {}),
    );
}

async function capture(page: Page, name: string, width: number) {
  if (!shots) return;
  await settled(page);
  await page.screenshot({ path: `${shots}/bell-${name}-${width}.png` });
}

const PAGE = {
  player: {
    tag: "#00J8VCYU",
    name: "Invented Fan",
    clan_tag: null,
    clan_name: null,
    trophies: 7100,
    recorded: true,
  },
  you: { own: false, following: false, relationship: null, clanmate: null },
  badges: { verified_player: true, discord: false },
  follows: { count: 0, players: [] },
  followers: { count: 0, players: [], unnamed: 0 },
  window_days: 30,
  timeline: [],
  timeline_more: 0,
  moments: [],
  highlights: [],
};

/** The bell's read before and after the marker moves: once opened, the
 *  read says nothing is new but the unread answer. */
function bellRead() {
  let opened = false;
  const after = {
    ...MIXED_BELL,
    new: 1,
    reactions: {
      ...MIXED_BELL.reactions,
      new: 0,
      items: MIXED_BELL.reactions.items.map((r) => ({ ...r, new: false })),
    },
    followers: {
      ...MIXED_BELL.followers,
      new: 0,
      players: MIXED_BELL.followers.players.map((p) => ({ ...p, new: false })),
    },
    account: {
      new: 0,
      items: MIXED_BELL.account.items.map((a) => ({ ...a, new: false })),
    },
  };
  return {
    read: () => [200, opened ? after : MIXED_BELL] as [number, unknown],
    seen: () => {
      opened = true;
      return [200, { seen_at: new Date().toISOString() }] as [number, unknown];
    },
  };
}

for (const width of [320, 390, 1280]) {
  const phone = width <= 760;
  const trigger = (page: Page) =>
    phone
      ? page
          .getByRole("navigation", { name: "Main, phone" })
          .getByRole("button", { name: /Bell/ })
      : page
          .locator(".kit-top")
          .getByRole("button", { name: /^Notifications/ });

  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
    });

    test("mixed: Needs you, New, Earlier; rows are the targets; Escape gives focus back", async ({
      page,
    }) => {
      const bell = bellRead();
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, BELL_ME],
          "GET /api/me/bell": bell.read,
          "PUT /api/me/bell/seen": bell.seen,
        }),
      );
      await page.goto("/home");
      const button = trigger(page);
      // The badge carries the number on the bar and the phone's tab alike.
      await expect(button.locator(".kit-bell__dot--count")).toHaveText("6");
      if (!phone)
        await expect(button).toHaveAccessibleName(
          "Notifications, 2 need you, 4 new",
        );
      await button.click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      await expect(sheet).toBeVisible();
      const regions = sheet.getByRole("region");
      await expect(regions).toHaveCount(3);
      await expect(sheet.locator("h3")).toHaveText([
        "Needs you",
        "New",
        "Earlier",
      ]);
      const fresh = sheet.getByRole("region", { name: "New" });
      await expect(fresh.getByRole("link")).toHaveCount(4);
      await expect(fresh).toContainText("Invented Fan follows you");
      await expect(fresh).toContainText("New Stamp: Cheerleader II");
      await expect(
        fresh.getByRole("button", { name: "Follow back" }),
      ).toBeVisible();
      await expect(
        sheet.getByRole("region", { name: "Earlier" }),
      ).toContainText("Recording started for 24 players");
      // No separate Open buttons; every row's target is 44px or more.
      await expect(sheet.getByRole("link", { name: "Open" })).toHaveCount(0);
      const heights = await sheet
        .locator("a.kit-bell__hit")
        .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
      // Where it sits: a sheet on the foot of a phone, a popover under the
      // bar's bell on a wide screen.
      await settled(page);
      const box = (await sheet.boundingBox())!;
      if (phone) {
        expect(Math.round(box.x)).toBe(0);
        expect(Math.round(box.width)).toBe(width);
        expect(Math.round(box.y + box.height)).toBe(844);
      } else {
        const b = (await button.boundingBox())!;
        expect(box.width).toBeLessThanOrEqual(400);
        expect(box.y).toBeGreaterThan(b.y + b.height);
        expect(box.height).toBeLessThan(844 - box.y);
        expect(Math.abs(box.x + box.width - (b.x + b.width))).toBeLessThan(16);
      }
      await noSideways(page);
      await accessible(page, `the bell at ${width}`);
      await capture(page, "mixed", width);

      // The title has focus; the arrows walk the rows.
      await expect(page.locator("#bell-title")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(sheet.locator("[data-bell-row]").first()).toBeFocused();
      await page.keyboard.press("End");
      await expect(sheet.locator("[data-bell-row]").last()).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      // Focus goes back to the bell, never the page's body.
      await expect(button).toBeFocused();
    });

    test("back from a row: opens where you left it, the row you opened no longer new", async ({
      page,
    }) => {
      const bell = bellRead();
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, BELL_ME],
          "GET /api/me/bell": bell.read,
          "PUT /api/me/bell/seen": bell.seen,
          "GET /api/player": [200, PAGE],
        }),
      );
      await page.goto("/home");
      await trigger(page).click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      const fresh = sheet.getByRole("region", { name: "New" });
      await expect(fresh.getByRole("link")).toHaveCount(4);
      await fresh
        .getByRole("link", { name: /Invented Fan follows you/ })
        .click();
      await expect(page).toHaveURL(/\/home\/player\/00J8VCYU$/);
      await expect(sheet).toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(/\/home$/);
      await trigger(page).click();
      // The marker moved when it first opened, so the read says only the
      // answer is new; the other two you left are kept as New.
      await expect(fresh.getByRole("link")).toHaveCount(3);
      await expect(fresh).not.toContainText("Invented Fan");
      await expect(
        sheet.getByRole("region", { name: "Earlier" }),
      ).toContainText("Invented Fan follows you");
      // Closed by you, it starts fresh: only the unread answer is New.
      await sheet.getByRole("button", { name: "Close" }).click();
      await expect(trigger(page)).toBeFocused();
      await trigger(page).click();
      await expect(fresh.getByRole("link")).toHaveCount(1);
      await expect(fresh).toContainText("Elixir answered your feedback");
    });

    test("empty: all quiet", async ({ page }) => {
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, BELL_ME],
          "GET /api/me/home/needs": [200, NO_NEEDS],
          "GET /api/me/bell": [200, EMPTY_BELL],
        }),
      );
      await page.goto("/home");
      await expect(trigger(page).locator(".kit-bell__dot")).toHaveCount(0);
      await trigger(page).click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      await expect(sheet).toContainText("All quiet");
      await expect(sheet.getByRole("region")).toHaveCount(0);
      await accessible(page, `the empty bell at ${width}`);
      await capture(page, "empty", width);
    });

    test("loading, then failed with Try again", async ({ page }) => {
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, BELL_ME],
          "GET /api/me/home/needs": [200, NO_NEEDS],
        }),
      );
      // The bell's read is held, then refused (and its one quiet retry).
      let release: () => void = () => {};
      const held = new Promise<void>((r) => (release = r));
      await page.route("**/api/me/bell", async (route) => {
        await held;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "unavailable" }),
        });
      });
      await page.goto("/home");
      await trigger(page).click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      await expect(sheet.locator('[aria-busy="true"]')).toBeVisible();
      await accessible(page, `the loading bell at ${width}`);
      await capture(page, "loading", width);
      release();
      await expect(sheet).toContainText(
        "Your notifications could not be read just now",
        { timeout: 10_000 },
      );
      await expect(sheet.locator('[aria-busy="true"]')).toHaveCount(0);
      await expect(
        sheet.getByRole("button", { name: "Try again" }),
      ).toBeVisible();
      await accessible(page, `the failed bell at ${width}`);
      await capture(page, "failed", width);
    });

    test("long: the sheet scrolls, the page does not", async ({ page }) => {
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, BELL_ME],
          "GET /api/me/bell": [200, LONG_BELL],
        }),
      );
      await page.goto("/home");
      await trigger(page).click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      await expect(
        sheet.getByRole("region", { name: "Earlier" }),
      ).toBeVisible();
      const scroll = sheet.locator(".kit-bell__scroll");
      const [inner, outer] = await scroll.evaluate((el) => [
        el.scrollHeight,
        el.clientHeight,
      ]);
      expect(inner).toBeGreaterThan(outer);
      await settled(page);
      const box = (await sheet.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      await noSideways(page);
      await accessible(page, `the long bell at ${width}`);
      await capture(page, "long", width);
    });
  });
}

test("a tap outside the popover closes it and gives focus back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await mockApi(
    page,
    homeApi({
      "GET /api/me": [200, BELL_ME],
      "GET /api/me/bell": [200, MIXED_BELL],
    }),
  );
  await page.goto("/home");
  const button = page
    .locator(".kit-top")
    .getByRole("button", { name: /^Notifications/ });
  await button.click();
  const sheet = page.getByRole("dialog", { name: "Notifications" });
  await expect(sheet).toBeVisible();
  await page.mouse.click(40, 600);
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("reduced motion: the sheet appears without moving", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApi(
    page,
    homeApi({
      "GET /api/me": [200, BELL_ME],
      "GET /api/me/bell": [200, MIXED_BELL],
    }),
  );
  await page.goto("/home");
  await page
    .getByRole("navigation", { name: "Main, phone" })
    .getByRole("button", { name: /Bell/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "Notifications" });
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe(
    "none",
  );
});
