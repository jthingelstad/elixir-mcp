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
 * The bell as an inbox (#1009): a dropdown under the bar's bell, beside the
 * avatar, at every width (2026-11-17): a box under the bell on a wide
 * screen, the screen's width less a margin on a phone; Needs you, then New and
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

/** The bar with the bell closed, for the screenshots. */
async function captureClosed(page: Page, name: string, width: number) {
  if (!shots) return;
  await page.screenshot({ path: `${shots}/bell-closed-${name}-${width}.png` });
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
  // In the bar beside the avatar at every width; never a phone tab.
  const trigger = (page: Page) =>
    page.locator(".kit-top").getByRole("button", { name: /^Notifications/ });

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
      // The badge carries the number, the name says it in words.
      await expect(button.locator(".kit-bell__dot--count")).toHaveText("6");
      await expect(button).toHaveAccessibleName(
        "Notifications, 2 need you, 4 new",
      );
      // Next to the avatar, at the bar's right; no tab of its own.
      const avatar = page.locator(".kit-top__avatar");
      const [bb, ab] = [
        (await button.boundingBox())!,
        (await avatar.boundingBox())!,
      ];
      expect(bb.x + bb.width).toBeLessThanOrEqual(ab.x + 1);
      expect(ab.x - (bb.x + bb.width)).toBeLessThan(24);
      expect(bb.width).toBeGreaterThanOrEqual(44);
      expect(bb.height).toBeGreaterThanOrEqual(44);
      await expect(page.locator(".kit-bottom .kit-bell")).toHaveCount(0);
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await captureClosed(page, "unread", width);
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
      // In place: the address stays, the bell says it is open.
      await expect(page).toHaveURL(/\/timeline$/);
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(button).toHaveAttribute("aria-controls", "bell-sheet");
      // Where it sits: under the bar's bell at every width; on a phone the
      // screen's width less an 8px margin, ending above the tabs.
      await settled(page);
      const box = (await sheet.boundingBox())!;
      const b = (await button.boundingBox())!;
      expect(box.y).toBeGreaterThan(b.y + b.height);
      if (phone) {
        expect(Math.round(box.x)).toBe(8);
        expect(Math.round(box.width)).toBe(width - 16);
        const tabs = (await page.locator(".kit-bottom").boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(tabs.y);
      } else {
        expect(box.width).toBeLessThanOrEqual(400);
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
      await expect(button).toHaveAttribute("aria-expanded", "false");
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
      await expect(page).toHaveURL(/\/timeline$/);
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

    test("a claimed follower is named, not verified, with Follow back; only no-player accounts are counted", async ({
      page,
    }) => {
      // Jamie, 2026-11-14: the bell names followers as the followers list
      // does. Invented players only.
      const read = {
        ...MIXED_BELL,
        followers: {
          count: 4,
          new: 2,
          no_player: 2,
          unnamed: 2,
          players: [
            ...MIXED_BELL.followers.players,
            {
              tag: "#0Q2L8",
              name: "Invented Claimer",
              verified: false,
              followed_tag: "#0YV8YGYJ",
              followed_name: "Invented Owl",
              new: true,
              can_follow_back: true,
            },
          ],
        },
      };
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, BELL_ME],
          "GET /api/me/bell": [200, read],
        }),
      );
      await page.goto("/home");
      await trigger(page).click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      const fresh = sheet.getByRole("region", { name: "New" });
      const row = fresh
        .locator(".kit-bell__item")
        .filter({ hasText: "Invented Claimer follows you" });
      await expect(row).toContainText("Not verified");
      await expect(row.locator(".kit-verified")).toHaveCount(0);
      await expect(
        row.getByRole("button", { name: "Follow back" }),
      ).toBeVisible();
      await expect(
        sheet.getByRole("region", { name: "Earlier" }),
      ).toContainText("2 more followers with no player added yet");
      await noSideways(page);
      await accessible(page, `the bell, a claimed follower, at ${width}`);
      await capture(page, "claimed", width);
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
      await captureClosed(page, "empty", width);
      // Opening it moves nothing on the page: the bar and the feed stay put.
      const still = () =>
        page.evaluate(() =>
          [".kit-top__avatar", ".kit-top button.kit-bell", "main"].map((q) => {
            const r = document.querySelector(q)!.getBoundingClientRect();
            return [r.x, r.y, r.width];
          }),
        );
      const before = await still();
      await trigger(page).click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      await expect(sheet).toContainText("All quiet");
      expect(await still()).toEqual(before);
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

    test("a failed refresh keeps the rows the badge read, says so, and Try again recovers", async ({
      page,
    }) => {
      // The badge reads the bell on load; the sheet's fresh read fails
      // (and its one quiet retry) until Try again.
      let reads = 0;
      let up = false;
      const seen: string[] = [];
      await mockApi(
        page,
        homeApi({
          "GET /api/me": [200, BELL_ME],
          "GET /api/me/bell": () =>
            ++reads === 1 || up
              ? [200, MIXED_BELL]
              : [503, { error: "unavailable" }],
          "PUT /api/me/bell/seen": () => {
            seen.push("put");
            return [200, { seen_at: new Date().toISOString() }];
          },
        }),
      );
      await page.goto("/home");
      const button = trigger(page);
      await expect(button.locator(".kit-bell__dot--count")).toHaveText("6");
      await button.click();
      const sheet = page.getByRole("dialog", { name: "Notifications" });
      const notice = sheet.getByRole("status");
      await expect(notice).toHaveText(
        /Couldn’t refresh just now, so this may be out of date\./,
        { timeout: 10_000 },
      );
      await expect(
        sheet.getByRole("region", { name: "New" }).getByRole("link"),
      ).toHaveCount(4);
      expect(seen).toEqual([]);
      await noSideways(page);
      await accessible(page, `the stale bell at ${width}`);
      await capture(page, "stale", width);
      up = true;
      await notice.getByRole("button", { name: "Try again" }).click();
      await expect(notice).toHaveCount(0);
      await expect.poll(() => seen.length).toBe(1);
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
      // On a phone the page behind holds still while the list scrolls.
      if (phone) {
        const before = await page.evaluate(() => window.scrollY);
        await page.mouse.move(width / 2, 830);
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(150);
        expect(await page.evaluate(() => window.scrollY)).toBe(before);
        expect(
          await page.evaluate(
            () => getComputedStyle(document.documentElement).overflowY,
          ),
        ).toBe("hidden");
      }
      await noSideways(page);
      await accessible(page, `the long bell at ${width}`);
      await capture(page, "long", width);
    });
  });
}

for (const width of [390, 1280])
  test(`${width}px: a tap outside the dropdown closes it and gives focus back`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
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
    // Under the phone's dropdown, above its tabs; beside the wide one.
    await page.mouse.click(40, width < 760 ? 844 - 61 - 3 : 600);
    await expect(sheet).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");
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
    .locator(".kit-top")
    .getByRole("button", { name: /^Notifications/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "Notifications" });
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe(
    "none",
  );
});
