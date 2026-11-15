import { expect, test, type Page } from "@playwright/test";
import { mockApi, signedIn } from "./fixtures.ts";
import { homeApi, ownerPassport, HOME } from "./home-fixture.ts";
import {
  OWNER_ME,
  OWN_PASSPORT,
  THEIRS,
  THEIR_PASSPORT,
} from "./passport-fixture.ts";
import { PNG } from "./test-art.ts";

/**
 * A larger default font size (#1015 tidy): the browser's own setting moves
 * the root font size, not the zoom. Home's profile list, the passport
 * pages, the detail sheet and the Stamp marks size their text in rem, so
 * at twice the default (32px) their words are twice as large, and at the
 * smallest phone width nothing goes sideways or is cut off. At the
 * default they are the px they always were. Invented players only.
 */

const BIG = 32;

async function biggerText(page: Page) {
  // What the browser's font size setting does: the root's 1rem grows.
  await page.addInitScript((px) => {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.fontSize = `${px}px`;
    });
  }, BIG);
}

async function sideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

/** Elements under `selector` whose box cuts its own content off, or
 *  that reach past the window's edges. */
async function cutOff(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const out: string[] = [];
    const vw = window.innerWidth;
    for (const root of document.querySelectorAll(sel))
      for (const el of [root, ...root.querySelectorAll("*")]) {
        if (!(el instanceof HTMLElement) || !el.offsetParent) continue;
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < -1 || r.right > vw + 1)
          out.push(`${el.className || el.tagName}: past the edge`);
        // A visually hidden screen-reader label and a picture's round
        // crop of its card art clip by design; text never should.
        const clips = style.overflowX !== "visible" && !el.closest(".kit-av");
        if (clips && r.width > 2 && el.scrollWidth > el.clientWidth + 1)
          out.push(`${el.className || el.tagName}: clipped`);
      }
    return out;
  }, selector);
}

/** The passport head's count and the name beside it: whether their boxes
 *  overlap, and whether the count sits on the name's line. */
const head = (page: Page) =>
  page.evaluate(() => {
    const a = document
      .querySelector(".kit-passport__who-main")!
      .getBoundingClientRect();
    const b = document
      .querySelector(".kit-passport__count")!
      .getBoundingClientRect();
    const overlap =
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom;
    return { overlap, sameLine: b.top < a.bottom && b.bottom > a.top };
  });

/** Fonts loaded and every animation finished: the earned mark's entry
 *  (`kit-stamp-in`) scales it to 112% for 220ms, which a measurement in
 *  that window reads as reaching past the edge. */
const settled = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().map((a) => a.finished));
  });

const px = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

const profileHome = homeApi({
  "GET /api/me/home": [
    200,
    {
      first: {
        ...HOME.first,
        setup: { following: 1, digest: null },
        starter_hidden_until: null,
      },
    },
  ],
  "GET /api/me/passport": [
    200,
    ownerPassport(["done", "todo", "todo", "todo", "todo", "todo"]),
  ],
  "POST /api/me/passport/reconcile": [
    200,
    {
      ...ownerPassport(["done", "todo", "todo", "todo", "todo", "todo"]),
      granted: [],
      more: false,
    },
  ],
});

async function openPassport(page: Page, path: string) {
  await page.route("**/assets/cards/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  await mockApi(
    page,
    signedIn({
      "GET /api/me": [200, OWNER_ME],
      "GET /api/me/passport": [200, OWN_PASSPORT],
      [`GET /api/passports/${THEIRS}`]: [200, THEIR_PASSPORT],
      "GET /api/me/clans": [
        200,
        { clans: [], home_clan: { clan_tag: "#0JQ0JQ8", name: "Grove" } },
      ],
      "POST /api/me/passport/reconcile": [
        200,
        { ...OWN_PASSPORT, granted: [], more: false },
      ],
    }),
  );
  await page.goto(path);
}

test("at the default size the profile list and passport keep their px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, profileHome);
  await page.goto("/home");
  await expect(page.locator(".kit-profile__next h3")).toBeVisible();
  expect(await px(page, ".kit-profile__next h3")).toBe(16);
  expect(await px(page, ".kit-profile__lede")).toBe(14);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await openPassport(page, "/home/passport");
  await expect(page.locator(".kit-stamp-tile").first()).toBeVisible();
  expect(await px(page, ".kit-stamp-tile__label")).toBe(12);
  expect(await px(page, ".kit-stamp__name")).toBe(12);
  expect(await px(page, ".kit-passport__group h2")).toBe(20);
  // The count stays beside the name, as it always was.
  expect(await head(page)).toEqual({ overlap: false, sameLine: true });
});

test("twice the default font size, 320px: Home's profile list grows and nothing is cut off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await biggerText(page);
  await mockApi(page, profileHome);
  await page.goto("/home");
  const list = page.locator(".kit-profile");
  await expect(list.locator(".kit-profile__next h3")).toBeVisible();
  await list.getByText("See all steps").click();
  await expect(list.locator(".kit-profile__row h3")).toHaveCount(6);
  await settled(page);
  expect(await px(page, ".kit-profile__next h3")).toBe(BIG);
  expect(await px(page, ".kit-profile__lede")).toBe(BIG * 0.875);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(await cutOff(page, ".kit-profile")).toEqual([]);
});

for (const [label, path] of [
  ["yours", "/home/passport"],
  ["another member's", `/home/passport/${THEIRS}`],
] as const)
  test(`twice the default font size, 320px: ${label} passport grows and nothing is cut off`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await biggerText(page);
    await openPassport(page, path);
    await expect(page.locator(".kit-stamp-tile")).toHaveCount(11);
    await settled(page);
    expect(await px(page, ".kit-stamp-tile__label")).toBe(BIG * 0.75);
    expect(await px(page, ".kit-passport__group h2")).toBe(BIG * 1.25);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(await cutOff(page, ".kit-passport")).toEqual([]);
    // The count goes under the name rather than over its gold mark.
    expect((await head(page)).overlap).toBe(false);
  });

test("twice the default font size, 320px: a Stamp's detail sheet grows and nothing is cut off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await biggerText(page);
  await openPassport(page, "/home/passport?stamp=cheerleader");
  const sheet = page.locator("dialog .kit-passport-sheet");
  await expect(sheet).toBeVisible();
  await settled(page);
  expect(await px(page, "dialog .kit-passport-sheet__note")).toBe(BIG * 0.875);
  expect(await px(page, "dialog .kit-stamp--l .kit-stamp__name")).toBe(
    BIG * 1.25,
  );
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(await cutOff(page, "dialog .kit-passport-sheet")).toEqual([]);
});
