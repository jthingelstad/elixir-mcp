import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockApi } from "./fixtures.ts";
import { HOME, homeApi, ownerPassport } from "./home-fixture.ts";

/**
 * Home's suggested follows (2026-11-13), the first thing a person who
 * follows few players sees: on every visit, not only the first (Jamie:
 * "the suggested follows is CRITICAL for first user experience"). A
 * phone's first screen holds Follow these and at least three rows with
 * their reasons; every row is ticked, untick anyone, then one confirmed
 * follow; "Not now" puts it aside; with nobody to suggest, one line
 * points to Find. Invented players only.
 */
// Every journey here runs under one pinned clock, Wednesday noon in the
// reader's zone (ME.timezone, America/Chicago), and the fixture's times
// are minutes before it. Against the real clock a player who played 30
// minutes ago "played yesterday" in the half hour after Central midnight,
// so the first-screen test failed main's CI at 00:21 Central on
// 2026-11-15 (docs/notes/2026-11-15-e2e-reader-clock.md).
const NOW = Date.parse("2026-11-11T18:00:00Z");
const AGO = (min: number) => new Date(NOW - min * 60_000).toISOString();
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});
const HOSTILE = "<img src=x onerror=alert(1)>Fern";

const PEOPLE = [
  {
    tag: "#00JRG2RU",
    name: "Amber",
    why: [
      {
        kind: "battles",
        against: 1,
        with_you: 0,
        friendly: 1,
        clanmate_battles: 0,
        days: 30,
      },
    ],
    free: true,
    reason: "recorded",
  },
  {
    tag: "#0YP8U0Y0",
    name: HOSTILE,
    why: [
      {
        kind: "battles",
        against: 1,
        with_you: 0,
        friendly: 1,
        clanmate_battles: 0,
        days: 30,
      },
    ],
    free: false,
    reason: null,
  },
  {
    tag: "#080J2V9Q",
    name: "Elm",
    why: [
      {
        kind: "battles",
        against: 0,
        with_you: 2,
        friendly: 0,
        clanmate_battles: 0,
        days: 30,
      },
    ],
    free: false,
    reason: null,
  },
  ...["#02G2PJC0", "#08VP8VYY", "#0J9YCYL2", "#09VURCVC", "#0VJLCPJ0"].map(
    (tag, i) => ({
      tag,
      name: `Invented Player ${i + 1}`,
      why: [
        {
          kind: "battles",
          against: 1,
          with_you: 0,
          friendly: 1,
          clanmate_battles: 0,
          days: 30,
        },
      ],
      free: false,
      reason: null,
    }),
  ),
];

const offer = (people = PEOPLE) => ({
  ok: true,
  offer: true,
  people,
  used: 1,
  limit: 50,
  slots_cap: 10,
});

const home = (
  setup: Record<string, unknown>,
  starter: unknown,
  more: Parameters<typeof homeApi>[0] = {},
) =>
  homeApi({
    "GET /api/me/home": [
      200,
      { first: { ...HOME.first, setup, starter_hidden_until: null } },
    ],
    "GET /api/me/people/starter": [200, starter],
    "GET /api/me/passport": [
      200,
      ownerPassport(["done", "done", "todo", "todo", "todo", "todo"]),
    ],
    ...more,
  });

const NEW = {
  following: 0,
  emails: { chosen_at: null, daily: false, weekly: true, season: true },
};

async function noSideways(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
}

for (const [label, width, height, fallback] of [
  ["narrow phone", 320, 844, false],
  ["phone", 390, 844, false],
  ["small phone", 375, 667, false],
  ["small phone with wide fallback", 375, 667, true],
  ["desktop", 1280, 844, false],
] as const) {
  test(`${label}: the first screen holds Follow these and three rows with their reasons`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (fallback)
      await page.route("**/assets/fonts/**", (route) => route.abort());
    await mockApi(page, home(NEW, offer()));
    await page.goto("/home");
    if (fallback)
      await page.addStyleTag({
        content: ":root { --font: monospace; --font-display: monospace; }",
      });
    const set = page.locator(".kit-starter");
    await expect(
      set.getByRole("heading", { name: "People you know" }),
    ).toBeVisible();
    const go = set.getByRole("button", { name: "Follow these (8)" });
    await expect(go).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
    });
    await page.screenshot({
      path: process.env.STARTER_SHOTS
        ? `${process.env.STARTER_SHOTS}/${label.replaceAll(" ", "-")}-${width}.png`
        : test
            .info()
            .outputPath(
              `home-starter-${label.replaceAll(" ", "-")}-${width}.png`,
            ),
    });
    // Above the profile list and the feed.
    const top = await set.boundingBox();
    const list = await page.locator(".kit-profile").boundingBox();
    expect(top!.y).toBeLessThan(list!.y);
    // Without scrolling: the button and the first three rows, reasons and
    // all, end inside the first screen.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // The first screen ends at the phone's bottom tabs, which cover the page.
    const tabs = page.locator("nav.kit-bottom");
    const floor = (await tabs.isVisible())
      ? (await tabs.boundingBox())!.y
      : height;
    const inView = async (box: { y: number; height: number } | null) =>
      expect(box!.y + box!.height).toBeLessThanOrEqual(floor);
    await inView(await go.boundingBox());
    const rows = set.locator(".kit-starter__row");
    await expect(rows).toHaveCount(5);
    for (let i = 0; i < 3; i++) {
      await inView(await rows.nth(i).boundingBox());
      await expect(rows.nth(i).locator(".kit-people__why")).not.toBeEmpty();
      const tick = await rows.nth(i).locator("label").boundingBox();
      expect(tick!.width).toBeGreaterThanOrEqual(44);
      expect(tick!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(rows.nth(0)).toContainText("Friendly battle · last 30 days");
    await expect(rows.nth(1)).toContainText("Friendly battle · last 30 days");
    await expect(rows.nth(2)).toContainText(
      "2v2 teammate twice · last 30 days",
    );
    await expect(rows.nth(3)).toContainText("Friendly battle · last 30 days");
    await noSideways(page);
    if (label !== "desktop")
      await page.screenshot({
        path: test.info().outputPath(`home-starter-${width}.png`),
      });
    const results = await new AxeBuilder({ page })
      .include(".kit-starter")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(
      results.violations
        .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
        .map((v) => v.id),
    ).toEqual([]);
  });
}

test("a hostile name is text; untick, then one confirmed follow of the ticked", async ({
  page,
}) => {
  const posted: unknown[] = [];
  await mockApi(
    page,
    home(NEW, offer(), {
      "POST /api/me/follow-all": (route) => {
        posted.push(route.request().postDataJSON());
        return [200, { ok: true, followed: 6 }];
      },
    }),
  );
  await page.goto("/home");
  const set = page.locator(".kit-starter");
  await expect(set.getByText(HOSTILE)).toBeVisible();
  await expect(set.locator("img[src=x]")).toHaveCount(0);
  // Every row ticked; untick two.
  await set.getByRole("checkbox", { name: "Follow Elm" }).uncheck();
  await set
    .getByRole("checkbox", { name: "Follow Invented Player 1" })
    .uncheck();
  await expect(set.getByRole("status")).toContainText(
    "6 players · uses 5 of your 50 follows",
  );
  expect(posted).toEqual([]);
  await set.getByRole("button", { name: "Follow these (6)" }).click();
  const dialog = page.getByRole("dialog", { name: "Follow 6 players?" });
  await expect(dialog).toBeVisible();
  expect(posted).toEqual([]);
  await dialog.getByRole("button", { name: "Follow these" }).click();
  await expect(dialog).toBeHidden();
  expect(posted).toEqual([
    {
      player_tags: PEOPLE.map((p) => p.tag).filter(
        (t) => t !== "#080J2V9Q" && t !== "#02G2PJC0",
      ),
    },
  ]);
});

test("small phone: enlarged text reflows and keeps the starter controls usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockApi(page, home(NEW, offer()));
  await page.goto("/home");
  await page.addStyleTag({ content: "html { zoom: 1.25; }" });
  const set = page.locator(".kit-starter");
  const elm = set.getByRole("checkbox", { name: "Follow Elm" });
  await expect(elm).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // The feed below the starter can still be laying out when the row is
  // scrolled to, which moves it back out of view (seen 2026-11-23 under a
  // full run). Scroll and look again until the page has settled.
  const third = set.locator(".kit-starter__row").nth(2);
  await expect(async () => {
    await third.scrollIntoViewIfNeeded();
    await expect(third).toBeInViewport({ ratio: 1, timeout: 250 });
  }).toPass();
  await expect(set).toContainText("2v2 teammate twice · last 30 days");
  const tick = await elm.locator("..").boundingBox();
  expect(tick!.width).toBeGreaterThanOrEqual(44);
  expect(tick!.height).toBeGreaterThanOrEqual(44);
  await elm.focus();
  await page.keyboard.press("Space");
  await expect(elm).not.toBeChecked();
  await expect(set.getByRole("status")).toContainText("7 players");
  await noSideways(page);
  await page.screenshot({
    path: process.env.STARTER_SHOTS
      ? `${process.env.STARTER_SHOTS}/text-125-percent-375.png`
      : test.info().outputPath("home-starter-text-125-percent.png"),
  });
});

test("offered to an account following few after its profile list is done, and Not now puts it aside", async ({
  page,
}) => {
  let hidden = 0;
  await mockApi(
    page,
    home(
      {
        following: 3,
        emails: {
          chosen_at: AGO(600),
          daily: false,
          weekly: true,
          season: true,
        },
      },
      offer(),
      {
        "GET /api/me/passport": [
          200,
          ownerPassport(["done", "done", "done", "done", "done", "done"], {
            complete: true,
            completed_at: AGO(500),
          }),
        ],
        "POST /api/me/people/starter/hide": () => {
          hidden += 1;
          return [200, { hidden_at: AGO(0) }];
        },
      },
    ),
  );
  await page.goto("/home");
  const set = page.locator(".kit-starter");
  await expect(set).toBeVisible();
  await expect(page.locator(".kit-profile")).toHaveCount(0);
  await set.getByRole("button", { name: "Not now" }).click();
  await expect(set).toHaveCount(0);
  expect(hidden).toBe(1);
});

test("following five, or put aside: no list, and no read for it", async ({
  page,
}) => {
  let reads = 0;
  const count = () => {
    reads += 1;
    return [200, offer()] as [number, unknown];
  };
  await mockApi(
    page,
    home(
      {
        following: 5,
        emails: { chosen_at: null, daily: false, weekly: true, season: true },
      },
      offer(),
      {
        "GET /api/me/people/starter": count,
      },
    ),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-feed")).toBeVisible();
  await expect(page.locator(".kit-starter")).toHaveCount(0);
  await mockApi(
    page,
    homeApi({
      "GET /api/me/home": [
        200,
        {
          first: {
            ...HOME.first,
            setup: NEW,
            starter_hidden_until: new Date(NOW + 10 * 86_400_000).toISOString(),
          },
        },
      ],
      "GET /api/me/people/starter": count,
    }),
  );
  await page.goto("/home");
  await expect(page.locator(".kit-feed")).toBeVisible();
  await expect(page.locator(".kit-starter")).toHaveCount(0);
  expect(reads).toBe(0);
});

test("nobody to suggest: one line pointing to Find, never an empty box", async ({
  page,
}) => {
  await mockApi(page, home(NEW, offer([])));
  await page.goto("/home");
  const set = page.locator(".kit-starter");
  await expect(set).toContainText(
    "Clanmates connect automatically through your verified players",
  );
  await expect(
    set.getByRole("link", {
      name: "Search by name or tag, or send your Follow me link",
    }),
  ).toHaveAttribute("href", "/home/find");
  await expect(set.locator(".kit-starter__row")).toHaveCount(0);
  await expect(set.getByRole("button", { name: /Follow these/ })).toHaveCount(
    0,
  );
});
