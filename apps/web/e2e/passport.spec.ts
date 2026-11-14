import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mockApi, signedIn } from "./fixtures.ts";
import {
  ADA_WITH_PASSPORT,
  ART,
  BROKEN_ART,
  LAPSED_PASSPORT,
  MINE,
  NEW_PASSPORT,
  OWNER_ME,
  OWN_PASSPORT,
  THEIRS,
  THEIR_PASSPORT,
} from "./passport-fixture.ts";
import { PNG } from "./test-art.ts";

/**
 * Passports (#1015) in the built app, from fixtures: the owner's with
 * progress and where to earn; another member's with dates and rules and
 * nothing private; an unverified claim, a lapsed proof and an account with
 * no player; loading and a failed read; the detail sheet by keyboard;
 * ?stamp=; phone and desktop widths, 200% text, blocked fonts, failed card
 * art, reduced motion, 44px targets and axe. Invented players only.
 */

type Routes = Parameters<typeof signedIn>[0];

async function open(
  page: Page,
  path: string,
  routes: Routes = {},
  // Routes that must win over the fixtures: Playwright asks the last
  // registered first.
  after: (page: Page) => Promise<unknown> = async () => {},
) {
  await page.route("**/assets/cards/**", (route) =>
    route.request().url().includes(`/${BROKEN_ART}.png`)
      ? route.fulfill({ status: 404, body: "" })
      : route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
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
      ...routes,
    }),
  );
  await after(page);
  await page.goto(path);
}

const who = (page: Page) => page.locator(".kit-passport__who");
const gold = (page: Page) =>
  who(page).getByRole("img", { name: "Verified player" });

async function sideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
}

async function columns(page: Page) {
  return page
    .locator(".kit-stamp-grid")
    .first()
    .evaluate(
      (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
    );
}

async function axe(page: Page) {
  // Contrast is read from the mark at rest, not mid stamp-in.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    result.violations
      .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`),
  ).toEqual([]);
}

test.describe("your passport", () => {
  test("groups, earned and unearned in words, a legacy day, and gold for a verified player", async ({
    page,
  }) => {
    await open(page, "/home/passport");
    await expect(
      page.getByRole("heading", { level: 1, name: "Your passport" }),
    ).toBeVisible();
    for (const g of ["Getting started", "Your circle", "Playing together"])
      await expect(
        page.getByRole("heading", { level: 2, name: g }),
      ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Looking Good. Earned before 1 October 2026.",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Cheerleader II. Earned 12 November 2026.",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Linked. Optional. Not earned yet." }),
    ).toBeVisible();
    await expect(who(page).getByText("4 Stamps")).toBeVisible();
    await expect(gold(page)).toBeVisible();
    await expect(page).toHaveTitle("Passport - Home - Elixir");
    await axe(page);
  });

  test("a Stamp's sheet: Escape closes it, Tab stays inside, focus goes back", async ({
    page,
  }) => {
    await open(page, "/home/passport");
    const tile = page.getByRole("button", {
      name: "Cheerleader II. Earned 12 November 2026.",
    });
    await tile.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Cheerleader II" });
    await expect(sheet).toBeVisible();
    await expect(page).toHaveURL(/\/home\/passport\?stamp=cheerleader$/);
    await expect(
      sheet.getByText("Your progress: 18 of 50 days."),
    ).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Open Home" })).toBeVisible();
    await axe(page);
    // A modal dialog keeps Tab off the page behind it: focus cycles
    // through the sheet and, past its last control, the browser's own
    // controls (the document's body), then back into the sheet.
    let inside = 0;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const where = await page.evaluate(() =>
        document.activeElement?.closest("dialog[open]")
          ? "sheet"
          : document.activeElement === document.body ||
              document.activeElement === null
            ? "browser"
            : "page",
      );
      expect(where, `Tab ${i + 1} never reaches the page`).not.toBe("page");
      if (where === "sheet") inside += 1;
    }
    expect(inside).toBeGreaterThanOrEqual(4);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/home\/passport$/);
    await expect(tile).toBeFocused();
  });

  test("?stamp= opens one Stamp from a link; On the Map goes to the home clan's map", async ({
    page,
  }) => {
    await open(page, "/home/passport?stamp=on_the_map");
    const sheet = page.getByRole("dialog", { name: "On the Map" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Optional. Not earned yet.")).toBeVisible();
    await expect(
      sheet.getByRole("link", { name: "Open clan map" }),
    ).toHaveAttribute("href", "/clan/0JQ0JQ8/members/map");
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole("button", { name: /^On the Map\./ }),
    ).toBeFocused();
  });

  test("a new Stamp's line in the bell opens its sheet on your passport", async ({
    page,
  }) => {
    const at = "2026-11-14T12:00:00.000Z";
    await open(page, "/home", {
      "GET /api/me/bell": [
        200,
        {
          seen_at: null,
          players: 0,
          new: 0,
          reactions: { new: 0, items: [] },
          followers: { count: 0, new: 0, unnamed: 0, players: [] },
          answers: { new: 0, items: [] },
          account: {
            new: 1,
            items: [
              {
                kind: "stamp_earned",
                stamp_id: "cheerleader",
                name: "Cheerleader",
                level: 2,
                levels: 3,
                events: 1,
                players: 0,
                clans: 0,
                subjects: [],
                at,
                new: true,
              },
            ],
          },
        },
      ],
    });
    await page.getByRole("button", { name: /^Notifications/ }).click();
    const bell = page.getByRole("dialog", { name: "Notifications" });
    const line = bell.getByRole("link", { name: /New Stamp: Cheerleader II/ });
    await expect(line).toHaveAttribute(
      "href",
      "/home/passport?stamp=cheerleader",
    );
    await line.click();
    await expect(page).toHaveURL(/\/home\/passport\?stamp=cheerleader$/);
    const sheet = page.getByRole("dialog", { name: "Cheerleader II" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Earned 12 November 2026.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(
      page.getByRole("button", { name: /^Cheerleader II\./ }),
    ).toBeFocused();
  });

  test("opening your passport reconciles behind it, and a granted Stamp shows", async ({
    page,
  }) => {
    const GRANTED = {
      ...OWN_PASSPORT,
      passport: {
        ...OWN_PASSPORT.passport,
        earned: [
          ...OWN_PASSPORT.passport.earned,
          {
            stamp_id: "played_together",
            level: 1,
            earned_on: "2026-11-14",
            earned_before: null,
          },
        ],
      },
    };
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let granted = false;
    const passes: string[] = [];
    await open(page, "/home/passport", {}, async (p) => {
      await p.route("**/api/me/passport", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(granted ? GRANTED : OWN_PASSPORT),
        }),
      );
      await p.route("**/api/me/passport/reconcile", async (route) => {
        passes.push(route.request().method());
        await held;
        granted = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ...GRANTED,
            granted: [{ stamp_id: "played_together", level: 1 }],
            more: false,
          }),
        });
      });
    });
    // The passport is on screen while the pass is still out.
    await expect(who(page).getByText("4 Stamps")).toBeVisible();
    await expect.poll(() => passes).toEqual(["POST"]);
    release();
    await expect(who(page).getByText("5 Stamps")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Played Together I\. Earned/ }),
    ).toBeVisible();
    expect(passes).toEqual(["POST"]);
  });

  test("reduced motion: the stamp-in animation is gone", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/home/passport?stamp=cheerleader");
    const mark = page.locator("dialog .kit-stamp--l");
    await expect(mark).toBeVisible();
    expect(
      await mark.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    expect(
      await page
        .locator("dialog .kit-stamp--l")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("kit-stamp-in");
  });

  test("loading is not an empty passport; a failed read says so and retries", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    let fail = true;
    await open(page, "/home/passport", {}, (p) =>
      p.route("**/api/me/passport", async (route) => {
        await held;
        await route.fulfill({
          status: fail ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(fail ? { error: "unavailable" } : OWN_PASSPORT),
        });
      }),
    );
    await expect(page.getByRole("status")).toHaveText("Reading the passport…");
    await expect(page.getByText(/\d+ Stamps?\b/)).toHaveCount(0);
    await expect(page.getByText("No Stamps earned yet.")).toHaveCount(0);
    release();
    await expect(
      page.getByText("This passport could not be read just now"),
    ).toBeVisible();
    await expect(page.getByText(/\d+ Stamps?\b/)).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(who(page).getByText("4 Stamps")).toBeVisible();
  });
});

test.describe("another member's passport", () => {
  test("dates and rules, no progress, no action, no map, and never the viewer's own read", async ({
    page,
  }) => {
    const asked: string[] = [];
    page.on("request", (r) => asked.push(new URL(r.url()).pathname));
    await open(page, `/home/passport/${THEIRS}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Ada’s passport" }),
    ).toBeVisible();
    await expect(gold(page)).toBeVisible();
    // Ada's art fails: her initials stand in, and nothing breaks.
    await expect(who(page).locator(".kit-av")).toBeVisible();
    await page
      .getByRole("button", { name: "On the Map. Earned 3 November 2026." })
      .click();
    const sheet = page.getByRole("dialog", { name: "On the Map" });
    await expect(
      sheet.getByText(/The place is never shown here/),
    ).toBeVisible();
    await expect(sheet.getByText(/Your progress/)).toHaveCount(0);
    await expect(sheet.getByRole("link")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Copy passport link" }),
    ).toHaveCount(0);
    await axe(page);
    expect(asked).not.toContain("/api/me/passport");
    expect(asked).not.toContain("/api/me/clans/map");
  });

  test("a lapsed proof: Player verified stays, the gold goes", async ({
    page,
  }) => {
    await open(page, `/home/passport/${THEIRS}`, {
      [`GET /api/passports/${THEIRS}`]: [200, LAPSED_PASSPORT],
    });
    await expect(who(page).getByText("Player not verified")).toBeVisible();
    await expect(gold(page)).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Player verified. Earned 20 October 2026.",
      }),
    ).toBeVisible();
  });

  test("an account with no player: the account icon and New player", async ({
    page,
  }) => {
    await open(page, `/home/passport/${THEIRS}`, {
      [`GET /api/passports/${THEIRS}`]: [200, NEW_PASSPORT],
    });
    await expect(who(page).getByText("New player")).toBeVisible();
    await expect(who(page).getByText("Elixir account")).toBeVisible();
    await expect(who(page).locator(".kit-av--account svg")).toBeVisible();
    await expect(gold(page)).toHaveCount(0);
    await expect(page.getByText("No Stamps earned yet.")).toBeVisible();
  });

  test("a mistyped id is no passport, with the way to yours", async ({
    page,
  }) => {
    await open(page, "/home/passport/zzzzzzzzzzzz", {});
    await expect(page.getByText("No passport at this address")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open your passport" }),
    ).toHaveAttribute("href", "/home/passport");
  });
});

test.describe("the ways in", () => {
  test("the account menu and You link to your passport", async ({ page }) => {
    await open(page, "/home/you", {
      "GET /api/player": [
        200,
        {
          ...ADA_WITH_PASSPORT,
          player: {
            ...ADA_WITH_PASSPORT.player,
            tag: "#0J0RVYRR",
            name: "Grace",
          },
          you: {
            own: true,
            following: false,
            relationship: "primary",
            clanmate: null,
          },
          passport: { id: MINE, count: 4, marks: [] },
        },
      ],
    });
    await expect(
      page.getByRole("link", { name: /Your passport/ }),
    ).toHaveAttribute("href", "/home/passport");
    await page
      .getByRole("button", { name: /Account/ })
      .first()
      .click();
    await expect(
      page.getByRole("link", { name: "Passport", exact: true }),
    ).toHaveAttribute("href", "/home/passport");
  });

  test("a verified player's page: one row under the name, the play still in view", async ({
    page,
  }) => {
    await open(page, "/home/player/00C298UC", {
      "GET /api/player": [200, ADA_WITH_PASSPORT],
    });
    const row = page.locator(".kit-passport-row");
    await expect(row.getByText("3 Stamps")).toBeVisible();
    await expect(
      row.getByRole("link", { name: "Open passport" }),
    ).toHaveAttribute("href", `/home/passport/${THEIRS}`);
    await expect(row.locator(".kit-stamp-mini")).toHaveCount(2);
    await expect(
      page.getByRole("tablist", { name: "Player" }),
    ).toBeInViewport();
  });

  test("Profile: your player and your passport before the account", async ({
    page,
  }) => {
    await open(page, "/settings/profile");
    const you = page.getByRole("heading", { level: 2, name: "You in Elixir" });
    await expect(you).toBeVisible();
    const order = await page.evaluate(() =>
      [...document.querySelectorAll("h2")].map((h) => h.textContent),
    );
    expect(order.indexOf("You in Elixir")).toBeLessThan(
      order.indexOf("Account"),
    );
    await expect(
      page.getByRole("link", { name: "Open passport" }),
    ).toHaveAttribute("href", "/home/passport");
    await expect(page.getByText("4 Stamps")).toBeVisible();
  });
});

/** Phone first: two columns on the smallest phones, three when there is
 *  room, nothing sideways, every tap 44px. Viewports are Playwright's. */
for (const width of [320, 390, 1280]) {
  test(`@narrow the passport at ${width}px: columns, nothing sideways, 44px taps`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "/home/passport");
    await expect(
      page.getByRole("heading", { level: 2, name: "Your circle" }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await sideways(page)).toBeLessThanOrEqual(0);
    expect(await columns(page)).toBe(width < 360 ? 2 : 3);
    const small = await page
      .locator(".kit-stamp-tile, .kit-passport__actions .btn")
      .evaluateAll((els) =>
        els
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.height < 44 || r.width < 44)
          .map((r) => `${r.width}x${r.height}`),
      );
    expect(small).toEqual([]);
    await page.getByRole("button", { name: /^Cheerleader II\./ }).click();
    const sheet = page.getByRole("dialog", { name: "Cheerleader II" });
    await expect(sheet).toBeVisible();
    const sheetSmall = await sheet.locator("a, button").evaluateAll((els) =>
      els
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.height < 44)
        .map((r) => `${r.width}x${r.height}`),
    );
    expect(sheetSmall).toEqual([]);
  });
}

// 200%: a 640px window zoomed to 200% lays out at 320 CSS px, drawn at
// two device pixels each, so it gets the smallest phone's two columns.
// Page zoom on the root (CSS zoom 2 on a 640px window) keeps the
// window's media queries, three columns at twice the size: nothing may
// go sideways there either.
test("@narrow 200% zoom: a 640px window is the 320px layout", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await open(page, "/home/passport");
  await expect(
    page.getByRole("heading", { level: 2, name: "Your circle" }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  expect(await columns(page)).toBe(2);
  await context.close();
});

test("@narrow page zoom 200% on a 640px window: nothing sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await open(page, "/home/passport");
  await expect(
    page.getByRole("heading", { level: 2, name: "Your circle" }),
  ).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.evaluate(() => document.fonts.ready);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  // No Stamp's words spill out of its tile.
  const spilled = await page
    .locator(".kit-stamp-tile")
    .evaluateAll(
      (els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length,
    );
  expect(spilled).toBe(0);
});

test("@narrow blocked fonts: every Stamp still names itself in words", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route("**/assets/fonts/**", (route) => route.abort());
  await open(page, "/home/passport");
  await expect(
    page.getByRole("heading", { level: 2, name: "Your circle" }),
  ).toBeVisible();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
  await expect(page.locator(".kit-stamp-tile")).toHaveCount(11);
  for (const label of ["Earned", "Not earned", "Optional"])
    await expect(
      page.locator(".kit-stamp-tile__label", { hasText: label }).first(),
    ).toBeVisible();
});

// The profile picture's art is served as a stand-in PNG; the art files
// themselves are never changed (card art is byte-identical).
test("the owner's picture shows from its card art", async ({ page }) => {
  await open(page, "/home/passport");
  await expect(
    who(page).locator(`img[src$="/assets/cards/${ART}.png"]`),
  ).toBeVisible();
});
