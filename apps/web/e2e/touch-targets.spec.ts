import { expect, test, type Page } from "@playwright/test";
import { mockApi, SIGNED_OUT } from "./fixtures.ts";
import { HOME, homeApi } from "./home-fixture.ts";
import { BATTLE } from "./battle-fixture.ts";
import * as clan from "./clan/fixtures.ts";

/**
 * On a phone, every control takes a tap 44px across (design pass three,
 * 2026-11-13): the shell's top bar and footer, and every standalone link
 * and button on the pages below. Each is hit-tested 20px out from its
 * centre, up and down, and left and right when it is drawn narrower than
 * 44px; a tap there must land on it. A link inside a running sentence is
 * exempt (WCAG 2.5.8's inline exception), and nothing scrolls sideways.
 * Invented players only.
 */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

/** The page as it will stay: fonts in, no panel still loading, and the
 *  viewport as tall as the page (every control on screen at once). A read
 *  that lands after the first measure makes the page taller, and a tap 20px
 *  below the last footer row would fall outside the viewport. */
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
  const frame = () =>
    page.evaluate(
      () =>
        new Promise<number>((done) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              done(document.documentElement.scrollHeight),
            ),
          ),
        ),
    );
  let height = await frame();
  for (let i = 0; i < 10; i++) {
    await page.setViewportSize({ width: 390, height: Math.min(height, 12000) });
    const now = await frame();
    if (now === height) return;
    height = now;
  }
  throw new Error("the page kept changing height");
}

async function misses(page: Page) {
  await settle(page);
  return page.evaluate(() => {
    const sel =
      "a[href], button, input:not([type=hidden]), select, textarea, [role=tab], [role=switch], summary, label:has(input)";
    const on = (hit: Element, x: number, y: number) => {
      const t = document.elementFromPoint(x, y);
      return !!t && (hit.contains(t) || t.closest("label") === hit);
    };
    // In a sentence: its parent also holds words of its own.
    const inText = (el: Element) =>
      [...(el.parentElement?.childNodes ?? [])].some(
        (n) => n.nodeType === Node.TEXT_NODE && /\w/.test(n.textContent ?? ""),
      );
    const out: string[] = [];
    const seen = new Set<Element>();
    for (const el of document.querySelectorAll(sel)) {
      const hit = el.closest("label") ?? el;
      if (seen.has(hit)) continue;
      seen.add(hit);
      if (hit.closest(".sr-only, [hidden], [inert]")) continue;
      if (inText(hit)) continue;
      const box = [...hit.getClientRects()].find((r) => r.width && r.height);
      if (!box) continue;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      // Scrolled out of a tab row, or under something: not this test's.
      if (x < 0 || x > innerWidth || !on(hit, x, y)) continue;
      const points: [number, number][] = [
        [x, y - 20],
        [x, y + 20],
      ];
      if (box.width < 44) points.push([x - 20, y], [x + 20, y]);
      if (points.every(([px, py]) => on(hit, px, py))) continue;
      const name = (hit.getAttribute("aria-label") || hit.textContent || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 40);
      out.push(`${hit.tagName.toLowerCase()} "${name}"`);
    }
    if (document.documentElement.scrollWidth > innerWidth)
      out.push("the page scrolls sideways");
    return out;
  });
}

test("Home: the top bar, the feed, the panels and the footer", async ({
  page,
}) => {
  await mockApi(page, homeApi());
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  expect(await misses(page)).toEqual([]);
});

test("Home with its suggested follows: the ticks, Follow these and Not now", async ({
  page,
}) => {
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": [
        200,
        {
          first: {
            ...HOME.first,
            welcome: { following: 0, digest: null, finished_at: null },
            starter_hidden_until: null,
          },
        },
      ],
      "GET /api/me/people/starter": [
        200,
        {
          ok: true,
          offer: true,
          used: 1,
          limit: 50,
          people: ["#0YP8U0Y0", "#080J2V9Q", "#02G2PJC0"].map((tag, i) => ({
            tag,
            name: `Invented ${i + 1}`,
            why: [{ kind: "clan", clan_name: "Grove" }],
            free: false,
          })),
        },
      ],
    }),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-starter__row")).toHaveCount(3);
  expect(await misses(page)).toEqual([]);
});

test("Find's Suggested: each row's Follow and Show more", async ({ page }) => {
  await mockApi(
    page,
    homeApi({
      "GET /api/me/people/find": [
        200,
        {
          ok: true,
          days: 30,
          more: 0,
          used: 1,
          limit: 50,
          people: [
            "#0YP8U0Y0",
            "#080J2V9Q",
            "#02G2PJC0",
            "#08VP8VYY",
            "#0J9YCYL2",
            "#09VURCVC",
            "#0VJLCPJ0",
            "#00JRG2RU",
            "#0LJR0G22",
            "#0U082URG",
            "#00092VJ2",
          ].map((tag, i) => ({
            tag,
            name: `Invented ${i + 1}`,
            why: [{ kind: "clan", clan_name: "Grove" }],
            free: false,
          })),
        },
      ],
    }),
  );
  await page.goto("/home/find");
  await expect(page.locator(".kit-findsuggest .kit-people__row")).toHaveCount(
    10,
  );
  expect(await misses(page)).toEqual([]);
});

for (const tab of ["feed", "members", "war", "standings"]) {
  test(`Clan's ${tab}`, async ({ page }) => {
    await clan.mockApi(page, clan.signedIn());
    await page.goto(`/clan/0QC8RCGY/${tab}`);
    await expect(page.locator(".clan-head")).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await misses(page)).toEqual([]);
  });
}

test("a battle's page: names, the decks' cards and Side by side", async ({
  page,
}) => {
  await mockApi(
    page,
    homeApi({
      [`GET /api/public/battles/${BATTLE.battle.short_id}`]: [200, BATTLE],
    }),
  );
  await page.goto(`/battle/${BATTLE.battle.short_id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await misses(page)).toEqual([]);
});

test("signed out: the front page and signing in", async ({ page }) => {
  await mockApi(page, { "GET /api/me": [200, SIGNED_OUT] });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(await misses(page)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/signin?signup");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await misses(page)).toEqual([]);
});
